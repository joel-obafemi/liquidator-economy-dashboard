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
  console.log("=== Cross-protocol liquidator analysis ===\n")

  // Per-protocol count
  const perProtocol = await pool.query(`
    SELECT protocol, COUNT(DISTINCT liquidator) as c
    FROM liquidation_events
    GROUP BY protocol
    ORDER BY protocol
  `)
  let sum = 0
  console.log("Per-protocol unique liquidators:")
  for (const r of perProtocol.rows) {
    console.log(`  ${r.protocol}: ${r.c}`)
    sum += Number(r.c)
  }
  console.log(`  SUM (with double-counting): ${sum}`)

  // Truly distinct addresses across all protocols
  const distinct = await pool.query(`
    SELECT COUNT(DISTINCT liquidator) as c FROM liquidation_events
  `)
  console.log(`\nTRULY DISTINCT liquidators: ${distinct.rows[0].c}`)

  // Cross-protocol activity breakdown
  console.log("\nCross-protocol activity breakdown:")
  const breakdown = await pool.query(`
    WITH liquidator_protocols AS (
      SELECT liquidator, ARRAY_AGG(DISTINCT protocol ORDER BY protocol) as protocols
      FROM liquidation_events
      GROUP BY liquidator
    )
    SELECT
      array_length(protocols, 1) as num_protocols,
      COUNT(*)::int as cnt
    FROM liquidator_protocols
    GROUP BY array_length(protocols, 1)
    ORDER BY num_protocols
  `)
  for (const r of breakdown.rows) {
    console.log(`  Active on ${r.num_protocols} protocol(s): ${r.cnt} liquidators`)
  }

  // Distinct borrowers too
  const distinctBorrowers = await pool.query(`
    SELECT COUNT(DISTINCT borrower) as c FROM liquidation_events
  `)
  const sumBorrowers = await pool.query(`
    SELECT SUM(c)::int as total FROM (
      SELECT protocol, COUNT(DISTINCT borrower) as c FROM liquidation_events GROUP BY protocol
    ) sub
  `)
  console.log(`\nDistinct borrowers: ${distinctBorrowers.rows[0].c}`)
  console.log(`Sum-of-protocols borrowers: ${sumBorrowers.rows[0].total}`)

  // Specifically list addresses active on 4 protocols
  console.log("\nLiquidators active on ALL 4 protocols:")
  const all4 = await pool.query(`
    WITH lp AS (
      SELECT liquidator, ARRAY_AGG(DISTINCT protocol ORDER BY protocol) as protocols
      FROM liquidation_events GROUP BY liquidator
    )
    SELECT liquidator, protocols FROM lp WHERE array_length(protocols, 1) = 4
  `)
  for (const r of all4.rows) {
    console.log(`  ${r.liquidator}`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
