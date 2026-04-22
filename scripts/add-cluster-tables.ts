/**
 * Schema migration: Add bot clustering tables.
 *
 * Run with: npx tsx -r tsconfig-paths/register scripts/add-cluster-tables.ts
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
  console.log("=== Adding Cluster Tables ===\n")

  await pool.query(`
    CREATE TABLE IF NOT EXISTS liquidator_clusters (
      cluster_id SERIAL PRIMARY KEY,
      cluster_label TEXT,
      funding_source TEXT,
      funding_label TEXT,
      member_count INTEGER DEFAULT 0,
      total_profit DOUBLE PRECISION DEFAULT 0,
      total_volume DOUBLE PRECISION DEFAULT 0,
      total_events INTEGER DEFAULT 0,
      protocols TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `)
  console.log("  ✓ liquidator_clusters table created")

  await pool.query(`
    CREATE TABLE IF NOT EXISTS liquidator_cluster_members (
      liquidator TEXT PRIMARY KEY,
      cluster_id INTEGER NOT NULL REFERENCES liquidator_clusters(cluster_id) ON DELETE CASCADE,
      membership_reason TEXT DEFAULT 'funding_source',
      individual_profit DOUBLE PRECISION DEFAULT 0,
      individual_volume DOUBLE PRECISION DEFAULT 0,
      individual_events INTEGER DEFAULT 0,
      added_at TIMESTAMPTZ DEFAULT now()
    );
  `)
  console.log("  ✓ liquidator_cluster_members table created")

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON liquidator_cluster_members(cluster_id);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_clusters_profit ON liquidator_clusters(total_profit DESC);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_clusters_funding ON liquidator_clusters(funding_source);
  `)
  console.log("  ✓ Indexes created")

  console.log("\n=== Done ===")
  await pool.end()
}

main().catch((e) => {
  console.error("Fatal:", e)
  pool.end().finally(() => process.exit(1))
})
