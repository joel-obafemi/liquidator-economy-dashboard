import { NextResponse } from "next/server"
import { rawSql } from "@/lib/db"

export const dynamic = "force-dynamic"

// Event window — the 7 days following the rsETH depeg.
const EVENT_START = Math.floor(new Date("2026-04-18T00:00:00Z").getTime() / 1000)
const EVENT_END = Math.floor(new Date("2026-04-25T23:59:59Z").getTime() / 1000)

// rsETH symbol filter (case-insensitive). Some events may have variant
// symbols like "wrsETH" or null; we keep the match liberal.
const RSETH_FILTER = `(collateral_symbol ILIKE '%rseth%' OR debt_symbol ILIKE '%rseth%')`

export async function GET() {
  try {
    // 1. Event-window summary
    const eventWindow = await rawSql(
      `
      SELECT
        COUNT(*)::int AS events,
        COUNT(DISTINCT liquidator)::int AS liquidators,
        COUNT(DISTINCT borrower)::int AS borrowers,
        COALESCE(SUM(collateral_amount_usd), 0) AS volume,
        COALESCE(SUM(gross_profit_usd), 0) AS profit,
        COALESCE(SUM(bad_debt_usd), 0) AS bad_debt,
        COUNT(*) FILTER (WHERE bad_debt_usd > 0)::int AS bad_debt_events
      FROM liquidation_events
      WHERE ${RSETH_FILTER}
        AND block_timestamp BETWEEN $1 AND $2
      `,
      [EVENT_START, EVENT_END]
    )

    // 2. Historical baseline (everything before the event window)
    const baseline = await rawSql(
      `
      SELECT
        COUNT(*)::int AS events,
        COUNT(DISTINCT liquidator)::int AS liquidators,
        COUNT(DISTINCT borrower)::int AS borrowers,
        COALESCE(SUM(collateral_amount_usd), 0) AS volume,
        COALESCE(SUM(gross_profit_usd), 0) AS profit,
        COALESCE(SUM(bad_debt_usd), 0) AS bad_debt,
        MIN(block_timestamp) AS first_ts,
        MAX(block_timestamp) AS last_ts
      FROM liquidation_events
      WHERE ${RSETH_FILTER}
        AND block_timestamp < $1
      `,
      [EVENT_START]
    )

    // 3. Daily timeline — 30 days before event start through 30 days after.
    const tlStart = EVENT_START - 30 * 86400
    const tlEnd = EVENT_END + 30 * 86400
    const timeline = await rawSql(
      `
      SELECT
        TO_CHAR(TO_TIMESTAMP(block_timestamp), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS events,
        COALESCE(SUM(collateral_amount_usd), 0) AS volume,
        COALESCE(SUM(gross_profit_usd), 0) AS profit,
        COALESCE(SUM(bad_debt_usd), 0) AS bad_debt
      FROM liquidation_events
      WHERE ${RSETH_FILTER}
        AND block_timestamp BETWEEN $1 AND $2
      GROUP BY day
      ORDER BY day ASC
      `,
      [tlStart, tlEnd]
    )

    // 4. Per-pair breakdown (rsETH/USDC, rsETH/WETH, etc.) historical
    const byPair = await rawSql(
      `
      SELECT
        protocol,
        collateral_symbol,
        debt_symbol,
        COUNT(*)::int AS events,
        COUNT(DISTINCT liquidator)::int AS liquidators,
        COUNT(DISTINCT borrower)::int AS borrowers,
        COALESCE(SUM(collateral_amount_usd), 0) AS volume,
        COALESCE(SUM(gross_profit_usd), 0) AS profit,
        COALESCE(SUM(bad_debt_usd), 0) AS bad_debt,
        MAX(block_timestamp) AS last_ts
      FROM liquidation_events
      WHERE ${RSETH_FILTER}
      GROUP BY protocol, collateral_symbol, debt_symbol
      ORDER BY events DESC
      `
    )

    // 5. "Who showed up" — bots historically active on rsETH, with whether
    // they appeared during the event window. Cross-reference for the
    // "where were the liquidators?" line.
    const liquidatorActivity = await rawSql(
      `
      SELECT
        liquidator,
        COUNT(*)::int AS historical_events,
        COUNT(*) FILTER (WHERE block_timestamp BETWEEN $1 AND $2)::int AS event_window_events,
        COALESCE(SUM(collateral_amount_usd), 0) AS historical_volume,
        COALESCE(SUM(collateral_amount_usd) FILTER (WHERE block_timestamp BETWEEN $1 AND $2), 0) AS event_volume,
        MAX(block_timestamp) AS last_active
      FROM liquidation_events
      WHERE ${RSETH_FILTER}
      GROUP BY liquidator
      ORDER BY historical_events DESC
      `,
      [EVENT_START, EVENT_END]
    )

    // 6. Top-50 historical Aave V3 + Morpho liquidators overall — to show
    // which "pros" did NOT show up during the rsETH event window.
    const topLiquidatorsOverall = await rawSql(
      `
      WITH top_lq AS (
        SELECT liquidator,
               COUNT(*)::int AS total_events,
               COUNT(DISTINCT collateral_symbol)::int AS distinct_collateral,
               COALESCE(SUM(gross_profit_usd), 0) AS total_profit
        FROM liquidation_events
        WHERE protocol IN ('aave_v3','morpho_blue')
        GROUP BY liquidator
        ORDER BY total_events DESC
        LIMIT 50
      ),
      rseth_window AS (
        SELECT DISTINCT liquidator
        FROM liquidation_events
        WHERE ${RSETH_FILTER}
          AND block_timestamp BETWEEN $1 AND $2
      ),
      rseth_ever AS (
        SELECT DISTINCT liquidator
        FROM liquidation_events
        WHERE ${RSETH_FILTER}
      )
      SELECT
        t.liquidator,
        t.total_events,
        t.distinct_collateral,
        t.total_profit,
        (rw.liquidator IS NOT NULL) AS active_in_event_window,
        (re.liquidator IS NOT NULL) AS ever_touched_rseth
      FROM top_lq t
      LEFT JOIN rseth_window rw ON rw.liquidator = t.liquidator
      LEFT JOIN rseth_ever re ON re.liquidator = t.liquidator
      ORDER BY t.total_events DESC
      `,
      [EVENT_START, EVENT_END]
    )

    // 7. Data freshness — most-recent block per protocol, so the page can
    // show whether the zero is real or a scan gap.
    const scannerState = await rawSql(
      `SELECT scanner_name, last_scanned_block::bigint as last_block, updated_at
       FROM scan_state ORDER BY scanner_name`
    )

    // 7b. Hourly bad-debt formation curve (Aave V3, rsETH-collateral users).
    // Empty array if the snapshot table doesn't exist or hasn't been populated.
    let hourlySnapshots: Array<{
      timestamp: number
      blockNumber: number
      totalCollateralUsd: number
      totalDebtUsd: number
      badDebtUsd: number
      underwaterUsers: number
      activeUsers: number
    }> = []
    try {
      const snaps = await rawSql(
        `SELECT block_timestamp::bigint as ts, block_number::bigint as block,
                total_collateral_usd, total_debt_usd, bad_debt_usd,
                underwater_users, active_users
         FROM rseth_hourly_snapshots
         ORDER BY block_timestamp ASC`
      )
      hourlySnapshots = snaps.map((r: any) => ({
        timestamp: Number(r.ts),
        blockNumber: Number(r.block),
        totalCollateralUsd: Number(r.total_collateral_usd),
        totalDebtUsd: Number(r.total_debt_usd),
        badDebtUsd: Number(r.bad_debt_usd),
        underwaterUsers: Number(r.underwater_users),
        activeUsers: Number(r.active_users),
      }))
    } catch (e: any) {
      // table may not exist yet on fresh installs
      console.warn(
        "rseth_hourly_snapshots not available:",
        e?.message?.slice(0, 100)
      )
    }

    // 8. Sanity: ANY liquidations during event window across all protocols
    // (so we can show "rsETH had 0 while the rest of the system processed N").
    const allDuringWindow = await rawSql(
      `
      SELECT
        protocol,
        COUNT(*)::int AS events,
        COUNT(DISTINCT borrower)::int AS borrowers,
        COALESCE(SUM(collateral_amount_usd), 0) AS volume
      FROM liquidation_events
      WHERE block_timestamp BETWEEN $1 AND $2
      GROUP BY protocol
      ORDER BY events DESC
      `,
      [EVENT_START, EVENT_END]
    )

    return NextResponse.json({
      eventWindow: {
        startTimestamp: EVENT_START,
        endTimestamp: EVENT_END,
        events: Number(eventWindow[0]?.events || 0),
        liquidators: Number(eventWindow[0]?.liquidators || 0),
        borrowers: Number(eventWindow[0]?.borrowers || 0),
        volume: Number(eventWindow[0]?.volume || 0),
        profit: Number(eventWindow[0]?.profit || 0),
        badDebt: Number(eventWindow[0]?.bad_debt || 0),
        badDebtEvents: Number(eventWindow[0]?.bad_debt_events || 0),
      },
      baseline: {
        events: Number(baseline[0]?.events || 0),
        liquidators: Number(baseline[0]?.liquidators || 0),
        borrowers: Number(baseline[0]?.borrowers || 0),
        volume: Number(baseline[0]?.volume || 0),
        profit: Number(baseline[0]?.profit || 0),
        badDebt: Number(baseline[0]?.bad_debt || 0),
        firstTimestamp: baseline[0]?.first_ts ? Number(baseline[0].first_ts) : null,
        lastTimestamp: baseline[0]?.last_ts ? Number(baseline[0].last_ts) : null,
      },
      timeline: (() => {
        // Backfill every day in the timeline window so the chart renders a
        // visually correct sparse-but-complete bar series. Without this,
        // Recharts auto-sizes the single populated bar to fill the X-axis.
        const byDay = new Map<string, any>()
        for (const r of timeline as any[]) {
          byDay.set(r.day, {
            day: r.day,
            events: Number(r.events),
            volume: Number(r.volume),
            profit: Number(r.profit),
            badDebt: Number(r.bad_debt),
          })
        }
        const out: Array<{
          day: string
          events: number
          volume: number
          profit: number
          badDebt: number
        }> = []
        const oneDay = 86400
        for (let t = tlStart; t <= tlEnd; t += oneDay) {
          const day = new Date(t * 1000).toISOString().slice(0, 10)
          out.push(
            byDay.get(day) ?? {
              day,
              events: 0,
              volume: 0,
              profit: 0,
              badDebt: 0,
            }
          )
        }
        return out
      })(),
      byPair: byPair.map((r: any) => ({
        protocol: r.protocol,
        collateralSymbol: r.collateral_symbol,
        debtSymbol: r.debt_symbol,
        events: Number(r.events),
        liquidators: Number(r.liquidators),
        borrowers: Number(r.borrowers),
        volume: Number(r.volume),
        profit: Number(r.profit),
        badDebt: Number(r.bad_debt),
        lastTimestamp: r.last_ts ? Number(r.last_ts) : null,
      })),
      liquidatorActivity: liquidatorActivity.map((r: any) => ({
        liquidator: r.liquidator,
        historicalEvents: Number(r.historical_events),
        eventWindowEvents: Number(r.event_window_events),
        historicalVolume: Number(r.historical_volume),
        eventVolume: Number(r.event_volume),
        lastActive: r.last_active ? Number(r.last_active) : null,
      })),
      topLiquidatorsOverall: topLiquidatorsOverall.map((r: any) => ({
        liquidator: r.liquidator,
        totalEvents: Number(r.total_events),
        distinctCollateral: Number(r.distinct_collateral),
        totalProfit: Number(r.total_profit),
        activeInEventWindow: r.active_in_event_window === true,
        everTouchedRseth: r.ever_touched_rseth === true,
      })),
      scannerState: scannerState.map((r: any) => ({
        name: r.scanner_name,
        lastBlock: Number(r.last_block),
        updatedAt: r.updated_at instanceof Date
          ? r.updated_at.toISOString()
          : String(r.updated_at),
      })),
      allDuringWindow: allDuringWindow.map((r: any) => ({
        protocol: r.protocol,
        events: Number(r.events),
        borrowers: Number(r.borrowers),
        volume: Number(r.volume),
      })),
      hourlySnapshots,
    })
  } catch (e: any) {
    console.error("rsETH research API error:", e)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
