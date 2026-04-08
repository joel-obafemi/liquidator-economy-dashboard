/**
 * Repair events that have $0 USD values due to DeFiLlama price fetch failures.
 * Re-fetches prices and updates the records.
 *
 * Run with: npx tsx -r tsconfig-paths/register scripts/repair-prices.ts
 */
import { Pool } from "@neondatabase/serverless"
import * as fs from "fs"
import * as path from "path"

const envPath = path.resolve(__dirname, "../.env.local")
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!process.env[key]) process.env[key] = val
  }
}

const dbUrl = process.env.DATABASE_URL!.replace(/&?channel_binding=[^&]*/g, "")
const pool = new Pool({ connectionString: dbUrl })

const DEFILLAMA_BASE = "https://coins.llama.fi/prices/historical"

function roundToHour(ts: number): number {
  return Math.floor(ts / 3600) * 3600
}

// In-memory price cache to avoid repeated DB lookups
const priceMemCache = new Map<string, number>()

async function getPrice(tokenAddress: string, timestamp: number): Promise<number> {
  const hourTs = roundToHour(timestamp)
  const cacheKey = `${tokenAddress}:${hourTs}`

  // Memory cache
  if (priceMemCache.has(cacheKey)) return priceMemCache.get(cacheKey)!

  // DB cache
  const cached = await pool.query(
    "SELECT price_usd FROM price_cache WHERE token_address = $1 AND timestamp = $2",
    [tokenAddress, hourTs]
  )
  if (cached.rows.length > 0 && Number(cached.rows[0].price_usd) > 0) {
    const price = Number(cached.rows[0].price_usd)
    priceMemCache.set(cacheKey, price)
    return price
  }

  // Fetch from DeFiLlama
  try {
    const url = `${DEFILLAMA_BASE}/${hourTs}/ethereum:${tokenAddress}?searchWidth=12h`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const price = data.coins?.[`ethereum:${tokenAddress}`]?.price
      if (typeof price === "number" && price > 0) {
        priceMemCache.set(cacheKey, price)
        await pool.query(
          "INSERT INTO price_cache (token_address, timestamp, price_usd, source) VALUES ($1, $2, $3, 'defillama') ON CONFLICT (token_address, timestamp) DO UPDATE SET price_usd = $3",
          [tokenAddress, hourTs, price]
        )
        return price
      }
    }
  } catch {}

  return 0
}

async function main() {
  console.log("=== Repairing Zero-USD Events ===\n")

  // Get token decimals
  const tokenRows = await pool.query("SELECT address, decimals FROM token_metadata")
  const decimalsMap = new Map<string, number>()
  for (const r of tokenRows.rows) {
    decimalsMap.set(r.address, Number(r.decimals))
  }
  console.log(`Loaded ${decimalsMap.size} token decimals`)

  const BATCH_SIZE = 100
  let offset = 0
  let totalFixed = 0
  let totalFailed = 0
  let totalProcessed = 0

  while (true) {
    const rows = await pool.query(`
      SELECT id, block_timestamp, collateral_asset, debt_asset,
             debt_to_cover, liquidated_collateral_amount
      FROM liquidation_events
      WHERE collateral_amount_usd = 0 OR debt_amount_usd = 0
      ORDER BY block_number ASC
      LIMIT $1
    `, [BATCH_SIZE])

    if (rows.rows.length === 0) break

    // Collect unique (token, timestamp) pairs for batch fetching
    const tokenTimestamps = new Set<string>()
    for (const r of rows.rows) {
      const ts = Number(r.block_timestamp)
      tokenTimestamps.add(`${r.collateral_asset}:${ts}`)
      tokenTimestamps.add(`${r.debt_asset}:${ts}`)
    }

    // Batch fetch prices (deduplicated by hourly timestamp)
    const uniqueHourly = new Map<string, { address: string; hourTs: number }>()
    for (const key of tokenTimestamps) {
      const [addr, tsStr] = key.split(":")
      const hourTs = roundToHour(Number(tsStr))
      const hKey = `${addr}:${hourTs}`
      if (!uniqueHourly.has(hKey) && !priceMemCache.has(hKey)) {
        uniqueHourly.set(hKey, { address: addr, hourTs })
      }
    }

    // Fetch missing prices from DeFiLlama in batches of 25
    const toFetch = [...uniqueHourly.values()]
    const byTimestamp = new Map<number, string[]>()
    for (const { address, hourTs } of toFetch) {
      if (!byTimestamp.has(hourTs)) byTimestamp.set(hourTs, [])
      byTimestamp.get(hourTs)!.push(address)
    }

    for (const [ts, addresses] of byTimestamp) {
      const unique = [...new Set(addresses)]
      for (let i = 0; i < unique.length; i += 25) {
        const batch = unique.slice(i, i + 25)
        const coins = batch.map(a => `ethereum:${a}`).join(",")
        const url = `${DEFILLAMA_BASE}/${ts}/${coins}?searchWidth=12h`
        try {
          const res = await fetch(url)
          if (res.ok) {
            const data = await res.json()
            for (const [coinKey, val] of Object.entries(data.coins || {})) {
              const price = (val as any).price
              if (typeof price === "number" && price > 0) {
                const addr = coinKey.replace("ethereum:", "").toLowerCase()
                const cacheKey = `${addr}:${ts}`
                priceMemCache.set(cacheKey, price)
                await pool.query(
                  "INSERT INTO price_cache (token_address, timestamp, price_usd, source) VALUES ($1, $2, $3, 'defillama') ON CONFLICT (token_address, timestamp) DO UPDATE SET price_usd = $3",
                  [addr, ts, price]
                )
              }
            }
          }
        } catch {}
        await new Promise(r => setTimeout(r, 250))
      }
    }

    // Now update events with prices
    const updates: string[] = []
    for (const r of rows.rows) {
      const ts = Number(r.block_timestamp)
      const collDecimals = decimalsMap.get(r.collateral_asset) ?? 18
      const debtDecimals = decimalsMap.get(r.debt_asset) ?? 18

      const collPrice = priceMemCache.get(`${r.collateral_asset}:${roundToHour(ts)}`) ?? 0
      const debtPrice = priceMemCache.get(`${r.debt_asset}:${roundToHour(ts)}`) ?? 0

      if (collPrice === 0 && debtPrice === 0) {
        totalFailed++
        continue
      }

      const collAmount = Number(r.liquidated_collateral_amount) / (10 ** collDecimals)
      const debtAmount = Number(r.debt_to_cover) / (10 ** debtDecimals)
      const collUsd = collAmount * collPrice
      const debtUsd = debtAmount * debtPrice
      const grossProfit = collUsd - debtUsd

      updates.push(`(${r.id}, ${debtUsd}, ${collUsd}, ${grossProfit})`)
      totalFixed++
    }

    if (updates.length > 0) {
      // Batch update
      const UBATCH = 200
      for (let i = 0; i < updates.length; i += UBATCH) {
        const batch = updates.slice(i, i + UBATCH)
        await pool.query(`
          UPDATE liquidation_events AS le
          SET debt_amount_usd = u.debt_usd,
              collateral_amount_usd = u.coll_usd,
              gross_profit_usd = u.profit,
              net_profit_usd = u.profit - COALESCE(le.gas_cost_usd, 0)
          FROM (VALUES ${batch.join(",")}) AS u(id, debt_usd, coll_usd, profit)
          WHERE le.id = u.id::int
        `)
      }
    }

    totalProcessed += rows.rows.length

    if (totalProcessed % 500 === 0 || rows.rows.length < BATCH_SIZE) {
      console.log(`  Processed: ${totalProcessed}, Fixed: ${totalFixed}, Still missing: ${totalFailed}`)
    }

    if (rows.rows.length < BATCH_SIZE) break
  }

  console.log(`\n=== Repair Complete ===`)
  console.log(`Processed: ${totalProcessed}`)
  console.log(`Fixed: ${totalFixed}`)
  console.log(`Still missing prices: ${totalFailed}`)

  // Final stats
  const stats = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE collateral_amount_usd = 0 OR debt_amount_usd = 0) as still_zero,
      SUM(gross_profit_usd) as total_profit,
      SUM(collateral_amount_usd) as total_volume
    FROM liquidation_events WHERE protocol = 'aave_v3'
  `)
  const s = stats.rows[0]
  console.log(`\nAave V3 after repair:`)
  console.log(`  Total profit: $${Number(s.total_profit).toFixed(2)}`)
  console.log(`  Total volume: $${Number(s.total_volume).toFixed(2)}`)
  console.log(`  Still $0: ${s.still_zero} events`)

  // Compare top liquidator
  const top = await pool.query(`
    SELECT SUM(gross_profit_usd) as profit, COUNT(*) as cnt
    FROM liquidation_events
    WHERE liquidator = '0xf0570ec48d03171a80ff796dceadf0d385a00004' AND protocol = 'aave_v3'
  `)
  console.log(`\nTop liquidator (0xf0...0004): $${Number(top.rows[0].profit).toFixed(2)} profit, ${top.rows[0].cnt} events`)
  console.log(`Sentora shows: $23,421,541.28 profit, 955 events`)

  await pool.end()
}

main().catch(e => {
  console.error("Fatal:", e)
  pool.end().finally(() => process.exit(1))
})
