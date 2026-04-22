/**
 * Build liquidator clusters from funding source data.
 *
 * Groups liquidator wallets by their shared funding source (who sent
 * the first ETH) or deployer address. Wallets funded by the same address
 * are likely operated by the same entity.
 *
 * Run with: npx tsx -r tsconfig-paths/register scripts/build-clusters.ts
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

// Known CEX/operator labels
const KNOWN_LABELS: Record<string, string> = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance 14",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance 15",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance 16",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance 17",
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance 18",
  "0x4976a4a02f38326660d17bf34b431dc6e2eb2327": "Binance 19",
  "0x46340b20830761efd32832a74d7169b29feb9758": "Binance 20",
  "0xd24400ae8bfebb18ca49be86258a3c749cf46853": "Gemini 1",
  "0x07ee55aa48bb72dcc6e9d78256648910de513eca": "OKX",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX 2",
  "0xa910f92acdaf488fa6ef02174fb86208ad7722ba": "OKX 3",
  "0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5": "Binance Hot Wallet",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance 8",
  "0x5a52e96bacdabb82fd05763e25335261b270efcb": "Binance 19",
  "0x40b38765696e3d5d8d9d834d8aad4bb6e418e489": "Robinhood",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
}

async function main() {
  console.log("=== Building Liquidator Clusters ===\n")

  // 1. Get all distinct liquidators with their stats
  console.log("  Fetching liquidator stats...")
  const liquidatorStats = await pool.query(`
    SELECT
      liquidator,
      COUNT(*)::int as event_count,
      COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
      COALESCE(SUM(gross_profit_usd), 0) as total_profit,
      array_agg(DISTINCT protocol) as protocols
    FROM liquidation_events
    GROUP BY liquidator
  `)
  console.log(`  Found ${liquidatorStats.rows.length} distinct liquidators`)

  // Build a stats map
  const statsMap = new Map<string, {
    eventCount: number; totalVolume: number; totalProfit: number; protocols: string[]
  }>()
  for (const r of liquidatorStats.rows) {
    statsMap.set(r.liquidator.toLowerCase(), {
      eventCount: Number(r.event_count),
      totalVolume: Number(r.total_volume),
      totalProfit: Number(r.total_profit),
      protocols: r.protocols || [],
    })
  }

  // 2. Get all cached funding sources
  console.log("  Fetching funding source data...")
  const fundingSources = await pool.query(`
    SELECT liquidator, from_address, from_label, kind
    FROM funding_source_cache
    WHERE from_address IS NOT NULL
  `)
  console.log(`  Found ${fundingSources.rows.length} cached funding sources`)

  // 3. Group liquidators by funding source
  const fundingGroups = new Map<string, {
    liquidators: string[]
    kind: string
    label: string | null
  }>()

  for (const r of fundingSources.rows) {
    const liq = r.liquidator.toLowerCase()
    const funder = r.from_address.toLowerCase()

    // Skip if this liquidator has no events in our database
    if (!statsMap.has(liq)) continue

    if (!fundingGroups.has(funder)) {
      fundingGroups.set(funder, {
        liquidators: [],
        kind: r.kind || "funding",
        label: r.from_label || KNOWN_LABELS[funder] || null,
      })
    }
    fundingGroups.get(funder)!.liquidators.push(liq)
  }

  // 4. Filter to only groups with 2+ members (actual clusters)
  const clusters: Array<{
    fundingSource: string
    fundingLabel: string | null
    members: string[]
  }> = []

  for (const [funder, group] of fundingGroups) {
    if (group.liquidators.length >= 2) {
      clusters.push({
        fundingSource: funder,
        fundingLabel: group.label,
        members: group.liquidators,
      })
    }
  }

  console.log(`\n  Found ${clusters.length} clusters (2+ members)`)
  console.log(`  Total clustered liquidators: ${clusters.reduce((s, c) => s + c.members.length, 0)}`)

  // 5. Clear existing cluster data and rebuild
  console.log("\n  Rebuilding cluster tables...")
  await pool.query("DELETE FROM liquidator_cluster_members")
  await pool.query("DELETE FROM liquidator_clusters")
  await pool.query("ALTER SEQUENCE liquidator_clusters_cluster_id_seq RESTART WITH 1")

  // 6. Insert clusters
  for (const cluster of clusters) {
    // Aggregate stats across all members
    let totalProfit = 0
    let totalVolume = 0
    let totalEvents = 0
    const allProtocols = new Set<string>()

    for (const member of cluster.members) {
      const stats = statsMap.get(member)
      if (stats) {
        totalProfit += stats.totalProfit
        totalVolume += stats.totalVolume
        totalEvents += stats.eventCount
        stats.protocols.forEach((p) => allProtocols.add(p))
      }
    }

    // Generate a label
    let label = cluster.fundingLabel
      ? `${cluster.fundingLabel} Cluster`
      : `Operator ${cluster.fundingSource.slice(0, 8)}...${cluster.fundingSource.slice(-4)}`

    // Insert cluster
    const result = await pool.query(
      `INSERT INTO liquidator_clusters
        (cluster_label, funding_source, funding_label, member_count, total_profit, total_volume, total_events, protocols)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING cluster_id`,
      [
        label,
        cluster.fundingSource,
        cluster.fundingLabel,
        cluster.members.length,
        totalProfit,
        totalVolume,
        totalEvents,
        Array.from(allProtocols),
      ]
    )
    const clusterId = result.rows[0].cluster_id

    // Insert members
    for (const member of cluster.members) {
      const stats = statsMap.get(member)
      await pool.query(
        `INSERT INTO liquidator_cluster_members
          (liquidator, cluster_id, membership_reason, individual_profit, individual_volume, individual_events)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (liquidator) DO UPDATE SET
           cluster_id = EXCLUDED.cluster_id,
           membership_reason = EXCLUDED.membership_reason,
           individual_profit = EXCLUDED.individual_profit,
           individual_volume = EXCLUDED.individual_volume,
           individual_events = EXCLUDED.individual_events`,
        [
          member,
          clusterId,
          "funding_source",
          stats?.totalProfit || 0,
          stats?.totalVolume || 0,
          stats?.eventCount || 0,
        ]
      )
    }
  }

  // 7. Summary
  const clusterCount = await pool.query("SELECT COUNT(*)::int as cnt FROM liquidator_clusters")
  const memberCount = await pool.query("SELECT COUNT(*)::int as cnt FROM liquidator_cluster_members")
  const topClusters = await pool.query(`
    SELECT cluster_label, member_count, total_profit, total_volume, total_events
    FROM liquidator_clusters
    ORDER BY total_profit DESC
    LIMIT 10
  `)

  console.log(`\n=== Cluster Build Complete ===`)
  console.log(`  Total clusters: ${clusterCount.rows[0].cnt}`)
  console.log(`  Total clustered addresses: ${memberCount.rows[0].cnt}`)
  console.log(`\n  Top 10 clusters by profit:`)
  for (const c of topClusters.rows) {
    console.log(`    ${c.cluster_label}: ${c.member_count} wallets, $${Number(c.total_profit).toFixed(0)} profit, ${c.total_events} events`)
  }

  await pool.end()
}

main().catch((e) => {
  console.error("Fatal:", e)
  pool.end().finally(() => process.exit(1))
})
