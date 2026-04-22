import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const clusterId = parseInt(params.id)
    if (isNaN(clusterId)) {
      return NextResponse.json({ error: "Invalid cluster ID" }, { status: 400 })
    }

    // Get cluster info
    const cluster = await rawSql(
      `SELECT * FROM liquidator_clusters WHERE cluster_id = $1`,
      [clusterId]
    )
    if (cluster.length === 0) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 })
    }
    const c = cluster[0]

    // Get members with their individual stats
    const members = await rawSql(
      `SELECT
        m.liquidator,
        m.membership_reason,
        m.individual_profit,
        m.individual_volume,
        m.individual_events,
        array_agg(DISTINCT e.protocol) as protocols,
        MIN(e.block_timestamp) as first_active,
        MAX(e.block_timestamp) as last_active
      FROM liquidator_cluster_members m
      LEFT JOIN liquidation_events e ON e.liquidator = m.liquidator
      WHERE m.cluster_id = $1
      GROUP BY m.liquidator, m.membership_reason, m.individual_profit, m.individual_volume, m.individual_events
      ORDER BY m.individual_profit DESC`,
      [clusterId]
    )

    // Get monthly activity for the cluster (all members combined)
    const monthly = await rawSql(
      `SELECT
        TO_CHAR(TO_TIMESTAMP(e.block_timestamp), 'YYYY-MM') as month,
        COUNT(*)::int as event_count,
        COALESCE(SUM(e.gross_profit_usd), 0) as profit,
        COALESCE(SUM(e.collateral_amount_usd), 0) as volume,
        COUNT(DISTINCT e.liquidator)::int as active_members
      FROM liquidation_events e
      INNER JOIN liquidator_cluster_members m ON m.liquidator = e.liquidator
      WHERE m.cluster_id = $1
      GROUP BY month
      ORDER BY month ASC`,
      [clusterId]
    )

    // Get protocol breakdown
    const protocolBreakdown = await rawSql(
      `SELECT
        e.protocol,
        COUNT(*)::int as event_count,
        COALESCE(SUM(e.collateral_amount_usd), 0) as volume,
        COALESCE(SUM(e.gross_profit_usd), 0) as profit,
        COUNT(DISTINCT e.liquidator)::int as members_active
      FROM liquidation_events e
      INNER JOIN liquidator_cluster_members m ON m.liquidator = e.liquidator
      WHERE m.cluster_id = $1
      GROUP BY e.protocol
      ORDER BY profit DESC`,
      [clusterId]
    )

    // Get top collateral assets
    const topAssets = await rawSql(
      `SELECT
        e.collateral_symbol,
        COUNT(*)::int as event_count,
        COALESCE(SUM(e.collateral_amount_usd), 0) as volume,
        COALESCE(SUM(e.gross_profit_usd), 0) as profit
      FROM liquidation_events e
      INNER JOIN liquidator_cluster_members m ON m.liquidator = e.liquidator
      WHERE m.cluster_id = $1
      GROUP BY e.collateral_symbol
      ORDER BY volume DESC
      LIMIT 10`,
      [clusterId]
    )

    return NextResponse.json({
      cluster: {
        clusterId: c.cluster_id,
        clusterLabel: c.cluster_label,
        fundingSource: c.funding_source,
        fundingLabel: c.funding_label,
        memberCount: Number(c.member_count),
        totalProfit: Number(c.total_profit),
        totalVolume: Number(c.total_volume),
        totalEvents: Number(c.total_events),
        protocols: c.protocols || [],
      },
      members: members.map((m: any) => ({
        liquidator: m.liquidator,
        membershipReason: m.membership_reason,
        individualProfit: Number(m.individual_profit),
        individualVolume: Number(m.individual_volume),
        individualEvents: Number(m.individual_events),
        protocols: m.protocols?.filter(Boolean) || [],
        firstActive: Number(m.first_active),
        lastActive: Number(m.last_active),
      })),
      monthly: monthly.map((m: any) => ({
        month: m.month,
        eventCount: Number(m.event_count),
        profit: Number(m.profit),
        volume: Number(m.volume),
        activeMembers: Number(m.active_members),
      })),
      protocolBreakdown: protocolBreakdown.map((p: any) => ({
        protocol: p.protocol,
        eventCount: Number(p.event_count),
        volume: Number(p.volume),
        profit: Number(p.profit),
        membersActive: Number(p.members_active),
      })),
      topAssets: topAssets.map((a: any) => ({
        symbol: a.collateral_symbol,
        eventCount: Number(a.event_count),
        volume: Number(a.volume),
        profit: Number(a.profit),
      })),
    })
  } catch (e: any) {
    console.error("Cluster detail API error:", e)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
