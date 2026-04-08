import { ethClient } from "@/lib/rpc"
import { ERC20_ABI } from "@/lib/contracts"
import { sql, rawSql } from "@/lib/db"
import type { TokenMetadata } from "@/lib/types"

/**
 * Token metadata overrides — for tokens where the on-chain `decimals()`
 * return value is misleading or wrong. These are manually verified.
 *
 * wUSDL: Paxos-style ERC4626 wrapper. decimals() returns 6 but raw
 * uint256 balances are stored at 18 decimals. Confirmed by comparing
 * totalSupply against expected circulating supply.
 */
const TOKEN_OVERRIDES: Record<string, { symbol: string; decimals: number }> = {
  "0x7751e2f4b8ae93ef6b79d86419d42fe3295a4559": { symbol: "wUSDL", decimals: 18 },
}

const memoryCache = new Map<string, TokenMetadata>()

export async function resolveTokenMetadata(
  addresses: string[]
): Promise<Map<string, TokenMetadata>> {
  const result = new Map<string, TokenMetadata>()
  const toFetch: string[] = []

  for (const addr of addresses) {
    const lower = addr.toLowerCase()
    // Overrides win over any cached or on-chain value
    if (TOKEN_OVERRIDES[lower]) {
      const meta: TokenMetadata = { address: lower, ...TOKEN_OVERRIDES[lower] }
      memoryCache.set(lower, meta)
      result.set(lower, meta)
      continue
    }
    if (memoryCache.has(lower)) {
      result.set(lower, memoryCache.get(lower)!)
      continue
    }
    toFetch.push(lower)
  }

  if (toFetch.length === 0) return result

  // Check DB cache
  const dbRows = await rawSql(
    `SELECT address, symbol, decimals FROM token_metadata WHERE address = ANY($1)`,
    [toFetch]
  )
  const dbHits = new Set<string>()
  for (const row of dbRows) {
    const meta: TokenMetadata = {
      address: row.address,
      symbol: row.symbol,
      decimals: Number(row.decimals),
    }
    memoryCache.set(row.address, meta)
    result.set(row.address, meta)
    dbHits.add(row.address)
  }

  const stillNeeded = toFetch.filter((a) => !dbHits.has(a))
  if (stillNeeded.length === 0) return result

  // Fetch from chain via multicall
  const calls: any[] = []
  for (const addr of stillNeeded) {
    calls.push({
      address: addr as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "symbol",
    })
    calls.push({
      address: addr as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
    })
  }

  try {
    const res = await ethClient.multicall({ contracts: calls })
    const inserts: string[] = []

    for (let i = 0; i < stillNeeded.length; i++) {
      const addr = stillNeeded[i]
      const symbol = (res[i * 2]?.result as string) || "UNKNOWN"
      const decimals = Number(res[i * 2 + 1]?.result ?? 18)

      const meta: TokenMetadata = { address: addr, symbol, decimals }
      memoryCache.set(addr, meta)
      result.set(addr, meta)

      const safeSymbol = symbol.replace(/'/g, "''")
      inserts.push(`('${addr}','${safeSymbol}',${decimals})`)
    }

    if (inserts.length > 0) {
      await rawSql(`
        INSERT INTO token_metadata (address, symbol, decimals)
        VALUES ${inserts.join(",")}
        ON CONFLICT (address) DO NOTHING
      `)
    }
  } catch (e: any) {
    console.error("Token metadata resolution error:", e?.message?.slice(0, 200))
    // Fallback: set unknown for any missing
    for (const addr of stillNeeded) {
      if (!result.has(addr)) {
        const meta: TokenMetadata = { address: addr, symbol: "UNKNOWN", decimals: 18 }
        memoryCache.set(addr, meta)
        result.set(addr, meta)
      }
    }
  }

  return result
}
