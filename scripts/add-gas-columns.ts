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
  console.log("Adding gas cost columns...")

  await pool.query(`ALTER TABLE liquidation_events ADD COLUMN IF NOT EXISTS gas_used BIGINT`)
  await pool.query(`ALTER TABLE liquidation_events ADD COLUMN IF NOT EXISTS gas_price_gwei DOUBLE PRECISION`)
  await pool.query(`ALTER TABLE liquidation_events ADD COLUMN IF NOT EXISTS gas_cost_eth DOUBLE PRECISION DEFAULT 0`)
  await pool.query(`ALTER TABLE liquidation_events ADD COLUMN IF NOT EXISTS gas_cost_usd DOUBLE PRECISION DEFAULT 0`)
  await pool.query(`ALTER TABLE liquidation_events ADD COLUMN IF NOT EXISTS net_profit_usd DOUBLE PRECISION DEFAULT 0`)

  console.log("Columns added.")

  // Check current state
  const count = await pool.query("SELECT COUNT(*) as c FROM liquidation_events")
  const noGas = await pool.query("SELECT COUNT(*) as c FROM liquidation_events WHERE gas_used IS NULL")
  console.log(`Total events: ${count.rows[0].c}, missing gas data: ${noGas.rows[0].c}`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
