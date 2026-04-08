/**
 * Seed the database with the schema.
 * Run with: npm run seed
 */
import { Pool } from "@neondatabase/serverless"
import * as fs from "fs"
import * as path from "path"

// Load .env.local
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required")
  process.exit(1)
}

const dbUrl = process.env.DATABASE_URL.replace(/&?channel_binding=[^&]*/g, "")
const pool = new Pool({ connectionString: dbUrl })

async function main() {
  console.log("=== Seeding Liquidator Economy Database ===\n")

  const schemaPath = path.resolve(__dirname, "../lib/schema.sql")
  const schemaSql = fs.readFileSync(schemaPath, "utf8")

  // Split by semicolons and execute each statement
  const statements = schemaSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    try {
      await pool.query(stmt)
      const preview = stmt.slice(0, 60).replace(/\n/g, " ")
      console.log(`  OK: ${preview}...`)
    } catch (e: any) {
      const preview = stmt.slice(0, 60).replace(/\n/g, " ")
      console.warn(`  WARN: ${preview}... — ${e?.message?.slice(0, 80)}`)
    }
  }

  // Verify tables
  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `)
  console.log("\nTables in database:")
  for (const row of tables.rows) {
    console.log(`  - ${row.table_name}`)
  }

  console.log("\nSeed complete!")
  await pool.end()
}

main().catch((e) => {
  console.error("Fatal:", e)
  pool.end().finally(() => process.exit(1))
})
