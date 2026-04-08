import { NextResponse } from "next/server"
import { sql, rawSql } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const protocol = url.searchParams.get("protocol") || "all"
    const period = url.searchParams.get("period") || "all"

    // Calculate timestamp filter
    let tsFilter = 0
    const now = Math.floor(Date.now() / 1000)
    switch (period) {
      case "7d": tsFilter = now - 7 * 86400; break
      case "30d": tsFilter = now - 30 * 86400; break
      case "90d": tsFilter = now - 90 * 86400; break
      case "365d": tsFilter = now - 365 * 86400; break
    }

    // Aggregate stats
    const statsQuery = `
      SELECT
        protocol,
        COUNT(*)::int as total_events,
        COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
        COALESCE(SUM(gross_profit_usd), 0) as total_gross_profit,
        COUNT(DISTINCT liquidator)::int as unique_liquidators,
        COUNT(DISTINCT borrower)::int as unique_borrowers
      FROM liquidation_events
      WHERE block_timestamp >= $1
        ${protocol !== "all" ? "AND protocol = $2" : ""}
      GROUP BY protocol
    `
    const statsParams = protocol !== "all" ? [tsFilter, protocol] : [tsFilter]
    const stats = await rawSql(statsQuery, statsParams)

    // Cross-protocol distinct totals — counting an address that's active on
    // multiple protocols only ONCE. Aggregating per-protocol counts naively
    // would double-count cross-protocol operators (15 of which are active
    // on all 4 protocols).
    const distinctQuery = `
      SELECT
        COUNT(*)::int as total_events,
        COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
        COALESCE(SUM(gross_profit_usd), 0) as total_gross_profit,
        COUNT(DISTINCT liquidator)::int as unique_liquidators,
        COUNT(DISTINCT borrower)::int as unique_borrowers
      FROM liquidation_events
      WHERE block_timestamp >= $1
        ${protocol !== "all" ? "AND protocol = $2" : ""}
    `
    const distinctRows = await rawSql(distinctQuery, statsParams)
    const distinct = distinctRows[0] || {
      total_events: 0,
      total_volume: 0,
      total_gross_profit: 0,
      unique_liquidators: 0,
      unique_borrowers: 0,
    }

    // Monthly volume for chart
    const monthlyQuery = `
      SELECT
        TO_CHAR(TO_TIMESTAMP(block_timestamp), 'YYYY-MM') as month,
        protocol,
        COALESCE(SUM(collateral_amount_usd), 0) as volume,
        COUNT(*)::int as count,
        COALESCE(SUM(gross_profit_usd), 0) as profit
      FROM liquidation_events
      WHERE block_timestamp >= $1
        ${protocol !== "all" ? "AND protocol = $2" : ""}
      GROUP BY month, protocol
      ORDER BY month ASC
    `
    const monthly = await rawSql(monthlyQuery, statsParams)

    // Top 5 liquidators
    const top5Query = `
      SELECT
        liquidator,
        COUNT(*)::int as count,
        COALESCE(SUM(gross_profit_usd), 0) as total_profit,
        COALESCE(SUM(collateral_amount_usd), 0) as total_volume
      FROM liquidation_events
      WHERE block_timestamp >= $1
        ${protocol !== "all" ? "AND protocol = $2" : ""}
      GROUP BY liquidator
      ORDER BY total_profit DESC
      LIMIT 5
    `
    const top5 = await rawSql(top5Query, statsParams)

    // Recent large liquidations
    const recentQuery = `
      SELECT tx_hash, protocol, liquidator, borrower,
             collateral_symbol, debt_symbol,
             collateral_amount_usd, debt_amount_usd, gross_profit_usd,
             block_timestamp
      FROM liquidation_events
      WHERE block_timestamp >= $1
        ${protocol !== "all" ? "AND protocol = $2" : ""}
      ORDER BY collateral_amount_usd DESC
      LIMIT 10
    `
    const recentLarge = await rawSql(recentQuery, statsParams)

    return NextResponse.json({
      stats: stats.map((r: any) => ({
        protocol: r.protocol,
        totalEvents: Number(r.total_events),
        totalVolume: Number(r.total_volume),
        totalGrossProfit: Number(r.total_gross_profit),
        uniqueLiquidators: Number(r.unique_liquidators),
        uniqueBorrowers: Number(r.unique_borrowers),
      })),
      // Pre-aggregated distinct counts so the UI doesn't double-count
      // cross-protocol operators.
      totals: {
        totalEvents: Number(distinct.total_events),
        totalVolume: Number(distinct.total_volume),
        totalGrossProfit: Number(distinct.total_gross_profit),
        uniqueLiquidators: Number(distinct.unique_liquidators),
        uniqueBorrowers: Number(distinct.unique_borrowers),
      },
      monthly: monthly.map((r: any) => ({
        month: r.month,
        protocol: r.protocol,
        volume: Number(r.volume),
        count: Number(r.count),
        profit: Number(r.profit),
      })),
      top5: top5.map((r: any) => ({
        liquidator: r.liquidator,
        count: Number(r.count),
        totalProfit: Number(r.total_profit),
        totalVolume: Number(r.total_volume),
      })),
      recentLarge: recentLarge.map((r: any) => ({
        txHash: r.tx_hash,
        protocol: r.protocol,
        liquidator: r.liquidator,
        borrower: r.borrower,
        collateralSymbol: r.collateral_symbol,
        debtSymbol: r.debt_symbol,
        collateralAmountUsd: Number(r.collateral_amount_usd),
        debtAmountUsd: Number(r.debt_amount_usd),
        grossProfitUsd: Number(r.gross_profit_usd),
        blockTimestamp: Number(r.block_timestamp),
      })),
    })
  } catch (e: any) {
    console.error("Overview API error:", e)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
