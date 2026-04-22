/**
 * Add flash loan detection columns to liquidation_events.
 *
 * Run with: npx tsx -r tsconfig-paths/register scripts/add-flash-loan-columns.ts
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
  console.log("=== Adding Flash Loan Columns ===\n")

  // Add is_flash_loan boolean column
  await pool.query(`
    ALTER TABLE liquidation_events
    ADD COLUMN IF NOT EXISTS is_flash_loan BOOLEAN DEFAULT false
  `)
  console.log("  ✓ is_flash_loan column added")

  // Add flash_loan_source (e.g. "aave_v2", "aave_v3", "balancer", "uniswap_v3", "maker")
  await pool.query(`
    ALTER TABLE liquidation_events
    ADD COLUMN IF NOT EXISTS flash_loan_source TEXT
  `)
  console.log("  ✓ flash_loan_source column added")

  // Add index for flash loan queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_liq_flash_loan ON liquidation_events(is_flash_loan) WHERE is_flash_loan = true
  `)
  console.log("  ✓ Flash loan index created")

  console.log("\n=== Done ===")
  await pool.end()
}

main().catch((e) => {
  console.error("Fatal:", e)
  pool.end().finally(() => process.exit(1))
})
