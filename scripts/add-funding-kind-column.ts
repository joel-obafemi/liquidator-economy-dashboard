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
  await pool.query(`ALTER TABLE funding_source_cache ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'funding'`)
  // Clear stale null rows so the new logic reruns
  await pool.query(`DELETE FROM funding_source_cache WHERE from_address IS NULL OR from_address = ''`)
  console.log("kind column added, stale rows cleared")
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
