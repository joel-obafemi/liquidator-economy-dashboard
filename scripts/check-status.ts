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
  const total = await pool.query("SELECT COUNT(*) as c FROM liquidation_events")
  const withGas = await pool.query("SELECT COUNT(*) as c FROM liquidation_events WHERE gas_used IS NOT NULL")
  const noGas = await pool.query("SELECT COUNT(*) as c FROM liquidation_events WHERE gas_used IS NULL")
  const scan = await pool.query("SELECT * FROM scan_state")

  console.log("=== Database Status ===")
  console.log(`Total events: ${total.rows[0].c}`)
  console.log(`With gas data: ${withGas.rows[0].c}`)
  console.log(`Missing gas data: ${noGas.rows[0].c}`)
  console.log(`\nScan state:`)
  for (const row of scan.rows) {
    console.log(`  ${row.scanner_name}: block ${row.last_scanned_block}`)
  }
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
