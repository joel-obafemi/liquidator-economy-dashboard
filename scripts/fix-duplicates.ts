/**
 * Fix duplicate liquidation events caused by log_index overflow.
 *
 * Problem: Some events have log_index values like 4294967294 (uint32 overflow)
 * which means multiple logs from the same tx get different overflow values,
 * bypassing our UNIQUE(tx_hash, log_index) constraint.
 *
 * Solution: For each tx_hash with multiple entries, keep only truly unique
 * events based on (tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover).
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

async function main() {
  console.log("=== Fixing Duplicate Events ===\n")

  // 1. Count current state
  const before = await pool.query("SELECT COUNT(*) as c FROM liquidation_events")
  console.log(`Events before: ${before.rows[0].c}`)

  // 2. Find duplicate tx_hashes
  const dupes = await pool.query(`
    SELECT tx_hash, COUNT(*) as cnt
    FROM liquidation_events
    GROUP BY tx_hash
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `)
  console.log(`Tx hashes with multiple entries: ${dupes.rows.length}`)

  // Some are legitimate (multiple positions liquidated in one tx)
  // vs duplicates (same event indexed multiple times with different log_index)
  // Distinguish by checking if (tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover) is unique

  const trueDupes = await pool.query(`
    SELECT tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover::text as dtc, COUNT(*) as cnt
    FROM liquidation_events
    GROUP BY tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `)
  console.log(`True duplicate groups (same tx + same params): ${trueDupes.rows.length}`)

  let totalDupesRemoved = 0
  for (const d of trueDupes.rows) {
    const extra = Number(d.cnt) - 1 // keep 1, delete the rest
    totalDupesRemoved += extra
  }
  console.log(`Total duplicate rows to remove: ${totalDupesRemoved}`)

  if (totalDupesRemoved === 0) {
    console.log("No duplicates found!")
    await pool.end()
    return
  }

  // Show some examples
  console.log(`\nExamples of duplicates:`)
  for (const d of trueDupes.rows.slice(0, 5)) {
    console.log(`  tx=${d.tx_hash.slice(0,10)} ${d.cnt}x - borrower=${d.borrower.slice(0,10)}`)
  }

  // 3. Delete duplicates - keep the row with the lowest id for each group
  console.log(`\nDeleting duplicates...`)
  const deleteResult = await pool.query(`
    DELETE FROM liquidation_events
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM liquidation_events
      GROUP BY tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover
    )
  `)
  console.log(`Deleted: ${deleteResult.rowCount} rows`)

  // 4. Count after
  const after = await pool.query("SELECT COUNT(*) as c FROM liquidation_events")
  console.log(`Events after: ${after.rows[0].c}`)
  console.log(`Removed: ${Number(before.rows[0].c) - Number(after.rows[0].c)} duplicates`)

  // 5. Now fix the unique constraint to prevent future duplicates
  // Drop old constraint and add a better one
  console.log(`\nUpdating unique constraint...`)
  try {
    await pool.query(`DROP INDEX IF EXISTS liquidation_events_tx_hash_log_index_key`)
  } catch {}
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS liquidation_events_unique_event
      ON liquidation_events (tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover)
    `)
    console.log("New unique constraint created on (tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover)")
  } catch (e: any) {
    console.warn("Constraint creation warning:", e?.message?.slice(0, 100))
  }

  // 6. Updated stats
  const stats = await pool.query(`
    SELECT protocol, COUNT(*) as cnt, SUM(gross_profit_usd) as profit
    FROM liquidation_events
    GROUP BY protocol
  `)
  console.log(`\nAfter dedup:`)
  for (const s of stats.rows) {
    console.log(`  ${s.protocol}: ${s.cnt} events, $${Number(s.profit).toFixed(2)} profit`)
  }

  // 7. Re-check 0x00...0e49
  const addr = "0x00000000009e50a7ddb7a7b0e2ee6604fd120e49"
  const check = await pool.query(`
    SELECT COUNT(*) as cnt, SUM(gross_profit_usd) as profit
    FROM liquidation_events WHERE liquidator = $1 AND protocol = 'aave_v3'
  `, [addr])
  console.log(`\n0x00...0e49 after dedup:`)
  console.log(`  Events: ${check.rows[0].cnt} (Sentora: 3036)`)
  console.log(`  Profit: $${Number(check.rows[0].profit).toFixed(2)} (Sentora: $7,089,523.67)`)

  // 8. Re-check 0xf0...0004
  const addr2 = "0xf0570ec48d03171a80ff796dceadf0d385a00004"
  const check2 = await pool.query(`
    SELECT COUNT(*) as cnt, SUM(gross_profit_usd) as profit
    FROM liquidation_events WHERE liquidator = $1 AND protocol = 'aave_v3'
  `, [addr2])
  console.log(`\n0xf0...0004 after dedup:`)
  console.log(`  Events: ${check2.rows[0].cnt} (Sentora: 955)`)
  console.log(`  Profit: $${Number(check2.rows[0].profit).toFixed(2)} (Sentora: $23,421,541.28)`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
