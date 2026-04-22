import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const protocol = url.searchParams.get("protocol")
    const liquidator = url.searchParams.get("liquidator")
    const borrower = url.searchParams.get("borrower")
    const collateralSymbol = url.searchParams.get("collateral")
    const debtSymbol = url.searchParams.get("debt")
    const period = url.searchParams.get("period") || "all"
    const sort = url.searchParams.get("sort") || "block_timestamp"
    const order = url.searchParams.get("order") || "DESC"
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"))
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")))
    const offset = (page - 1) * limit

    // Build WHERE clauses
    const conditions: string[] = []
    const params: any[] = []
    let paramIdx = 0

    if (protocol && protocol !== "all") {
      paramIdx++
      conditions.push(`protocol = $${paramIdx}`)
      params.push(protocol)
    }
    if (liquidator) {
      paramIdx++
      conditions.push(`liquidator = $${paramIdx}`)
      params.push(liquidator.toLowerCase())
    }
    if (borrower) {
      paramIdx++
      conditions.push(`borrower = $${paramIdx}`)
      params.push(borrower.toLowerCase())
    }
    if (collateralSymbol) {
      paramIdx++
      conditions.push(`collateral_symbol = $${paramIdx}`)
      params.push(collateralSymbol)
    }
    if (debtSymbol) {
      paramIdx++
      conditions.push(`debt_symbol = $${paramIdx}`)
      params.push(debtSymbol)
    }

    // Time filter
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

    // Validate sort column
    const allowedSorts = ["block_timestamp", "collateral_amount_usd", "debt_amount_usd", "gross_profit_usd", "block_number"]
    const safeSort = allowedSorts.includes(sort) ? sort : "block_timestamp"
    const safeOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC"

    // Get count
    const countResult = await rawSql(
      `SELECT COUNT(*)::int as total FROM liquidation_events ${where}`,
      params
    )
    const total = countResult[0]?.total || 0

    // Get rows
    paramIdx++
    const limitParam = paramIdx
    paramIdx++
    const offsetParam = paramIdx

    const rows = await rawSql(
      `SELECT id, protocol, tx_hash, log_index, block_number, block_timestamp,
              liquidator, borrower, collateral_asset, debt_asset,
              collateral_symbol, debt_symbol,
              debt_amount_usd, collateral_amount_usd, gross_profit_usd,
              is_flash_loan, flash_loan_source
       FROM liquidation_events ${where}
       ORDER BY ${safeSort} ${safeOrder}
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset]
    )

    return NextResponse.json({
      events: rows.map((r: any) => ({
        id: r.id,
        protocol: r.protocol,
        txHash: r.tx_hash,
        logIndex: r.log_index,
        blockNumber: Number(r.block_number),
        blockTimestamp: Number(r.block_timestamp),
        liquidator: r.liquidator,
        borrower: r.borrower,
        collateralAsset: r.collateral_asset,
        debtAsset: r.debt_asset,
        collateralSymbol: r.collateral_symbol,
        debtSymbol: r.debt_symbol,
        debtAmountUsd: Number(r.debt_amount_usd),
        collateralAmountUsd: Number(r.collateral_amount_usd),
        grossProfitUsd: Number(r.gross_profit_usd),
        isFlashLoan: r.is_flash_loan || false,
        flashLoanSource: r.flash_loan_source || null,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    })
  } catch (e: any) {
    console.error("Liquidations API error:", e)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
