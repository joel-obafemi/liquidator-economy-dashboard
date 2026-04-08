/**
 * Schema migration for Morpho Blue support:
 *  - morpho_markets cache table
 *  - market_id + bad_debt_usd columns on liquidation_events
 *  - scan_state row for morpho_blue
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
  console.log("=== Morpho Schema Migration ===\n")

  // 1. Market cache table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS morpho_markets (
      id TEXT PRIMARY KEY,                -- bytes32 market id (hex string)
      loan_token TEXT NOT NULL,
      collateral_token TEXT NOT NULL,
      oracle TEXT NOT NULL,
      irm TEXT NOT NULL,
      lltv NUMERIC NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  console.log("✓ morpho_markets table")

  // 2. Add market_id column to liquidation_events (Morpho-specific)
  await pool.query(`ALTER TABLE liquidation_events ADD COLUMN IF NOT EXISTS market_id TEXT`)
  console.log("✓ liquidation_events.market_id")

  // 3. Add bad_debt columns for Morpho (Aave/Spark can't have bad debt)
  await pool.query(`ALTER TABLE liquidation_events ADD COLUMN IF NOT EXISTS bad_debt_assets NUMERIC`)
  await pool.query(`ALTER TABLE liquidation_events ADD COLUMN IF NOT EXISTS bad_debt_usd DOUBLE PRECISION DEFAULT 0`)
  console.log("✓ liquidation_events.bad_debt_*")

  // 4. Register morpho_blue in scan_state
  await pool.query(`
    INSERT INTO scan_state (scanner_name, last_scanned_block)
    VALUES ('morpho_blue', 0)
    ON CONFLICT DO NOTHING
  `)
  console.log("✓ scan_state entry")

  // Verify
  const cols = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'liquidation_events' AND column_name IN ('market_id', 'bad_debt_assets', 'bad_debt_usd')
    ORDER BY column_name
  `)
  console.log("\nVerification:")
  for (const c of cols.rows) console.log(`  ${c.column_name}: ${c.data_type}`)

  const scanners = await pool.query(`SELECT scanner_name, last_scanned_block FROM scan_state ORDER BY scanner_name`)
  console.log("\nscan_state:")
  for (const s of scanners.rows) console.log(`  ${s.scanner_name}: ${s.last_scanned_block}`)

  console.log("\n✓ Migration complete")
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
