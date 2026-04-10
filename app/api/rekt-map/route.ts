import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"

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

    const protocolClause = protocol !== "all" ? "AND protocol = $2" : ""
    const params = protocol !== "all" ? [tsFilter, protocol] : [tsFilter]

    // Daily liquidation aggregates + ETH prices via CTEs
    const query = `
      WITH daily_liq AS (
        SELECT
          DATE(TO_TIMESTAMP(block_timestamp)) as day,
          COUNT(*)::int as event_count,
          COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
          COALESCE(SUM(gross_profit_usd), 0) as total_gross_profit,
          MAX(collateral_amount_usd) as biggest_liquidation,
          COUNT(DISTINCT liquidator)::int as unique_liquidators,
          COUNT(DISTINCT borrower)::int as unique_borrowers,
          (ARRAY_AGG(protocol ORDER BY collateral_amount_usd DESC NULLS LAST))[1] as top_protocol
        FROM liquidation_events
        WHERE block_timestamp >= $1
          ${protocolClause}
        GROUP BY DATE(TO_TIMESTAMP(block_timestamp))
      ),
      daily_eth AS (
        SELECT
          DATE(TO_TIMESTAMP(timestamp)) as day,
          AVG(price_usd) as eth_price
        FROM price_cache
        WHERE LOWER(token_address) = LOWER('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
        GROUP BY DATE(TO_TIMESTAMP(timestamp))
      ),
      ranked AS (
        SELECT
          l.*,
          e.eth_price,
          ROW_NUMBER() OVER (ORDER BY l.total_volume DESC) as rekt_rank
        FROM daily_liq l
        LEFT JOIN daily_eth e ON l.day = e.day
      )
      SELECT
        day,
        event_count,
        total_volume,
        total_gross_profit,
        biggest_liquidation,
        unique_liquidators,
        unique_borrowers,
        top_protocol,
        eth_price,
        rekt_rank,
        CASE WHEN rekt_rank <= 10 THEN true ELSE false END as is_top_rekt
      FROM ranked
      ORDER BY day ASC
    `

    const rows = await rawSql(query, params)

    // Map rows to response objects
    const daily = rows.map((r: any) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      eventCount: Number(r.event_count),
      totalVolume: Number(r.total_volume),
      totalGrossProfit: Number(r.total_gross_profit),
      biggestLiquidation: Number(r.biggest_liquidation),
      uniqueLiquidators: Number(r.unique_liquidators),
      uniqueBorrowers: Number(r.unique_borrowers),
      topProtocol: r.top_protocol,
      ethPrice: r.eth_price != null ? Number(r.eth_price) : null,
      isTopRekt: r.is_top_rekt === true || r.is_top_rekt === "true" || r.is_top_rekt === "t",
      rektRank: Number(r.rekt_rank),
    }))

    // Build ETH price lookup for day-over-day change calculation
    const ethByDay = new Map<string, number>()
    for (const d of daily) {
      if (d.ethPrice != null) ethByDay.set(d.day, d.ethPrice)
    }

    // Extract top 10 rekt days with ETH price change
    const topRektDays = daily
      .filter((d: any) => d.isTopRekt)
      .sort((a: any, b: any) => a.rektRank - b.rektRank)
      .map((d: any) => {
        // Find previous day's ETH price for % change
        const dayDate = new Date(d.day)
        const prevDay = new Date(dayDate)
        prevDay.setDate(prevDay.getDate() - 1)
        const prevDayStr = prevDay.toISOString().slice(0, 10)
        const prevPrice = ethByDay.get(prevDayStr)
        const ethPriceChange =
          d.ethPrice != null && prevPrice != null
            ? ((d.ethPrice - prevPrice) / prevPrice) * 100
            : null

        return {
          day: d.day,
          eventCount: d.eventCount,
          totalVolume: d.totalVolume,
          totalGrossProfit: d.totalGrossProfit,
          biggestLiquidation: d.biggestLiquidation,
          uniqueLiquidators: d.uniqueLiquidators,
          uniqueBorrowers: d.uniqueBorrowers,
          topProtocol: d.topProtocol,
          ethPrice: d.ethPrice,
          ethPriceChange,
          rektRank: d.rektRank,
        }
      })

    // Summary stats
    const totalDays = daily.length
    const totalVolume = daily.reduce((s: number, d: any) => s + d.totalVolume, 0)
    const totalEvents = daily.reduce((s: number, d: any) => s + d.eventCount, 0)

    return NextResponse.json({
      daily,
      topRektDays,
      summary: {
        totalDays,
        totalVolume,
        totalEvents,
        avgDailyVolume: totalDays > 0 ? totalVolume / totalDays : 0,
        maxDailyVolume: totalDays > 0 ? Math.max(...daily.map((d: any) => d.totalVolume)) : 0,
      },
    })
  } catch (e: any) {
    console.error("Rekt Map API error:", e)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
