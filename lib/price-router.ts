/**
 * Price router for Morpho Blue and any other protocol without a global oracle.
 *
 * Order of resolution:
 *   1. Aave V3 Oracle at the historical block (fast, one batch call)
 *   2. DeFiLlama /prices/historical for any tokens the oracle didn't cover
 *
 * Results are returned in a single Map so downstream code doesn't care where
 * each price came from. DeFiLlama responses are also written into `price_cache`
 * so subsequent runs skip the HTTP hit.
 */
import { ethClient } from "@/lib/rpc"
import { rawSql } from "@/lib/db"
import { ORACLE_ABI, AAVE_V3_ORACLE } from "@/lib/contracts"

const ORACLE_DIVISOR = 1e8
const DEFILLAMA_BASE = "https://coins.llama.fi/prices/historical"

function roundToHour(timestamp: number): number {
  return Math.floor(timestamp / 3600) * 3600
}

/**
 * Attempt Aave oracle first, then fill gaps with DeFiLlama using the
 * block timestamp rounded to the nearest hour.
 */
export async function getPricesWithFallback(
  assets: string[],
  blockNumber: bigint,
  blockTimestamp: number,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (assets.length === 0) return result

  const unique = [...new Set(assets.map(a => a.toLowerCase()))]

  // ── Step 1: Aave V3 oracle (batch) ──────────────────────────
  try {
    const prices = (await ethClient.readContract({
      address: AAVE_V3_ORACLE as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "getAssetsPrices",
      args: [unique as `0x${string}`[]],
      blockNumber,
    })) as bigint[]

    for (let i = 0; i < unique.length; i++) {
      const raw = prices[i]
      if (raw && raw > 0n) {
        result.set(unique[i], Number(raw) / ORACLE_DIVISOR)
      }
    }
  } catch {
    // Batch failed — fall back to individual calls for each asset
    for (const asset of unique) {
      try {
        const raw = (await ethClient.readContract({
          address: AAVE_V3_ORACLE as `0x${string}`,
          abi: ORACLE_ABI,
          functionName: "getAssetPrice",
          args: [asset as `0x${string}`],
          blockNumber,
        })) as bigint
        if (raw && raw > 0n) {
          result.set(asset, Number(raw) / ORACLE_DIVISOR)
        }
      } catch {
        // asset not registered in Aave oracle — will go to DeFiLlama
      }
    }
  }

  // ── Step 2: DeFiLlama fallback for tokens still missing ─────
  const missing = unique.filter(a => !result.has(a))
  if (missing.length === 0) return result

  const hourTs = roundToHour(blockTimestamp)

  // Check DB cache first
  const cached = await rawSql(
    `SELECT token_address, price_usd FROM price_cache WHERE token_address = ANY($1) AND timestamp = $2`,
    [missing, hourTs]
  )
  for (const row of cached) {
    if (Number(row.price_usd) > 0) {
      result.set(row.token_address, Number(row.price_usd))
    }
  }

  const stillMissing = missing.filter(a => !result.has(a))
  if (stillMissing.length === 0) return result

  // DeFiLlama batch request — up to 100 per call
  const coins = stillMissing.map(a => `ethereum:${a}`).join(",")
  const url = `${DEFILLAMA_BASE}/${hourTs}/${coins}?searchWidth=6h`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (res.ok) {
      const data = await res.json()
      const coinsObj = (data.coins || {}) as Record<string, { price: number }>
      const toInsert: Array<{ addr: string; price: number }> = []
      for (const [key, val] of Object.entries(coinsObj)) {
        const addr = key.replace(/^ethereum:/, "").toLowerCase()
        if (val.price && val.price > 0) {
          result.set(addr, val.price)
          toInsert.push({ addr, price: val.price })
        }
      }

      // Persist to cache (best-effort)
      if (toInsert.length > 0) {
        const values = toInsert
          .map(({ addr, price }) => `('${addr}',${hourTs},${price},'defillama')`)
          .join(",")
        try {
          await rawSql(`
            INSERT INTO price_cache (token_address, timestamp, price_usd, source)
            VALUES ${values}
            ON CONFLICT (token_address, timestamp) DO NOTHING
          `)
        } catch {
          // non-fatal
        }
      }
    }
  } catch (e: any) {
    console.warn(`DeFiLlama fallback failed for block ${blockNumber}:`, e?.message?.slice(0, 100))
  }

  return result
}
