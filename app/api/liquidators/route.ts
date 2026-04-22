import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const protocol = url.searchParams.get("protocol")
    const period = url.searchParams.get("period") || "all"
    const sort = url.searchParams.get("sort") || "total_gross_profit"
    const order = url.searchParams.get("order") || "DESC"
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"))
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")))
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: any[] = []
    let paramIdx = 0

    if (protocol && protocol !== "all") {
      paramIdx++
      conditions.push(`protocol = $${paramIdx}`)
      params.push(protocol)
    }

    if (period !== "all") {
      const now = Math.floor(Date.now() / 1000)
      let tsFilter = 0
      switch (period) {
        case "7d": tsFilter = now - 7 * 86400; break
        case "30d": tsFilter = now - 30 * 86400; break
        case "90d": tsFilter = now - 90 * 86400; break
        case "365d": tsFilter = now - 365 * 86400; break
      }
      if (tsFilter > 0) {
        paramIdx++
        conditions.push(`block_timestamp >= $${paramIdx}`)
        params.push(tsFilter)
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    const allowedSorts = ["total_gross_profit", "liquidation_count", "total_volume", "total_debt_repaid", "last_active"]
    const safeSort = allowedSorts.includes(sort) ? sort : "total_gross_profit"
    const safeOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC"

    // Get total unique liquidators
    const countResult = await rawSql(
      `SELECT COUNT(DISTINCT liquidator)::int as total FROM liquidation_events ${where}`,
      params
    )
    const total = countResult[0]?.total || 0

    paramIdx++
    const limitParam = paramIdx
    paramIdx++
    const offsetParam = paramIdx

    const rows = await rawSql(
      `SELECT
        liquidator,
        COUNT(*)::int as liquidation_count,
        COALESCE(SUM(debt_amount_usd), 0) as total_debt_repaid,
        COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
        COALESCE(SUM(gross_profit_usd), 0) as total_gross_profit,
        MAX(block_timestamp) as last_active,
        array_agg(DISTINCT protocol) as protocols,
        COUNT(*) FILTER (WHERE is_flash_loan = true)::int as flash_count
      FROM liquidation_events ${where}
      GROUP BY liquidator
      ORDER BY ${safeSort} ${safeOrder}
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset]
    )

    // Get total profit for percentage calculation
    const totalProfitResult = await rawSql(
      `SELECT COALESCE(SUM(gross_profit_usd), 0) as total FROM liquidation_events ${where}`,
      params.slice(0, paramIdx - 2) // exclude limit/offset params
    )
    const totalProfit = Number(totalProfitResult[0]?.total || 0)

    return NextResponse.json({
      liquidators: rows.map((r: any, idx: number) => ({
        rank: offset + idx + 1,
        liquidator: r.liquidator,
        liquidationCount: Number(r.liquidation_count),
        totalDebtRepaid: Number(r.total_debt_repaid),
        totalVolume: Number(r.total_volume),
        totalGrossProfit: Number(r.total_gross_profit),
        profitShare: totalProfit > 0 ? (Number(r.total_gross_profit) / totalProfit) * 100 : 0,
        lastActive: Number(r.last_active),
        protocols: r.protocols || [],
        flashLoanCount: Number(r.flash_count || 0),
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    })
  } catch (e: any) {
    console.error("Liquidators API error:", e)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
