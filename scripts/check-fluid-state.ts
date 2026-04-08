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
  const state = await pool.query(`SELECT scanner_name, last_scanned_block FROM scan_state WHERE scanner_name LIKE 'fluid%' OR scanner_name LIKE 'morpho%'`)
  console.log("scan_state:")
  for (const r of state.rows) console.log(`  ${r.scanner_name}: ${r.last_scanned_block}`)

  const vaults = await pool.query(`SELECT COUNT(*) as c, COUNT(*) FILTER (WHERE resolved) as resolved FROM fluid_vaults`)
  console.log(`\nfluid_vaults: total=${vaults.rows[0].c}, resolved=${vaults.rows[0].resolved}`)

  const events = await pool.query(`SELECT protocol, COUNT(*) as c FROM liquidation_events GROUP BY protocol ORDER BY protocol`)
  console.log(`\nEvent counts:`)
  for (const r of events.rows) console.log(`  ${r.protocol}: ${r.c}`)

  // Look at a few resolved vaults
  const sample = await pool.query(`SELECT address, supply_symbol, borrow_symbol, supply_decimals, borrow_decimals, vault_id FROM fluid_vaults WHERE resolved = true ORDER BY vault_id LIMIT 10`)
  console.log(`\nSample resolved vaults:`)
  for (const r of sample.rows) {
    console.log(`  id=${r.vault_id} ${r.address}: ${r.supply_symbol}/${r.borrow_symbol} (${r.supply_decimals}d/${r.borrow_decimals}d)`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
