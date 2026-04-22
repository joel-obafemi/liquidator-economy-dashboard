import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"
import { getFundingSource } from "@/lib/funding-source"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  try {
    const address = params.address.toLowerCase()

    // Summary stats with gas/net profit
    const summaryRows = await rawSql(
      `SELECT
        COUNT(*)::int as total_count,
        COALESCE(SUM(debt_amount_usd), 0) as total_debt_repaid,
        COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
        COALESCE(SUM(gross_profit_usd), 0) as total_profit,
        COALESCE(SUM(gas_cost_usd), 0) as total_gas_usd,
        COALESCE(SUM(gas_cost_eth), 0) as total_gas_eth,
        COALESCE(SUM(net_profit_usd), 0) as total_net_profit,
        AVG(gross_profit_usd) as avg_profit,
        AVG(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL) as avg_gas_usd,
        COUNT(*) FILTER (WHERE gas_used IS NOT NULL)::int as events_with_gas,
        COUNT(*) FILTER (WHERE net_profit_usd >= 0 AND gas_used IS NOT NULL)::int as profitable_count,
        COUNT(*) FILTER (WHERE net_profit_usd < 0 AND gas_used IS NOT NULL)::int as unprofitable_count,
        MIN(block_timestamp) as first_active,
        MAX(block_timestamp) as last_active,
        COUNT(DISTINCT borrower)::int as unique_borrowers,
        array_agg(DISTINCT protocol) as protocols,
        COUNT(*) FILTER (WHERE is_flash_loan = true)::int as flash_loan_count,
        COALESCE(SUM(collateral_amount_usd) FILTER (WHERE is_flash_loan = true), 0) as flash_loan_volume,
        COALESCE(SUM(gross_profit_usd) FILTER (WHERE is_flash_loan = true), 0) as flash_loan_profit,
        array_agg(DISTINCT flash_loan_source) FILTER (WHERE is_flash_loan = true) as flash_loan_sources
      FROM liquidation_events
      WHERE liquidator = $1`,
      [address]
    )
    const summary = summaryRows[0]

    if (!summary || Number(summary.total_count) === 0) {
      return NextResponse.json({ error: "Liquidator not found" }, { status: 404 })
    }

    // Per-protocol breakdown
    const byProtocol = await rawSql(
      `SELECT
        protocol,
        COUNT(*)::int as count,
        COALESCE(SUM(collateral_amount_usd), 0) as volume,
        COALESCE(SUM(gross_profit_usd), 0) as gross_profit,
        COALESCE(SUM(net_profit_usd), 0) as net_profit,
        COALESCE(SUM(gas_cost_usd), 0) as gas_usd
      FROM liquidation_events
      WHERE liquidator = $1
      GROUP BY protocol
      ORDER BY gross_profit DESC`,
      [address]
    )

    // Daily activity timeline with gas + net profit
    const daily = await rawSql(
      `SELECT
        TO_CHAR(TO_TIMESTAMP(block_timestamp), 'YYYY-MM-DD') as day,
        COUNT(*)::int as count,
        COALESCE(SUM(gross_profit_usd), 0) as profit,
        COALESCE(SUM(gas_cost_usd), 0) as gas_usd,
        COALESCE(SUM(net_profit_usd), 0) as net_profit
      FROM liquidation_events
      WHERE liquidator = $1
      GROUP BY day
      ORDER BY day ASC`,
      [address]
    )

    // Monthly profit time series (with net profit)
    const monthly = await rawSql(
      `SELECT
        TO_CHAR(TO_TIMESTAMP(block_timestamp), 'YYYY-MM') as month,
        protocol,
        COUNT(*)::int as count,
        COALESCE(SUM(gross_profit_usd), 0) as profit,
        COALESCE(SUM(net_profit_usd), 0) as net_profit,
        COALESCE(SUM(collateral_amount_usd), 0) as volume,
        COALESCE(SUM(gas_cost_usd), 0) as gas_usd
      FROM liquidation_events
      WHERE liquidator = $1
      GROUP BY month, protocol
      ORDER BY month ASC`,
      [address]
    )

    // Asset breakdown - collateral
    const collateralBreakdown = await rawSql(
      `SELECT collateral_symbol as symbol,
              COUNT(*)::int as count,
              COALESCE(SUM(collateral_amount_usd), 0) as volume,
              COALESCE(SUM(gross_profit_usd), 0) as profit
       FROM liquidation_events
       WHERE liquidator = $1
       GROUP BY collateral_symbol
       ORDER BY volume DESC
       LIMIT 12`,
      [address]
    )

    // Asset breakdown - debt
    const debtBreakdown = await rawSql(
      `SELECT debt_symbol as symbol,
              COUNT(*)::int as count,
              COALESCE(SUM(debt_amount_usd), 0) as volume
       FROM liquidation_events
       WHERE liquidator = $1
       GROUP BY debt_symbol
       ORDER BY volume DESC
       LIMIT 12`,
      [address]
    )

    // Recent events with full details
    const recentEvents = await rawSql(
      `SELECT tx_hash, protocol, borrower,
              collateral_symbol, debt_symbol,
              collateral_amount_usd, debt_amount_usd, gross_profit_usd,
              gas_cost_usd, net_profit_usd, gas_price_gwei, gas_used,
              is_flash_loan, flash_loan_source,
              block_timestamp, block_number
       FROM liquidation_events
       WHERE liquidator = $1
       ORDER BY block_timestamp DESC
       LIMIT 100`,
      [address]
    )

    // Funding source (slow — fetched async, may return null)
    let fundingSource = null
    try {
      fundingSource = await getFundingSource(address)
    } catch {
      // Non-fatal — funding source is enrichment
    }

    return NextResponse.json({
      address,
      summary: {
        totalCount: Number(summary.total_count),
        totalDebtRepaid: Number(summary.total_debt_repaid),
        totalVolume: Number(summary.total_volume),
        totalProfit: Number(summary.total_profit),
        totalGasUsd: Number(summary.total_gas_usd),
        totalGasEth: Number(summary.total_gas_eth),
        totalNetProfit: Number(summary.total_net_profit),
        avgProfit: Number(summary.avg_profit),
        avgGasUsd: Number(summary.avg_gas_usd || 0),
        eventsWithGas: Number(summary.events_with_gas),
        profitableCount: Number(summary.profitable_count),
        unprofitableCount: Number(summary.unprofitable_count),
        firstActive: Number(summary.first_active),
        lastActive: Number(summary.last_active),
        uniqueBorrowers: Number(summary.unique_borrowers),
        protocols: summary.protocols || [],
        flashLoanCount: Number(summary.flash_loan_count || 0),
        flashLoanVolume: Number(summary.flash_loan_volume || 0),
        flashLoanProfit: Number(summary.flash_loan_profit || 0),
        flashLoanSources: (summary.flash_loan_sources || []).filter(Boolean),
      },
      byProtocol: byProtocol.map((r: any) => ({
        protocol: r.protocol,
        count: Number(r.count),
        volume: Number(r.volume),
        grossProfit: Number(r.gross_profit),
        netProfit: Number(r.net_profit),
        gasUsd: Number(r.gas_usd),
      })),
      daily: daily.map((r: any) => ({
        day: r.day,
        count: Number(r.count),
        profit: Number(r.profit),
        gasUsd: Number(r.gas_usd),
        netProfit: Number(r.net_profit),
      })),
      monthly: monthly.map((r: any) => ({
        month: r.month,
        protocol: r.protocol,
        count: Number(r.count),
        profit: Number(r.profit),
        netProfit: Number(r.net_profit),
        volume: Number(r.volume),
        gasUsd: Number(r.gas_usd),
      })),
      collateralBreakdown: collateralBreakdown.map((r: any) => ({
        symbol: r.symbol,
        count: Number(r.count),
        volume: Number(r.volume),
        profit: Number(r.profit),
      })),
      debtBreakdown: debtBreakdown.map((r: any) => ({
        symbol: r.symbol,
        count: Number(r.count),
        volume: Number(r.volume),
      })),
      recentEvents: recentEvents.map((r: any) => ({
        txHash: r.tx_hash,
        protocol: r.protocol,
        borrower: r.borrower,
        collateralSymbol: r.collateral_symbol,
        debtSymbol: r.debt_symbol,
        collateralAmountUsd: Number(r.collateral_amount_usd),
        debtAmountUsd: Number(r.debt_amount_usd),
        grossProfitUsd: Number(r.gross_profit_usd),
        gasCostUsd: Number(r.gas_cost_usd || 0),
        netProfitUsd: Number(r.net_profit_usd || 0),
        gasPriceGwei: Number(r.gas_price_gwei || 0),
        gasUsed: Number(r.gas_used || 0),
        blockTimestamp: Number(r.block_timestamp),
        blockNumber: Number(r.block_number),
        isFlashLoan: r.is_flash_loan || false,
        flashLoanSource: r.flash_loan_source || null,
      })),
      fundingSource,
    })
  } catch (e: any) {
    console.error("Liquidator profile API error:", e)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
