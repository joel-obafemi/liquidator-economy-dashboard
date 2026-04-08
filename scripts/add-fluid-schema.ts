/**
 * Schema migration for Fluid Protocol support.
 *  - fluid_vaults cache table (vault address, tokens, decimals, vault id, type)
 *  - scan_state rows:
 *      * fluid_discovery — tracks how far we've scanned the factory for NewPositionMinted
 *      * fluid            — tracks how far we've scanned for liquidations across all vaults
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
  console.log("=== Fluid Schema Migration ===\n")

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fluid_vaults (
      address TEXT PRIMARY KEY,
      supply_token TEXT,
      borrow_token TEXT,
      supply_decimals INTEGER,
      borrow_decimals INTEGER,
      supply_symbol TEXT,
      borrow_symbol TEXT,
      vault_id NUMERIC,
      resolved BOOLEAN DEFAULT false,  -- false if constantsView() failed or smart-col/debt
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  console.log("✓ fluid_vaults table")

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fluid_vaults_resolved ON fluid_vaults(resolved)`)

  // Register both scanner rows in scan_state
  await pool.query(`
    INSERT INTO scan_state (scanner_name, last_scanned_block)
    VALUES ('fluid_discovery', 0), ('fluid', 0)
    ON CONFLICT DO NOTHING
  `)
  console.log("✓ scan_state entries (fluid_discovery, fluid)")

  // Verify
  const vaultCount = await pool.query("SELECT COUNT(*) as c FROM fluid_vaults")
  console.log(`\nfluid_vaults has ${vaultCount.rows[0].c} rows`)

  const scanners = await pool.query(`SELECT scanner_name, last_scanned_block FROM scan_state ORDER BY scanner_name`)
  console.log(`\nscan_state:`)
  for (const s of scanners.rows) console.log(`  ${s.scanner_name}: ${s.last_scanned_block}`)

  console.log("\n✓ Migration complete")
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
