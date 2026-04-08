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
  const addr = "0xf0570ec48d03171a80ff796dceadf0d385a00004"

  console.log("=== Validating 0xf057...0004 Activity Data ===\n")

  // 1. Overall summary
  const summary = await pool.query(`
    SELECT
      COUNT(*) as total_events,
      COUNT(*) FILTER (WHERE gas_used IS NOT NULL) as with_gas,
      COUNT(*) FILTER (WHERE gas_used IS NULL) as without_gas,
      SUM(gross_profit_usd) as gross,
      SUM(gas_cost_usd) as gas,
      SUM(net_profit_usd) as net,
      AVG(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL) as avg_gas_per_event
    FROM liquidation_events
    WHERE liquidator = $1
  `, [addr])
  const s = summary.rows[0]
  console.log("OVERALL SUMMARY")
  console.log(`  Total events: ${s.total_events}`)
  console.log(`  With gas data: ${s.with_gas}`)
  console.log(`  Without gas data: ${s.without_gas} ← these have $0 gas, inflating net profit`)
  console.log(`  Gross profit: $${Number(s.gross).toFixed(2)}`)
  console.log(`  Gas spent: $${Number(s.gas).toFixed(2)}`)
  console.log(`  Net profit: $${Number(s.net).toFixed(2)}`)
  console.log(`  Avg gas per event (only events with gas data): $${Number(s.avg_gas_per_event).toFixed(2)}`)

  // 2. Specific day: Feb 5, 2026
  console.log("\n\nFEB 5, 2026 DETAIL")
  const day = await pool.query(`
    SELECT
      COUNT(*) as events,
      COUNT(*) FILTER (WHERE gas_used IS NOT NULL) as with_gas,
      COUNT(*) FILTER (WHERE gas_used IS NULL) as without_gas,
      SUM(gross_profit_usd) as gross,
      SUM(gas_cost_usd) as gas,
      SUM(net_profit_usd) as net,
      AVG(gas_price_gwei) FILTER (WHERE gas_used IS NOT NULL) as avg_gwei,
      AVG(gas_used) FILTER (WHERE gas_used IS NOT NULL) as avg_gas_used
    FROM liquidation_events
    WHERE liquidator = $1
      AND TO_CHAR(TO_TIMESTAMP(block_timestamp), 'YYYY-MM-DD') = '2026-02-05'
  `, [addr])
  const d = day.rows[0]
  console.log(`  Events: ${d.events}`)
  console.log(`  With gas data: ${d.with_gas}`)
  console.log(`  Without gas data: ${d.without_gas}`)
  console.log(`  Gross profit: $${Number(d.gross).toFixed(2)}`)
  console.log(`  Gas spent: $${Number(d.gas).toFixed(2)}`)
  console.log(`  Net profit: $${Number(d.net).toFixed(2)}`)
  console.log(`  Avg gas price: ${Number(d.avg_gwei).toFixed(2)} gwei`)
  console.log(`  Avg gas used per tx: ${Number(d.avg_gas_used).toFixed(0)}`)

  // 3. Sample a few events from Feb 5 to spot-check
  console.log("\n\nFEB 5, 2026 SAMPLE EVENTS (top 5 by profit)")
  const sample = await pool.query(`
    SELECT tx_hash, gross_profit_usd, gas_cost_usd, net_profit_usd,
           gas_price_gwei, gas_used
    FROM liquidation_events
    WHERE liquidator = $1
      AND TO_CHAR(TO_TIMESTAMP(block_timestamp), 'YYYY-MM-DD') = '2026-02-05'
    ORDER BY gross_profit_usd DESC
    LIMIT 5
  `, [addr])
  for (const r of sample.rows) {
    console.log(`  tx=${r.tx_hash.slice(0,12)}... gross=$${Number(r.gross_profit_usd).toFixed(2)} gas=$${Number(r.gas_cost_usd || 0).toFixed(2)} net=$${Number(r.net_profit_usd || 0).toFixed(2)} (${Number(r.gas_price_gwei || 0).toFixed(0)} gwei × ${Number(r.gas_used || 0)} = ${(Number(r.gas_price_gwei || 0) * Number(r.gas_used || 0) / 1e9).toFixed(6)} ETH)`)
  }

  // 4. Compare this liquidator to the fleet average
  console.log("\n\nFLEET AVG VS THIS LIQUIDATOR")
  const fleet = await pool.query(`
    SELECT
      AVG(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL) as avg_gas_usd,
      AVG(gas_price_gwei) FILTER (WHERE gas_used IS NOT NULL) as avg_gas_gwei,
      AVG(gas_used) FILTER (WHERE gas_used IS NOT NULL) as avg_gas_used
    FROM liquidation_events
  `)
  console.log(`  Fleet avg gas: $${Number(fleet.rows[0].avg_gas_usd).toFixed(2)} at ${Number(fleet.rows[0].avg_gas_gwei).toFixed(1)} gwei, ${Number(fleet.rows[0].avg_gas_used).toFixed(0)} gas units`)

  const thisBot = await pool.query(`
    SELECT
      AVG(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL) as avg_gas_usd,
      AVG(gas_price_gwei) FILTER (WHERE gas_used IS NOT NULL) as avg_gas_gwei,
      AVG(gas_used) FILTER (WHERE gas_used IS NOT NULL) as avg_gas_used
    FROM liquidation_events
    WHERE liquidator = $1
  `, [addr])
  console.log(`  This bot avg gas: $${Number(thisBot.rows[0].avg_gas_usd).toFixed(2)} at ${Number(thisBot.rows[0].avg_gas_gwei).toFixed(1)} gwei, ${Number(thisBot.rows[0].avg_gas_used).toFixed(0)} gas units`)

  // 5. How many liquidators still have gas data gaps?
  console.log("\n\nGAS DATA COMPLETENESS")
  const gaps = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE gas_used IS NOT NULL) as with_gas,
      COUNT(*) FILTER (WHERE gas_used IS NULL) as without_gas
    FROM liquidation_events
  `)
  const g = gaps.rows[0]
  console.log(`  Total events: ${g.total}`)
  console.log(`  With gas data: ${g.with_gas} (${(Number(g.with_gas) / Number(g.total) * 100).toFixed(1)}%)`)
  console.log(`  Without gas data: ${g.without_gas} (${(Number(g.without_gas) / Number(g.total) * 100).toFixed(1)}%)`)

  // 6. Is the SparkLend liquidator properly capturing gas?
  console.log("\n\nPER PROTOCOL GAS COVERAGE")
  const perProto = await pool.query(`
    SELECT protocol,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE gas_used IS NOT NULL) as with_gas,
      AVG(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL) as avg_gas
    FROM liquidation_events
    GROUP BY protocol
  `)
  for (const r of perProto.rows) {
    console.log(`  ${r.protocol}: ${r.with_gas}/${r.total} have gas data, avg $${Number(r.avg_gas).toFixed(2)}`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
