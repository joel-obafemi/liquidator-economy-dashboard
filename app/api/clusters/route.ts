import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const sort = url.searchParams.get("sort") || "total_profit"
    const order = url.searchParams.get("order") || "DESC"
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"))
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")))
    const offset = (page - 1) * limit

    const allowedSorts = ["total_profit", "total_volume", "total_events", "member_count"]
    const safeSort = allowedSorts.includes(sort) ? sort : "total_profit"
    const safeOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC"

    const countResult = await rawSql(
      "SELECT COUNT(*)::int as total FROM liquidator_clusters"
    )
    const total = countResult[0]?.total || 0

    const clusters = await rawSql(
      `SELECT
        c.cluster_id,
        c.cluster_label,
        c.funding_source,
        c.funding_label,
        c.member_count,
        c.total_profit,
        c.total_volume,
        c.total_events,
        c.protocols
      FROM liquidator_clusters c
      ORDER BY ${safeSort} ${safeOrder}
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    )

    // Get global totals for percentage calculation
    const globalTotals = await rawSql(
      `SELECT
        COALESCE(SUM(gross_profit_usd), 0) as total_profit,
        COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
        COUNT(*)::int as total_events,
        COUNT(DISTINCT liquidator)::int as total_liquidators
      FROM liquidation_events`
    )
    const gp = globalTotals[0]

    // Summary stats
    const clusterSummary = await rawSql(`
      SELECT
        COUNT(*)::int as cluster_count,
        SUM(member_count)::int as clustered_addresses,
        COALESCE(SUM(total_profit), 0) as clustered_profit,
        COALESCE(SUM(total_volume), 0) as clustered_volume,
        SUM(total_events)::int as clustered_events
      FROM liquidator_clusters
    `)
    const cs = clusterSummary[0]

    return NextResponse.json({
      clusters: clusters.map((c: any, idx: number) => ({
        rank: offset + idx + 1,
        clusterId: c.cluster_id,
        clusterLabel: c.cluster_label,
        fundingSource: c.funding_source,
        fundingLabel: c.funding_label,
        memberCount: Number(c.member_count),
        totalProfit: Number(c.total_profit),
        totalVolume: Number(c.total_volume),
        totalEvents: Number(c.total_events),
        protocols: c.protocols || [],
        profitShare: Number(gp.total_profit) > 0
          ? (Number(c.total_profit) / Number(gp.total_profit)) * 100
          : 0,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      summary: {
        clusterCount: Number(cs.cluster_count),
        clusteredAddresses: Number(cs.clustered_addresses),
        totalLiquidators: Number(gp.total_liquidators),
        clusteredProfit: Number(cs.clustered_profit),
        clusteredVolume: Number(cs.clustered_volume),
        clusteredEvents: Number(cs.clustered_events),
        globalProfit: Number(gp.total_profit),
        globalVolume: Number(gp.total_volume),
        globalEvents: Number(gp.total_events),
      },
    })
  } catch (e: any) {
    console.error("Clusters API error:", e)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
