/**
 * Repair Morpho rows that were inserted with buggy decimals for wUSDL
 * and with phantom negative gross profit when a price was missing on
 * one side of the pair.
 *
 * Two fixes:
 * 1. wUSDL had decimals=6 in the DB but the contract stores amounts at
 *    18 decimals. All rows touching wUSDL have debt/coll USD values
 *    inflated by 1e12. We recompute them from the raw amounts.
 * 2. Rows where either coll_usd or debt_usd was 0 (price missing) had
 *    a garbage gross_profit (usually negative). We zero those out.
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

const WUSDL = "0x7751e2f4b8ae93ef6b79d86419d42fe3295a4559"

async function main() {
  console.log("=== Morpho repair ===\n")

  // 1. Update token_metadata to reflect the correct wUSDL decimals
  console.log("1. Fixing wUSDL decimals in token_metadata...")
  const updateMeta = await pool.query(
    `UPDATE token_metadata SET decimals = 18 WHERE address = $1 AND decimals != 18`,
    [WUSDL]
  )
  console.log(`   Rows updated: ${updateMeta.rowCount}\n`)

  // 2. Find all Morpho events where wUSDL is either collateral or debt
  const wusdlEvents = await pool.query(
    `SELECT id, collateral_asset, debt_asset,
            liquidated_collateral_amount::text as raw_coll,
            debt_to_cover::text as raw_debt,
            bad_debt_assets::text as raw_bad_debt,
            collateral_amount_usd, debt_amount_usd, gross_profit_usd
     FROM liquidation_events
     WHERE protocol = 'morpho_blue'
       AND (collateral_asset = $1 OR debt_asset = $1)`,
    [WUSDL]
  )
  console.log(`2. Found ${wusdlEvents.rows.length} Morpho events involving wUSDL`)

  // For each row, we know it was computed with decimals=6, so the raw amount
  // was divided by 1e6 instead of 1e18 — inflating the USD value by 1e12.
  // We can undo it by dividing the affected USD value by 1e12.
  let fixed = 0
  for (const r of wusdlEvents.rows) {
    let newColl = Number(r.collateral_amount_usd)
    let newDebt = Number(r.debt_amount_usd)
    if (r.collateral_asset === WUSDL) {
      newColl = newColl / 1e12
    }
    if (r.debt_asset === WUSDL) {
      newDebt = newDebt / 1e12
    }
    const newProfit = newColl - newDebt
    await pool.query(
      `UPDATE liquidation_events
       SET collateral_amount_usd = $1, debt_amount_usd = $2, gross_profit_usd = $3,
           net_profit_usd = $3 - COALESCE(gas_cost_usd, 0)
       WHERE id = $4`,
      [newColl, newDebt, newProfit, r.id]
    )
    fixed++
  }
  console.log(`   Recomputed USD values for ${fixed} events\n`)

  // 3. Zero out rows where either side is zero (missing price)
  console.log("3. Zeroing out events with missing prices...")
  const zeroed = await pool.query(`
    UPDATE liquidation_events
    SET collateral_amount_usd = 0,
        debt_amount_usd = 0,
        gross_profit_usd = 0,
        net_profit_usd = 0 - COALESCE(gas_cost_usd, 0)
    WHERE protocol = 'morpho_blue'
      AND (
        (collateral_amount_usd = 0 AND debt_amount_usd > 0) OR
        (collateral_amount_usd > 0 AND debt_amount_usd = 0) OR
        gross_profit_usd < -1000000  -- any remaining huge-negative outlier
      )
  `)
  console.log(`   Rows zeroed: ${zeroed.rowCount}\n`)

  // 4. Report post-repair stats
  const stats = await pool.query(`
    SELECT COUNT(*) as c,
           SUM(gross_profit_usd) as profit,
           SUM(collateral_amount_usd) as volume,
           SUM(bad_debt_usd) as bad_debt,
           COUNT(*) FILTER (WHERE collateral_amount_usd = 0 OR debt_amount_usd = 0) as zero_price,
           COUNT(*) FILTER (WHERE gross_profit_usd < 0) as still_negative,
           MIN(gross_profit_usd) as min_profit,
           COUNT(DISTINCT liquidator) as liquidators
    FROM liquidation_events WHERE protocol = 'morpho_blue'
  `)
  const r = stats.rows[0]
  console.log("=== Morpho Blue after repair ===")
  console.log(`  Total events: ${r.c}`)
  console.log(`  Volume: $${Number(r.volume).toFixed(2)}`)
  console.log(`  Gross profit: $${Number(r.profit).toFixed(2)}`)
  console.log(`  Bad debt: $${Number(r.bad_debt).toFixed(2)}`)
  console.log(`  Zero-price events: ${r.zero_price}`)
  console.log(`  Still-negative events: ${r.still_negative}`)
  console.log(`  Worst gross profit: $${Number(r.min_profit).toFixed(2)}`)
  console.log(`  Liquidators: ${r.liquidators}`)

  // 5. Top 5 liquidators on Morpho
  console.log("\nTop 5 Morpho liquidators:")
  const top = await pool.query(`
    SELECT liquidator, COUNT(*) as cnt, SUM(gross_profit_usd) as profit
    FROM liquidation_events WHERE protocol = 'morpho_blue'
    GROUP BY liquidator ORDER BY profit DESC LIMIT 5
  `)
  for (const t of top.rows) {
    console.log(`  ${t.liquidator}: ${t.cnt} events, $${Number(t.profit).toFixed(2)}`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
