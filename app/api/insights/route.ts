import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const protocol = url.searchParams.get("protocol")
    const protocolFilter = protocol && protocol !== "all" ? `AND protocol = '${protocol}'` : ""

    // 1. Net Profit Analysis (gas costs)
    const netProfitStats = await rawSql(`
      SELECT
        COUNT(*) FILTER (WHERE gas_used IS NOT NULL)::int as with_gas_data,
        COUNT(*) FILTER (WHERE net_profit_usd >= 0 AND gas_used IS NOT NULL)::int as profitable_count,
        COUNT(*) FILTER (WHERE net_profit_usd < 0 AND gas_used IS NOT NULL)::int as unprofitable_count,
        COALESCE(SUM(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL), 0) as total_gas_usd,
        COALESCE(AVG(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL), 0) as avg_gas_usd,
        COALESCE(AVG(gas_price_gwei) FILTER (WHERE gas_used IS NOT NULL), 0) as avg_gas_gwei,
        COALESCE(SUM(net_profit_usd) FILTER (WHERE gas_used IS NOT NULL), 0) as total_net_profit,
        COALESCE(SUM(gross_profit_usd), 0) as total_gross_profit,
        COUNT(*)::int as total_events
      FROM liquidation_events
      WHERE 1=1 ${protocolFilter}
    `)

    // 2. Profit distribution buckets (histogram)
    const profitDistribution = await rawSql(`
      SELECT
        CASE
          WHEN net_profit_usd IS NULL THEN 'no_gas_data'
          WHEN net_profit_usd < -100 THEN 'loss_gt_100'
          WHEN net_profit_usd < -10 THEN 'loss_10_100'
          WHEN net_profit_usd < 0 THEN 'loss_0_10'
          WHEN net_profit_usd < 10 THEN 'profit_0_10'
          WHEN net_profit_usd < 100 THEN 'profit_10_100'
          WHEN net_profit_usd < 1000 THEN 'profit_100_1k'
          WHEN net_profit_usd < 10000 THEN 'profit_1k_10k'
          ELSE 'profit_gt_10k'
        END as bucket,
        COUNT(*)::int as count,
        COALESCE(SUM(net_profit_usd), 0) as total_profit
      FROM liquidation_events
      WHERE 1=1 ${protocolFilter}
      GROUP BY bucket
      ORDER BY bucket
    `)

    // 3. Liquidation cascades (events in same block or within 2 blocks)
    const cascades = await rawSql(`
      WITH block_counts AS (
        SELECT
          block_number,
          block_timestamp,
          COUNT(*)::int as events_in_block,
          COALESCE(SUM(collateral_amount_usd), 0) as block_volume,
          array_agg(DISTINCT borrower) as borrowers
        FROM liquidation_events
        WHERE 1=1 ${protocolFilter}
        GROUP BY block_number, block_timestamp
        HAVING COUNT(*) >= 2
      )
      SELECT
        block_number, block_timestamp, events_in_block, block_volume,
        array_length(borrowers, 1) as unique_borrowers
      FROM block_counts
      ORDER BY events_in_block DESC
      LIMIT 20
    `)

    // Cascade summary stats
    const cascadeStats = await rawSql(`
      WITH block_counts AS (
        SELECT block_number, COUNT(*)::int as cnt
        FROM liquidation_events WHERE 1=1 ${protocolFilter}
        GROUP BY block_number
      )
      SELECT
        COUNT(*) FILTER (WHERE cnt >= 2)::int as cascade_blocks,
        COUNT(*) FILTER (WHERE cnt >= 5)::int as major_cascade_blocks,
        MAX(cnt) as max_events_in_block,
        SUM(cnt) FILTER (WHERE cnt >= 2)::int as total_cascade_events
      FROM block_counts
    `)

    // 4. Repeat offenders (borrowers liquidated multiple times)
    const repeatBorrowers = await rawSql(`
      SELECT
        borrower,
        COUNT(*)::int as times_liquidated,
        COALESCE(SUM(collateral_amount_usd), 0) as total_volume_lost,
        COALESCE(SUM(gross_profit_usd), 0) as total_profit_given,
        MIN(block_timestamp) as first_liquidation,
        MAX(block_timestamp) as last_liquidation,
        array_agg(DISTINCT collateral_symbol) as collateral_assets
      FROM liquidation_events
      WHERE 1=1 ${protocolFilter}
      GROUP BY borrower
      HAVING COUNT(*) >= 2
      ORDER BY times_liquidated DESC
      LIMIT 20
    `)

    // Repeat offender summary
    const repeatStats = await rawSql(`
      WITH borrower_counts AS (
        SELECT borrower, COUNT(*)::int as cnt, SUM(collateral_amount_usd) as vol
        FROM liquidation_events WHERE 1=1 ${protocolFilter}
        GROUP BY borrower
      )
      SELECT
        COUNT(*)::int as total_borrowers,
        COUNT(*) FILTER (WHERE cnt >= 2)::int as repeat_borrowers,
        COUNT(*) FILTER (WHERE cnt >= 5)::int as serial_borrowers,
        COALESCE(SUM(vol) FILTER (WHERE cnt >= 2), 0) as repeat_volume,
        COALESCE(SUM(vol), 0) as total_volume
      FROM borrower_counts
    `)

    // 5. Market concentration (Gini-like) — monthly top-5 share
    const concentration = await rawSql(`
      WITH monthly_liq AS (
        SELECT
          TO_CHAR(TO_TIMESTAMP(block_timestamp), 'YYYY-MM') as month,
          liquidator,
          COALESCE(SUM(gross_profit_usd), 0) as profit
        FROM liquidation_events
        WHERE 1=1 ${protocolFilter}
        GROUP BY month, liquidator
      ),
      monthly_totals AS (
        SELECT month, SUM(profit) as total_profit, COUNT(DISTINCT liquidator)::int as num_liquidators
        FROM monthly_liq
        GROUP BY month
      ),
      monthly_top5 AS (
        SELECT month, SUM(profit) as top5_profit
        FROM (
          SELECT month, profit, ROW_NUMBER() OVER (PARTITION BY month ORDER BY profit DESC) as rn
          FROM monthly_liq
        ) ranked
        WHERE rn <= 5
        GROUP BY month
      )
      SELECT
        t.month,
        t.total_profit,
        t.num_liquidators,
        COALESCE(t5.top5_profit, 0) as top5_profit,
        CASE
          -- When total profit is zero or negative (e.g. net-loss months), the
          -- share ratio is meaningless. Display those as 100% since "top 5 of N
          -- contribute 100% of the positive profit" is effectively true.
          WHEN t.total_profit <= 0 THEN 100
          WHEN COALESCE(t5.top5_profit, 0) <= 0 THEN 0
          ELSE LEAST(100, COALESCE(t5.top5_profit, 0) / t.total_profit * 100)
        END as top5_share
      FROM monthly_totals t
      LEFT JOIN monthly_top5 t5 ON t.month = t5.month
      WHERE t.num_liquidators >= 5  -- skip months with fewer than 5 active liquidators
      ORDER BY t.month ASC
    `)

    // 6. Cross-protocol liquidator breakdown
    // Only meaningful when viewing all protocols; we skip it otherwise.
    let crossProtocol: Array<{ numProtocols: number; count: number; totalProfit: number }> = []
    let crossProtocolTotalDistinct = 0
    if (!protocol || protocol === "all") {
      const crossRows = await rawSql(`
        WITH liquidator_protocols AS (
          SELECT
            liquidator,
            array_length(array_agg(DISTINCT protocol), 1) as num_protocols,
            SUM(gross_profit_usd) as total_profit
          FROM liquidation_events
          GROUP BY liquidator
        )
        SELECT
          num_protocols,
          COUNT(*)::int as cnt,
          COALESCE(SUM(total_profit), 0) as total_profit
        FROM liquidator_protocols
        GROUP BY num_protocols
        ORDER BY num_protocols ASC
      `)
      crossProtocol = crossRows.map((r: any) => ({
        numProtocols: Number(r.num_protocols),
        count: Number(r.cnt),
        totalProfit: Number(r.total_profit),
      }))
      crossProtocolTotalDistinct = crossProtocol.reduce((s, r) => s + r.count, 0)
    }

    // 7. Cross-protocol pairwise overlap matrix
    // For each pair of protocols, count shared liquidators and their combined volume
    let overlapMatrix: Array<{
      protocolA: string; protocolB: string;
      sharedLiquidators: number; sharedVolume: number; sharedProfit: number;
    }> = []
    let protocolStats: Array<{
      protocol: string; uniqueLiquidators: number; totalVolume: number; totalProfit: number;
    }> = []
    if (!protocol || protocol === "all") {
      // Per-protocol stats (diagonal of the matrix)
      const pStats = await rawSql(`
        SELECT
          protocol,
          COUNT(DISTINCT liquidator)::int as unique_liquidators,
          COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
          COALESCE(SUM(gross_profit_usd), 0) as total_profit
        FROM liquidation_events
        GROUP BY protocol
        ORDER BY protocol
      `)
      protocolStats = pStats.map((r: any) => ({
        protocol: r.protocol,
        uniqueLiquidators: Number(r.unique_liquidators),
        totalVolume: Number(r.total_volume),
        totalProfit: Number(r.total_profit),
      }))

      // Pairwise overlap: liquidators active on BOTH protocol A and B
      const overlap = await rawSql(`
        WITH liquidator_proto AS (
          SELECT DISTINCT liquidator, protocol
          FROM liquidation_events
        ),
        liquidator_volume AS (
          SELECT liquidator, protocol,
                 COALESCE(SUM(collateral_amount_usd), 0) as volume,
                 COALESCE(SUM(gross_profit_usd), 0) as profit
          FROM liquidation_events
          GROUP BY liquidator, protocol
        )
        SELECT
          a.protocol as protocol_a,
          b.protocol as protocol_b,
          COUNT(DISTINCT a.liquidator)::int as shared_liquidators,
          COALESCE(SUM(va.volume + vb.volume), 0) as shared_volume,
          COALESCE(SUM(va.profit + vb.profit), 0) as shared_profit
        FROM liquidator_proto a
        JOIN liquidator_proto b ON a.liquidator = b.liquidator AND a.protocol < b.protocol
        LEFT JOIN liquidator_volume va ON va.liquidator = a.liquidator AND va.protocol = a.protocol
        LEFT JOIN liquidator_volume vb ON vb.liquidator = a.liquidator AND vb.protocol = b.protocol
        GROUP BY a.protocol, b.protocol
        ORDER BY shared_liquidators DESC
      `)
      overlapMatrix = overlap.map((r: any) => ({
        protocolA: r.protocol_a,
        protocolB: r.protocol_b,
        sharedLiquidators: Number(r.shared_liquidators),
        sharedVolume: Number(r.shared_volume),
        sharedProfit: Number(r.shared_profit),
      }))
    }

    // 8. Top collateral-debt pairs by volume (for treemap)
    const collateralDebtPairs = await rawSql(`
      SELECT
        collateral_symbol,
        debt_symbol,
        collateral_symbol || '/' || debt_symbol as pair,
        COUNT(*)::int as event_count,
        COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
        COALESCE(SUM(gross_profit_usd), 0) as total_profit,
        COUNT(DISTINCT liquidator)::int as unique_liquidators,
        COALESCE(AVG(
          CASE WHEN debt_amount_usd > 0
            THEN (collateral_amount_usd - debt_amount_usd) / debt_amount_usd * 100
            ELSE 0
          END
        ), 0) as avg_bonus_pct
      FROM liquidation_events
      WHERE 1=1 ${protocolFilter}
      GROUP BY collateral_symbol, debt_symbol
      HAVING COUNT(*) >= 2
      ORDER BY total_volume DESC
      LIMIT 30
    `)

    // 9. Liquidation Size Distribution (histogram of individual liquidation sizes)
    const sizeDistribution = await rawSql(`
      SELECT
        CASE
          WHEN collateral_amount_usd < 100 THEN '$0-$100'
          WHEN collateral_amount_usd < 1000 THEN '$100-$1K'
          WHEN collateral_amount_usd < 10000 THEN '$1K-$10K'
          WHEN collateral_amount_usd < 50000 THEN '$10K-$50K'
          WHEN collateral_amount_usd < 100000 THEN '$50K-$100K'
          WHEN collateral_amount_usd < 500000 THEN '$100K-$500K'
          WHEN collateral_amount_usd < 1000000 THEN '$500K-$1M'
          ELSE '$1M+'
        END as bucket,
        CASE
          WHEN collateral_amount_usd < 100 THEN 1
          WHEN collateral_amount_usd < 1000 THEN 2
          WHEN collateral_amount_usd < 10000 THEN 3
          WHEN collateral_amount_usd < 50000 THEN 4
          WHEN collateral_amount_usd < 100000 THEN 5
          WHEN collateral_amount_usd < 500000 THEN 6
          WHEN collateral_amount_usd < 1000000 THEN 7
          ELSE 8
        END as sort_order,
        COUNT(*)::int as count,
        COALESCE(SUM(collateral_amount_usd), 0) as total_volume,
        COALESCE(AVG(collateral_amount_usd), 0) as avg_size
      FROM liquidation_events
      WHERE collateral_amount_usd > 0 ${protocolFilter}
      GROUP BY bucket, sort_order
      ORDER BY sort_order ASC
    `)

    // 10. Monthly Profit (global bar chart of profit by month per protocol)
    const monthlyProfit = await rawSql(`
      SELECT
        TO_CHAR(TO_TIMESTAMP(block_timestamp), 'YYYY-MM') as month,
        protocol,
        COALESCE(SUM(gross_profit_usd), 0) as gross_profit,
        COALESCE(SUM(net_profit_usd) FILTER (WHERE gas_used IS NOT NULL), 0) as net_profit,
        COUNT(*)::int as event_count
      FROM liquidation_events
      WHERE 1=1 ${protocolFilter}
      GROUP BY month, protocol
      ORDER BY month ASC
    `)

    // 11. Gas Prices by Top Liquidator (gas strategy comparison)
    const gasByLiquidator = await rawSql(`
      SELECT
        liquidator,
        COUNT(*)::int as event_count,
        COALESCE(AVG(gas_price_gwei) FILTER (WHERE gas_used IS NOT NULL), 0) as avg_gas_gwei,
        COALESCE(AVG(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL), 0) as avg_gas_usd,
        COALESCE(AVG(gas_used) FILTER (WHERE gas_used IS NOT NULL), 0) as avg_gas_used,
        COALESCE(SUM(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL), 0) as total_gas_usd,
        COALESCE(SUM(gross_profit_usd), 0) as total_gross_profit,
        COALESCE(SUM(net_profit_usd) FILTER (WHERE gas_used IS NOT NULL), 0) as total_net_profit,
        COUNT(*) FILTER (WHERE gas_used IS NOT NULL)::int as events_with_gas
      FROM liquidation_events
      WHERE 1=1 ${protocolFilter}
      GROUP BY liquidator
      HAVING COUNT(*) FILTER (WHERE gas_used IS NOT NULL) >= 5
      ORDER BY total_gross_profit DESC
      LIMIT 20
    `)

    // 12. Profit Concentration Snapshot (current pie/bar breakdown)
    const profitConcentration = await rawSql(`
      WITH liquidator_profits AS (
        SELECT
          liquidator,
          COALESCE(SUM(gross_profit_usd), 0) as total_profit,
          COUNT(*)::int as event_count,
          ROW_NUMBER() OVER (ORDER BY SUM(gross_profit_usd) DESC) as rank
        FROM liquidation_events
        WHERE 1=1 ${protocolFilter}
        GROUP BY liquidator
      ),
      tiers AS (
        SELECT
          CASE
            WHEN rank <= 5 THEN 'Top 5'
            WHEN rank <= 10 THEN 'Top 6-10'
            WHEN rank <= 20 THEN 'Top 11-20'
            WHEN rank <= 50 THEN 'Top 21-50'
            ELSE 'Everyone Else'
          END as tier,
          CASE
            WHEN rank <= 5 THEN 1
            WHEN rank <= 10 THEN 2
            WHEN rank <= 20 THEN 3
            WHEN rank <= 50 THEN 4
            ELSE 5
          END as sort_order,
          total_profit,
          event_count,
          liquidator
        FROM liquidator_profits
      )
      SELECT
        tier,
        sort_order,
        COUNT(*)::int as liquidator_count,
        COALESCE(SUM(total_profit), 0) as tier_profit,
        COALESCE(SUM(event_count), 0)::int as tier_events
      FROM tiers
      GROUP BY tier, sort_order
      ORDER BY sort_order ASC
    `)

    // 8. Liquidation bonus efficiency by asset
    const bonusEfficiency = await rawSql(`
      SELECT
        collateral_symbol,
        COUNT(*)::int as count,
        COALESCE(AVG(
          CASE WHEN debt_amount_usd > 0
            THEN (collateral_amount_usd - debt_amount_usd) / debt_amount_usd * 100
            ELSE 0
          END
        ), 0) as avg_bonus_pct,
        COALESCE(AVG(gross_profit_usd), 0) as avg_gross_profit,
        COALESCE(AVG(gas_cost_usd) FILTER (WHERE gas_used IS NOT NULL), 0) as avg_gas_cost,
        COALESCE(AVG(net_profit_usd) FILTER (WHERE gas_used IS NOT NULL), 0) as avg_net_profit
      FROM liquidation_events
      WHERE debt_amount_usd > 0 ${protocolFilter}
      GROUP BY collateral_symbol
      HAVING COUNT(*) >= 3
      ORDER BY count DESC
    `)

    return NextResponse.json({
      netProfit: {
        withGasData: Number(netProfitStats[0]?.with_gas_data || 0),
        profitableCount: Number(netProfitStats[0]?.profitable_count || 0),
        unprofitableCount: Number(netProfitStats[0]?.unprofitable_count || 0),
        totalGasUsd: Number(netProfitStats[0]?.total_gas_usd || 0),
        avgGasUsd: Number(netProfitStats[0]?.avg_gas_usd || 0),
        avgGasGwei: Number(netProfitStats[0]?.avg_gas_gwei || 0),
        totalNetProfit: Number(netProfitStats[0]?.total_net_profit || 0),
        totalGrossProfit: Number(netProfitStats[0]?.total_gross_profit || 0),
        totalEvents: Number(netProfitStats[0]?.total_events || 0),
      },
      profitDistribution: profitDistribution.map((r: any) => ({
        bucket: r.bucket,
        count: Number(r.count),
        totalProfit: Number(r.total_profit),
      })),
      cascades: {
        topCascades: cascades.map((r: any) => ({
          blockNumber: Number(r.block_number),
          blockTimestamp: Number(r.block_timestamp),
          eventsInBlock: Number(r.events_in_block),
          blockVolume: Number(r.block_volume),
          uniqueBorrowers: Number(r.unique_borrowers),
        })),
        stats: {
          cascadeBlocks: Number(cascadeStats[0]?.cascade_blocks || 0),
          majorCascadeBlocks: Number(cascadeStats[0]?.major_cascade_blocks || 0),
          maxEventsInBlock: Number(cascadeStats[0]?.max_events_in_block || 0),
          totalCascadeEvents: Number(cascadeStats[0]?.total_cascade_events || 0),
        },
      },
      repeatBorrowers: {
        topOffenders: repeatBorrowers.map((r: any) => ({
          borrower: r.borrower,
          timesLiquidated: Number(r.times_liquidated),
          totalVolumeLost: Number(r.total_volume_lost),
          totalProfitGiven: Number(r.total_profit_given),
          firstLiquidation: Number(r.first_liquidation),
          lastLiquidation: Number(r.last_liquidation),
          collateralAssets: r.collateral_assets || [],
        })),
        stats: {
          totalBorrowers: Number(repeatStats[0]?.total_borrowers || 0),
          repeatBorrowers: Number(repeatStats[0]?.repeat_borrowers || 0),
          serialBorrowers: Number(repeatStats[0]?.serial_borrowers || 0),
          repeatVolume: Number(repeatStats[0]?.repeat_volume || 0),
          totalVolume: Number(repeatStats[0]?.total_volume || 0),
        },
      },
      concentration: concentration.map((r: any) => ({
        month: r.month,
        totalProfit: Number(r.total_profit),
        numLiquidators: Number(r.num_liquidators),
        top5Profit: Number(r.top5_profit),
        top5Share: Number(r.top5_share),
      })),
      bonusEfficiency: bonusEfficiency.map((r: any) => ({
        collateralSymbol: r.collateral_symbol,
        count: Number(r.count),
        avgBonusPct: Number(r.avg_bonus_pct),
        avgGrossProfit: Number(r.avg_gross_profit),
        avgGasCost: Number(r.avg_gas_cost),
        avgNetProfit: Number(r.avg_net_profit),
      })),
      crossProtocol: {
        breakdown: crossProtocol,
        totalDistinct: crossProtocolTotalDistinct,
      },
      overlapMatrix,
      protocolStats,
      sizeDistribution: sizeDistribution.map((r: any) => ({
        bucket: r.bucket,
        sortOrder: Number(r.sort_order),
        count: Number(r.count),
        totalVolume: Number(r.total_volume),
        avgSize: Number(r.avg_size),
      })),
      monthlyProfit: monthlyProfit.map((r: any) => ({
        month: r.month,
        protocol: r.protocol,
        grossProfit: Number(r.gross_profit),
        netProfit: Number(r.net_profit),
        eventCount: Number(r.event_count),
      })),
      gasByLiquidator: gasByLiquidator.map((r: any) => ({
        liquidator: r.liquidator,
        eventCount: Number(r.event_count),
        avgGasGwei: Number(r.avg_gas_gwei),
        avgGasUsd: Number(r.avg_gas_usd),
        avgGasUsed: Number(r.avg_gas_used),
        totalGasUsd: Number(r.total_gas_usd),
        totalGrossProfit: Number(r.total_gross_profit),
        totalNetProfit: Number(r.total_net_profit),
        eventsWithGas: Number(r.events_with_gas),
      })),
      profitConcentration: profitConcentration.map((r: any) => ({
        tier: r.tier,
        sortOrder: Number(r.sort_order),
        liquidatorCount: Number(r.liquidator_count),
        tierProfit: Number(r.tier_profit),
        tierEvents: Number(r.tier_events),
      })),
      collateralDebtPairs: collateralDebtPairs.map((r: any) => ({
        collateral: r.collateral_symbol,
        debt: r.debt_symbol,
        pair: r.pair,
        eventCount: Number(r.event_count),
        totalVolume: Number(r.total_volume),
        totalProfit: Number(r.total_profit),
        uniqueLiquidators: Number(r.unique_liquidators),
        avgBonusPct: Number(r.avg_bonus_pct),
      })),
    })
  } catch (e: any) {
    console.error("Insights API error:", e)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
