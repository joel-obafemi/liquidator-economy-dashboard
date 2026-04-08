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
  // Biggest negative gross profit events
  console.log("=== Worst gross_profit_usd events (Morpho) ===\n")
  const bad = await pool.query(`
    SELECT tx_hash, block_number, collateral_symbol, debt_symbol,
           collateral_asset, debt_asset,
           collateral_amount_usd, debt_amount_usd, gross_profit_usd,
           liquidated_collateral_amount::text as raw_coll,
           debt_to_cover::text as raw_debt,
           market_id
    FROM liquidation_events
    WHERE protocol = 'morpho_blue'
    ORDER BY gross_profit_usd ASC
    LIMIT 10
  `)
  for (const r of bad.rows) {
    console.log(`tx=${r.tx_hash.slice(0, 12)} block=${r.block_number}`)
    console.log(`  ${r.collateral_symbol} (${r.collateral_asset}) / ${r.debt_symbol} (${r.debt_asset})`)
    console.log(`  coll_usd=$${Number(r.collateral_amount_usd).toExponential(3)}`)
    console.log(`  debt_usd=$${Number(r.debt_amount_usd).toExponential(3)}`)
    console.log(`  gross_profit_usd=$${Number(r.gross_profit_usd).toExponential(3)}`)
    console.log(`  raw_coll=${r.raw_coll} raw_debt=${r.raw_debt}`)
    console.log(`  market=${r.market_id?.slice(0, 12)}...`)
    console.log()
  }

  // Find problematic markets
  console.log("\n=== Markets with huge debt_amount_usd ===\n")
  const markets = await pool.query(`
    SELECT market_id, collateral_symbol, debt_symbol,
           COUNT(*) as events,
           AVG(debt_amount_usd) as avg_debt,
           MAX(debt_amount_usd) as max_debt
    FROM liquidation_events
    WHERE protocol = 'morpho_blue' AND debt_amount_usd > 1e12
    GROUP BY market_id, collateral_symbol, debt_symbol
    ORDER BY max_debt DESC
  `)
  for (const m of markets.rows) {
    console.log(`  ${m.collateral_symbol}/${m.debt_symbol}: ${m.events} events, max $${Number(m.max_debt).toExponential(3)}`)
    console.log(`    market=${m.market_id?.slice(0, 20)}`)
  }

  // Check token decimals for the affected tokens
  console.log("\n=== Token decimals for affected assets ===\n")
  const tokens = await pool.query(`
    SELECT DISTINCT le.debt_asset, le.debt_symbol, tm.decimals
    FROM liquidation_events le
    LEFT JOIN token_metadata tm ON tm.address = le.debt_asset
    WHERE le.protocol = 'morpho_blue' AND le.debt_amount_usd > 1e12
  `)
  for (const t of tokens.rows) {
    console.log(`  ${t.debt_symbol} (${t.debt_asset}): ${t.decimals ?? 'UNKNOWN'} decimals`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
