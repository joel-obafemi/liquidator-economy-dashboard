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
  const result = await pool.query(`
    SELECT
      protocol,
      COUNT(*)::int as total_events,
      COUNT(gas_used)::int as with_gas,
      COUNT(*) FILTER (WHERE gas_used IS NULL)::int as without_gas,
      ROUND(COUNT(gas_used)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as coverage_pct
    FROM liquidation_events
    GROUP BY protocol
    ORDER BY protocol
  `)
  console.log("\n=== Gas Coverage by Protocol ===")
  console.table(result.rows)

  const totals = await pool.query(`
    SELECT
      COUNT(*)::int as total,
      COUNT(gas_used)::int as with_gas,
      COUNT(*) FILTER (WHERE gas_used IS NULL)::int as without_gas,
      ROUND(COUNT(gas_used)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as coverage_pct
    FROM liquidation_events
  `)
  console.log("\n=== Overall Totals ===")
  console.table(totals.rows)

  // Check a sample of Morpho/Fluid events to see if they have tx_hash
  const sample = await pool.query(`
    SELECT protocol, tx_hash, block_number, gas_used, gas_price_gwei
    FROM liquidation_events
    WHERE protocol IN ('morpho_blue', 'fluid')
    ORDER BY block_number DESC
    LIMIT 5
  `)
  console.log("\n=== Sample Morpho/Fluid events ===")
  console.table(sample.rows)

  await pool.end()
}
main().catch(e => { console.error(e); pool.end() })
