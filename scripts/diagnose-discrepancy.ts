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
  console.log("=== Diagnosing Data Discrepancies ===\n")

  // 1. Check 0x00...0e49 specifically
  const addr = "0x00000000009e50a7ddb7a7b0e2ee6604fd120e49"
  const stats = await pool.query(`
    SELECT COUNT(*) as cnt, SUM(gross_profit_usd) as profit,
           SUM(collateral_amount_usd) as coll_usd, SUM(debt_amount_usd) as debt_usd,
           MIN(block_number) as min_block, MAX(block_number) as max_block
    FROM liquidation_events WHERE liquidator = $1 AND protocol = 'aave_v3'
  `, [addr])
  const s = stats.rows[0]
  console.log(`0x00...0e49:`)
  console.log(`  Our events: ${s.cnt}, Sentora: 3036`)
  console.log(`  Our profit: $${Number(s.profit).toFixed(2)}, Sentora: $7,089,523.67`)
  console.log(`  Our coll USD: $${Number(s.coll_usd).toFixed(2)}`)
  console.log(`  Our debt USD: $${Number(s.debt_usd).toFixed(2)}`)
  console.log(`  Block range: ${s.min_block} - ${s.max_block}`)

  // 2. Check for duplicate tx_hashes
  const dupes = await pool.query(`
    SELECT tx_hash, COUNT(*) as cnt FROM liquidation_events
    WHERE liquidator = $1 AND protocol = 'aave_v3'
    GROUP BY tx_hash HAVING COUNT(*) > 1
    ORDER BY cnt DESC LIMIT 10
  `, [addr])
  console.log(`\n  Duplicate tx_hashes: ${dupes.rows.length}`)
  for (const d of dupes.rows.slice(0, 3)) {
    console.log(`    ${d.tx_hash}: ${d.cnt} entries`)
  }

  // 3. Check total Aave V3 events vs Sentora
  // Sentora shows specific event counts per liquidator that sum to a total
  const totalEvents = await pool.query(`
    SELECT COUNT(*) as c FROM liquidation_events WHERE protocol = 'aave_v3'
  `)
  const sentoraTotal = 955 + 3036 + 370 + 1307 + 291 + 154 + 223 + 1045 + 109 + 175
  console.log(`\nTotal Aave V3 events: ${totalEvents.rows[0].c}`)
  console.log(`Sentora top 10 sum: ${sentoraTotal} (their total is likely higher)`)

  // 4. Check for suspiciously large profit events
  const largeProfit = await pool.query(`
    SELECT tx_hash, block_number, collateral_symbol, debt_symbol,
           collateral_amount_usd, debt_amount_usd, gross_profit_usd,
           liquidated_collateral_amount::text as raw_coll,
           debt_to_cover::text as raw_debt
    FROM liquidation_events
    WHERE liquidator = $1 AND protocol = 'aave_v3'
    ORDER BY gross_profit_usd DESC
    LIMIT 10
  `, [addr])
  console.log(`\n  Top 10 events by profit for 0x00...0e49:`)
  for (const r of largeProfit.rows) {
    console.log(`    tx=${r.tx_hash.slice(0,10)} block=${r.block_number} ${r.collateral_symbol}/${r.debt_symbol}`)
    console.log(`      coll_usd=$${Number(r.collateral_amount_usd).toFixed(2)} debt_usd=$${Number(r.debt_amount_usd).toFixed(2)} profit=$${Number(r.gross_profit_usd).toFixed(2)}`)
    console.log(`      raw_coll=${r.raw_coll.length > 30 ? r.raw_coll.slice(0,30)+'...' : r.raw_coll} raw_debt=${r.raw_debt.length > 30 ? r.raw_debt.slice(0,30)+'...' : r.raw_debt}`)
  }

  // 5. Check token decimals for common tokens
  const tokens = await pool.query(`SELECT address, symbol, decimals FROM token_metadata ORDER BY symbol`)
  console.log(`\n  Token decimals:`)
  for (const t of tokens.rows) {
    console.log(`    ${t.symbol.padEnd(10)} ${t.address} = ${t.decimals} decimals`)
  }

  // 6. Spot check: take one event, manually verify the math
  const sample = await pool.query(`
    SELECT id, tx_hash, block_timestamp, collateral_asset, debt_asset,
           collateral_symbol, debt_symbol,
           liquidated_collateral_amount::text as raw_coll,
           debt_to_cover::text as raw_debt,
           collateral_amount_usd, debt_amount_usd, gross_profit_usd
    FROM liquidation_events
    WHERE liquidator = $1 AND protocol = 'aave_v3'
      AND collateral_amount_usd > 0 AND debt_amount_usd > 0
    ORDER BY collateral_amount_usd DESC
    LIMIT 3
  `, [addr])
  console.log(`\n  Manual verification of top events:`)
  for (const r of sample.rows) {
    const collDecimals = tokens.rows.find((t: any) => t.address === r.collateral_asset)?.decimals ?? '??'
    const debtDecimals = tokens.rows.find((t: any) => t.address === r.debt_asset)?.decimals ?? '??'

    const collHuman = Number(BigInt(r.raw_coll)) / (10 ** Number(collDecimals))
    const debtHuman = Number(BigInt(r.raw_debt)) / (10 ** Number(debtDecimals))
    const collPriceImplied = Number(r.collateral_amount_usd) / collHuman
    const debtPriceImplied = Number(r.debt_amount_usd) / debtHuman

    console.log(`    tx=${r.tx_hash.slice(0,10)} ${r.collateral_symbol}(${collDecimals}d)/${r.debt_symbol}(${debtDecimals}d)`)
    console.log(`      raw_coll=${r.raw_coll} -> ${collHuman.toFixed(6)} tokens`)
    console.log(`      raw_debt=${r.raw_debt} -> ${debtHuman.toFixed(6)} tokens`)
    console.log(`      coll_usd=$${Number(r.collateral_amount_usd).toFixed(2)} (implied price: $${collPriceImplied.toFixed(2)})`)
    console.log(`      debt_usd=$${Number(r.debt_amount_usd).toFixed(2)} (implied price: $${debtPriceImplied.toFixed(2)})`)
    console.log(`      profit=$${Number(r.gross_profit_usd).toFixed(2)}`)
  }

  // 7. Check: how many events have negative profit (should be rare for correct data)
  const negProfit = await pool.query(`
    SELECT COUNT(*) as c, SUM(gross_profit_usd) as total
    FROM liquidation_events
    WHERE protocol = 'aave_v3' AND gross_profit_usd < 0
  `)
  console.log(`\n  Events with negative profit: ${negProfit.rows[0].c} (total: $${Number(negProfit.rows[0].total).toFixed(2)})`)

  // 8. Check profit distribution - are there outliers?
  const profitBuckets = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE gross_profit_usd > 100000) as gt_100k,
      COUNT(*) FILTER (WHERE gross_profit_usd > 50000) as gt_50k,
      COUNT(*) FILTER (WHERE gross_profit_usd > 10000) as gt_10k,
      COUNT(*) FILTER (WHERE gross_profit_usd BETWEEN 0 AND 10000) as normal,
      COUNT(*) FILTER (WHERE gross_profit_usd < 0 AND gross_profit_usd > -1000) as small_neg,
      COUNT(*) FILTER (WHERE gross_profit_usd < -1000) as big_neg
    FROM liquidation_events WHERE protocol = 'aave_v3' AND collateral_amount_usd > 0
  `)
  const b = profitBuckets.rows[0]
  console.log(`\n  Profit distribution (events with prices):`)
  console.log(`    > $100K profit: ${b.gt_100k}`)
  console.log(`    > $50K profit:  ${b.gt_50k}`)
  console.log(`    > $10K profit:  ${b.gt_10k}`)
  console.log(`    $0-$10K profit: ${b.normal}`)
  console.log(`    -$1K to $0:     ${b.small_neg}`)
  console.log(`    < -$1K:         ${b.big_neg}`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
