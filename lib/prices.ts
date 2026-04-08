import { rawSql } from "@/lib/db"

const DEFILLAMA_BASE = "https://coins.llama.fi/prices/historical"

// Round to nearest hour for cache efficiency
function roundToHour(timestamp: number): number {
  return Math.floor(timestamp / 3600) * 3600
}

export async function getTokenPrices(
  tokenTimestamps: Array<{ address: string; timestamp: number }>
): Promise<Map<string, number>> {
  const result = new Map<string, number>() // key: "address:hourlyTimestamp"

  // Deduplicate by (address, hourly timestamp)
  const needed = new Map<string, { address: string; hourTs: number }>()
  for (const { address, timestamp } of tokenTimestamps) {
    const hourTs = roundToHour(timestamp)
    const key = `${address.toLowerCase()}:${hourTs}`
    needed.set(key, { address: address.toLowerCase(), hourTs })
  }

  if (needed.size === 0) return result

  // Check DB cache
  const entries = [...needed.values()]
  const addressList = [...new Set(entries.map((e) => e.address))]
  const minTs = Math.min(...entries.map((e) => e.hourTs))
  const maxTs = Math.max(...entries.map((e) => e.hourTs))

  const cached = await rawSql(
    `SELECT token_address, timestamp, price_usd FROM price_cache
     WHERE token_address = ANY($1) AND timestamp >= $2 AND timestamp <= $3`,
    [addressList, minTs, maxTs]
  )

  for (const row of cached) {
    const key = `${row.token_address}:${Number(row.timestamp)}`
    result.set(key, Number(row.price_usd))
    needed.delete(key)
  }

  if (needed.size === 0) return result

  // Group remaining by timestamp for batch DeFiLlama requests
  const byTimestamp = new Map<number, string[]>()
  for (const { address, hourTs } of needed.values()) {
    if (!byTimestamp.has(hourTs)) byTimestamp.set(hourTs, [])
    byTimestamp.get(hourTs)!.push(address)
  }

  const toInsert: Array<{ address: string; ts: number; price: number }> = []

  for (const [ts, addresses] of byTimestamp) {
    const uniqueAddrs = [...new Set(addresses)]
    const BATCH = 25

    for (let i = 0; i < uniqueAddrs.length; i += BATCH) {
      const batch = uniqueAddrs.slice(i, i + BATCH)
      const coins = batch.map((a) => `ethereum:${a}`).join(",")
      const url = `${DEFILLAMA_BASE}/${ts}/${coins}?searchWidth=6h`

      try {
        const res = await fetch(url)
        if (!res.ok) {
          console.warn(`DeFiLlama error ${res.status} for ts=${ts}`)
          continue
        }
        const data = await res.json()
        for (const [coinKey, val] of Object.entries(data.coins || {})) {
          const price = (val as any).price
          if (typeof price === "number" && price > 0) {
            const addr = coinKey.replace("ethereum:", "").toLowerCase()
            const key = `${addr}:${ts}`
            result.set(key, price)
            toInsert.push({ address: addr, ts, price })
          }
        }
      } catch (e: any) {
        console.warn(`DeFiLlama fetch error: ${e.message?.slice(0, 100)}`)
      }

      // Rate limit: ~4 req/s
      if (i + BATCH < uniqueAddrs.length) {
        await new Promise((r) => setTimeout(r, 250))
      }
    }

    // Rate limit between timestamps too
    await new Promise((r) => setTimeout(r, 250))
  }

  // Bulk insert into price_cache
  if (toInsert.length > 0) {
    const BATCH = 500
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH)
      const values = batch
        .map((r) => `('${r.address}',${r.ts},${r.price},'defillama')`)
        .join(",")
      try {
        await rawSql(`
          INSERT INTO price_cache (token_address, timestamp, price_usd, source)
          VALUES ${values}
          ON CONFLICT (token_address, timestamp) DO NOTHING
        `)
      } catch (e: any) {
        console.warn("Price cache insert error:", e?.message?.slice(0, 100))
      }
    }
  }

  return result
}

export function lookupPrice(
  prices: Map<string, number>,
  address: string,
  timestamp: number
): number {
  const hourTs = roundToHour(timestamp)
  return prices.get(`${address.toLowerCase()}:${hourTs}`) ?? 0
}
