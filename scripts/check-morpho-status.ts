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
  const events = await pool.query(`
    SELECT COUNT(*) as c,
           SUM(gross_profit_usd) as profit,
           SUM(collateral_amount_usd) as volume,
           SUM(bad_debt_usd) as bad_debt,
           COUNT(*) FILTER (WHERE collateral_amount_usd = 0) as zero_price,
           COUNT(DISTINCT liquidator) as liquidators,
           COUNT(DISTINCT market_id) as markets
    FROM liquidation_events WHERE protocol = 'morpho_blue'
  `)
  const r = events.rows[0]
  console.log("Morpho Blue status:")
  console.log(`  Events: ${r.c}`)
  console.log(`  Volume: $${Number(r.volume).toFixed(2)}`)
  console.log(`  Gross profit: $${Number(r.profit).toFixed(2)}`)
  console.log(`  Bad debt: $${Number(r.bad_debt).toFixed(2)}`)
  console.log(`  Liquidators: ${r.liquidators}`)
  console.log(`  Unique markets: ${r.markets}`)
  console.log(`  Zero-price events: ${r.zero_price}`)

  const scan = await pool.query("SELECT last_scanned_block, updated_at FROM scan_state WHERE scanner_name = 'morpho_blue'")
  const s = scan.rows[0]
  console.log(`\nScan state:`)
  console.log(`  Last scanned block: ${s.last_scanned_block}`)
  console.log(`  Updated: ${s.updated_at}`)

  const markets = await pool.query("SELECT COUNT(*) as c FROM morpho_markets")
  console.log(`\nMarket cache: ${markets.rows[0].c} markets resolved`)

  // Top markets by volume
  const topMarkets = await pool.query(`
    SELECT collateral_symbol, debt_symbol, COUNT(*) as events,
           SUM(collateral_amount_usd) as volume
    FROM liquidation_events
    WHERE protocol = 'morpho_blue'
    GROUP BY collateral_symbol, debt_symbol
    ORDER BY volume DESC
    LIMIT 10
  `)
  console.log(`\nTop 10 Morpho pairs by volume:`)
  for (const m of topMarkets.rows) {
    console.log(`  ${m.collateral_symbol}/${m.debt_symbol}: ${m.events} events, $${Number(m.volume).toFixed(2)}`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
