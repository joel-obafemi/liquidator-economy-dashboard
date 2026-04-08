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

async function main() {
  // Sentora's top liquidator
  const target = "0xf0570ec48d03171a80ff796dceadf0d385a00004"

  console.log("=== Data Comparison ===\n")

  // 1. Check if this address exists in our data
  const events = await pool.query(
    `SELECT COUNT(*) as c, SUM(gross_profit_usd) as profit, SUM(collateral_amount_usd) as volume
     FROM liquidation_events WHERE liquidator = $1 AND protocol = 'aave_v3'`,
    [target]
  )
  console.log(`Sentora top liquidator (${target}):`)
  console.log(`  Our data: ${events.rows[0].c} events, $${Number(events.rows[0].profit || 0).toFixed(2)} profit, $${Number(events.rows[0].volume || 0).toFixed(2)} volume`)
  console.log(`  Sentora:  955 events, $23,421,541.28 profit`)

  // 2. Our top 10 liquidators on Aave V3
  const top10 = await pool.query(`
    SELECT liquidator, COUNT(*) as cnt,
           SUM(gross_profit_usd) as profit,
           SUM(collateral_amount_usd) as volume
    FROM liquidation_events
    WHERE protocol = 'aave_v3'
    GROUP BY liquidator
    ORDER BY profit DESC
    LIMIT 10
  `)
  console.log("\nOur top 10 Aave V3 liquidators:")
  for (const r of top10.rows) {
    console.log(`  ${r.liquidator}: ${r.cnt} events, $${Number(r.profit).toFixed(2)} profit`)
  }

  // 3. Total Aave V3 stats
  const totals = await pool.query(`
    SELECT COUNT(*) as events,
           SUM(gross_profit_usd) as profit,
           SUM(collateral_amount_usd) as volume,
           COUNT(DISTINCT liquidator) as liquidators,
           MIN(block_number) as min_block,
           MAX(block_number) as max_block,
           MIN(block_timestamp) as min_ts,
           MAX(block_timestamp) as max_ts
    FROM liquidation_events WHERE protocol = 'aave_v3'
  `)
  const t = totals.rows[0]
  console.log("\nAave V3 totals:")
  console.log(`  Events: ${t.events}`)
  console.log(`  Total profit: $${Number(t.profit).toFixed(2)}`)
  console.log(`  Total volume: $${Number(t.volume).toFixed(2)}`)
  console.log(`  Liquidators: ${t.liquidators}`)
  console.log(`  Block range: ${t.min_block} - ${t.max_block}`)
  console.log(`  Date range: ${new Date(Number(t.min_ts) * 1000).toISOString()} - ${new Date(Number(t.max_ts) * 1000).toISOString()}`)

  // 4. Check for events with zero USD values (price enrichment failures)
  const zeroPrices = await pool.query(`
    SELECT COUNT(*) as c FROM liquidation_events
    WHERE protocol = 'aave_v3' AND (collateral_amount_usd = 0 OR debt_amount_usd = 0)
  `)
  console.log(`\nEvents with $0 USD values (price failures): ${zeroPrices.rows[0].c}`)

  // 5. Sample a few events from our top liquidator vs Sentora's top
  const sample = await pool.query(`
    SELECT tx_hash, block_number, collateral_symbol, debt_symbol,
           collateral_amount_usd, debt_amount_usd, gross_profit_usd
    FROM liquidation_events
    WHERE liquidator = $1 AND protocol = 'aave_v3'
    ORDER BY gross_profit_usd DESC
    LIMIT 5
  `, [target])
  if (sample.rows.length > 0) {
    console.log(`\nSample events for ${target}:`)
    for (const r of sample.rows) {
      console.log(`  tx=${r.tx_hash.slice(0,10)}... block=${r.block_number} ${r.collateral_symbol}/${r.debt_symbol} vol=$${Number(r.collateral_amount_usd).toFixed(2)} profit=$${Number(r.gross_profit_usd).toFixed(2)}`)
    }
  }

  // 6. Check per-protocol event counts
  const byCounts = await pool.query(`
    SELECT protocol, COUNT(*) as c FROM liquidation_events GROUP BY protocol
  `)
  console.log("\nEvents by protocol:")
  for (const r of byCounts.rows) {
    console.log(`  ${r.protocol}: ${r.c}`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
