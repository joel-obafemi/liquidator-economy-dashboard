/**
 * Morpho Blue market ID resolver.
 *
 * Morpho Blue liquidation events only carry a bytes32 market `id`.
 * To derive loan/collateral tokens we call idToMarketParams(id) on the
 * Morpho contract. Resolutions are cached in memory + `morpho_markets`
 * so the scanner only pays the RPC cost once per unique market.
 */
import { ethClient } from "@/lib/rpc"
import { rawSql } from "@/lib/db"
import { MORPHO_BLUE, MORPHO_MARKET_PARAMS_ABI } from "@/lib/contracts"

export interface MorphoMarket {
  id: string                // lowercase hex with 0x prefix
  loanToken: string         // lowercase
  collateralToken: string   // lowercase
  oracle: string
  irm: string
  lltv: bigint
}

const memoryCache = new Map<string, MorphoMarket>()

/**
 * Resolve multiple market IDs in one shot, using in-memory + DB cache
 * before hitting RPC. Returns a Map keyed by lowercase id.
 */
export async function resolveMarkets(ids: string[]): Promise<Map<string, MorphoMarket>> {
  const result = new Map<string, MorphoMarket>()
  const toFetch: string[] = []

  for (const raw of ids) {
    const id = raw.toLowerCase()
    if (memoryCache.has(id)) {
      result.set(id, memoryCache.get(id)!)
      continue
    }
    toFetch.push(id)
  }

  if (toFetch.length === 0) return result

  // DB cache
  const dbRows = await rawSql(
    `SELECT id, loan_token, collateral_token, oracle, irm, lltv FROM morpho_markets WHERE id = ANY($1)`,
    [toFetch]
  )
  const dbHits = new Set<string>()
  for (const row of dbRows) {
    const market: MorphoMarket = {
      id: row.id,
      loanToken: row.loan_token,
      collateralToken: row.collateral_token,
      oracle: row.oracle,
      irm: row.irm,
      lltv: BigInt(row.lltv),
    }
    memoryCache.set(row.id, market)
    result.set(row.id, market)
    dbHits.add(row.id)
  }

  const stillNeeded = toFetch.filter(id => !dbHits.has(id))
  if (stillNeeded.length === 0) return result

  // Fetch from chain — one call per market (Morpho has no batch function).
  // We use Promise.allSettled so a single bad market id doesn't break the batch.
  const settled = await Promise.allSettled(
    stillNeeded.map(id =>
      ethClient.readContract({
        address: MORPHO_BLUE as `0x${string}`,
        abi: MORPHO_MARKET_PARAMS_ABI,
        functionName: "idToMarketParams",
        args: [id as `0x${string}`],
      })
    )
  )

  const inserts: Array<{ market: MorphoMarket }> = []
  for (let i = 0; i < stillNeeded.length; i++) {
    const id = stillNeeded[i]
    const res = settled[i]
    if (res.status !== "fulfilled") {
      console.warn(`Market ${id.slice(0, 10)}... resolve failed:`, (res.reason as any)?.message?.slice(0, 80))
      continue
    }
    const params = res.value as readonly [string, string, string, string, bigint]
    const market: MorphoMarket = {
      id,
      loanToken: params[0].toLowerCase(),
      collateralToken: params[1].toLowerCase(),
      oracle: params[2].toLowerCase(),
      irm: params[3].toLowerCase(),
      lltv: params[4],
    }
    memoryCache.set(id, market)
    result.set(id, market)
    inserts.push({ market })
  }

  // Persist to DB cache (best-effort)
  if (inserts.length > 0) {
    try {
      const values = inserts
        .map(({ market }) =>
          `('${market.id}','${market.loanToken}','${market.collateralToken}','${market.oracle}','${market.irm}',${market.lltv.toString()})`
        )
        .join(",")
      await rawSql(`
        INSERT INTO morpho_markets (id, loan_token, collateral_token, oracle, irm, lltv)
        VALUES ${values}
        ON CONFLICT (id) DO NOTHING
      `)
    } catch (e: any) {
      console.warn("morpho_markets cache insert failed:", e?.message?.slice(0, 100))
    }
  }

  return result
}
