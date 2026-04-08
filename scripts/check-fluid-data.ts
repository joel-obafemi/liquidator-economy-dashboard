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
  const r = await pool.query(`
    SELECT COUNT(*) as c,
           SUM(gross_profit_usd) as profit,
           SUM(collateral_amount_usd) as volume,
           COUNT(*) FILTER (WHERE collateral_amount_usd = 0 OR debt_amount_usd = 0) as zero_price,
           COUNT(*) FILTER (WHERE gross_profit_usd < -1000) as big_negative,
           MIN(gross_profit_usd) as min_profit,
           MAX(gross_profit_usd) as max_profit,
           COUNT(DISTINCT liquidator) as liquidators,
           COUNT(DISTINCT borrower) as borrowers
    FROM liquidation_events WHERE protocol = 'fluid'
  `)
  const s = r.rows[0]
  console.log("=== Fluid data quality ===")
  console.log(`  Events: ${s.c}`)
  console.log(`  Volume: $${Number(s.volume).toFixed(2)}`)
  console.log(`  Gross profit: $${Number(s.profit).toFixed(2)}`)
  console.log(`  Liquidators: ${s.liquidators}`)
  console.log(`  Borrowers (recipients): ${s.borrowers}`)
  console.log(`  Zero-price events: ${s.zero_price}`)
  console.log(`  Big-negative events (< -$1000): ${s.big_negative}`)
  console.log(`  Max profit: $${Number(s.max_profit).toFixed(2)}`)
  console.log(`  Min profit: $${Number(s.min_profit).toFixed(2)}`)

  // Top 10 liquidators
  console.log("\nTop 10 Fluid liquidators:")
  const top = await pool.query(`
    SELECT liquidator, COUNT(*) as cnt, SUM(gross_profit_usd) as profit
    FROM liquidation_events WHERE protocol = 'fluid'
    GROUP BY liquidator ORDER BY profit DESC LIMIT 10
  `)
  for (const t of top.rows) {
    console.log(`  ${t.liquidator}: ${t.cnt} events, $${Number(t.profit).toFixed(2)}`)
  }

  // Top pairs
  console.log("\nTop 10 Fluid pairs by volume:")
  const pairs = await pool.query(`
    SELECT collateral_symbol, debt_symbol, COUNT(*) as c, SUM(collateral_amount_usd) as vol
    FROM liquidation_events WHERE protocol = 'fluid'
    GROUP BY collateral_symbol, debt_symbol
    ORDER BY vol DESC LIMIT 10
  `)
  for (const p of pairs.rows) {
    console.log(`  ${p.collateral_symbol}/${p.debt_symbol}: ${p.c} events, $${Number(p.vol).toFixed(2)}`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
