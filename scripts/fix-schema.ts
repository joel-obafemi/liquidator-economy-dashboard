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
  // Wipe and recreate with BIGINT log_index
  await pool.query("DROP TABLE IF EXISTS liquidation_events")
  await pool.query("UPDATE scan_state SET last_scanned_block = 0")

  await pool.query(`
    CREATE TABLE liquidation_events (
      id SERIAL PRIMARY KEY,
      protocol TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index BIGINT NOT NULL DEFAULT 0,
      block_number BIGINT NOT NULL,
      block_timestamp BIGINT NOT NULL,
      liquidator TEXT NOT NULL,
      borrower TEXT NOT NULL,
      collateral_asset TEXT NOT NULL,
      debt_asset TEXT NOT NULL,
      collateral_symbol TEXT NOT NULL,
      debt_symbol TEXT NOT NULL,
      debt_to_cover NUMERIC NOT NULL,
      liquidated_collateral_amount NUMERIC NOT NULL,
      receive_a_token BOOLEAN DEFAULT false,
      debt_amount_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      collateral_amount_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      gross_profit_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      UNIQUE (tx_hash, log_index)
    )
  `)

  // Recreate indexes
  const indexes = [
    "CREATE INDEX idx_liq_protocol ON liquidation_events(protocol)",
    "CREATE INDEX idx_liq_block ON liquidation_events(block_number)",
    "CREATE INDEX idx_liq_timestamp ON liquidation_events(block_timestamp)",
    "CREATE INDEX idx_liq_liquidator ON liquidation_events(liquidator)",
    "CREATE INDEX idx_liq_borrower ON liquidation_events(borrower)",
    "CREATE INDEX idx_liq_collateral_asset ON liquidation_events(collateral_asset)",
    "CREATE INDEX idx_liq_debt_asset ON liquidation_events(debt_asset)",
    "CREATE INDEX idx_liq_gross_profit ON liquidation_events(gross_profit_usd)",
  ]
  for (const idx of indexes) {
    await pool.query(idx)
  }

  console.log("Schema fixed: log_index is now BIGINT, table recreated")
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
