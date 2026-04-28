"use client"

import { useCachedFetch } from "@/lib/use-cached-fetch"
import {
  formatUSD,
  formatNumber,
  formatAddress,
  etherscanAddress,
  protocolLabel,
  CHART_COLORS,
} from "@/lib/utils"
import { MetricCard } from "@/components/metric-card"
import { SkeletonKpiRow, SkeletonChart, SkeletonTable } from "@/components/skeleton"
import { ChartWrapper } from "@/components/chart-wrapper"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  Cell,
  ComposedChart,
  Area,
  Line,
} from "recharts"

interface RsethData {
  eventWindow: {
    startTimestamp: number
    endTimestamp: number
    events: number
    liquidators: number
    borrowers: number
    volume: number
    profit: number
    badDebt: number
    badDebtEvents: number
  }
  baseline: {
    events: number
    liquidators: number
    borrowers: number
    volume: number
    profit: number
    badDebt: number
    firstTimestamp: number | null
    lastTimestamp: number | null
  }
  timeline: Array<{
    day: string
    events: number
    volume: number
    profit: number
    badDebt: number
  }>
  byPair: Array<{
    protocol: string
    collateralSymbol: string
    debtSymbol: string
    events: number
    liquidators: number
    borrowers: number
    volume: number
    profit: number
    badDebt: number
    lastTimestamp: number | null
  }>
  liquidatorActivity: Array<{
    liquidator: string
    historicalEvents: number
    eventWindowEvents: number
    historicalVolume: number
    eventVolume: number
    lastActive: number | null
  }>
  topLiquidatorsOverall: Array<{
    liquidator: string
    totalEvents: number
    distinctCollateral: number
    totalProfit: number
    activeInEventWindow: boolean
    everTouchedRseth: boolean
  }>
  scannerState: Array<{
    name: string
    lastBlock: number
    updatedAt: string
  }>
  allDuringWindow: Array<{
    protocol: string
    events: number
    borrowers: number
    volume: number
  }>
  hourlySnapshots: Array<{
    timestamp: number
    blockNumber: number
    totalCollateralUsd: number
    totalDebtUsd: number
    badDebtUsd: number
    underwaterUsers: number
    activeUsers: number
  }>
}

const EVENT_START_LABEL = "April 18, 2026"
const EVENT_END_LABEL = "April 25, 2026"

function fmtDate(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}
function fmtDateTime(ts: number) {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z"
}

export default function RsethIncidentPage() {
  const { data, loading } = useCachedFetch<RsethData>(
    "/api/research/rseth-incident",
    { ttl: 5 * 60 * 1000 }
  )

  const ew = data?.eventWindow
  const bl = data?.baseline

  // Days from baseline last → event window start
  const daysSinceLastLiq =
    bl?.lastTimestamp && ew
      ? Math.floor((ew.startTimestamp - bl.lastTimestamp) / 86400)
      : null

  const baselineSpanDays =
    bl?.firstTimestamp && bl?.lastTimestamp
      ? Math.max(1, Math.floor((bl.lastTimestamp - bl.firstTimestamp) / 86400))
      : 1
  const eventsPerWeekHistorical =
    bl && bl.events > 0 ? (bl.events / baselineSpanDays) * 7 : 0

  const totalEventWindowSystemwide = data?.allDuringWindow.reduce(
    (s, r) => s + r.events,
    0
  )

  // Sort: bots active during event window first, then by historical events.
  const topBots = [...(data?.topLiquidatorsOverall || [])].sort((a, b) => {
    if (a.activeInEventWindow !== b.activeInEventWindow) {
      return a.activeInEventWindow ? -1 : 1
    }
    return b.totalEvents - a.totalEvents
  })

  const showedUpCount = topBots.filter((b) => b.activeInEventWindow).length
  const everTouchedCount = topBots.filter((b) => b.everTouchedRseth).length

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-tertiary">
          <span>Research</span>
          <span style={{ color: "var(--card-border)" }}>›</span>
          <span style={{ color: "#FF4444" }}>Incident</span>
        </div>
        <h1 className="text-lg font-semibold text-text-primary mt-1">
          The rsETH Liquidation Vacuum
        </h1>
        <p className="text-[11px] text-text-tertiary mt-1 max-w-[760px] leading-relaxed">
          {EVENT_START_LABEL} – {EVENT_END_LABEL}. A 15% rsETH depeg created a window where
          unhealthy positions should have been liquidated en masse. Instead the liquidation
          system processed{" "}
          <span style={{ color: "#FF4444", fontWeight: 600 }}>zero rsETH events</span> during
          the entire week — exactly what bot economics predict when collateral falls below the
          repayment cost.
        </p>
      </div>

      {/* Headline KPIs */}
      {loading && !data ? (
        <SkeletonKpiRow count={4} />
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            label="Event-window liquidations"
            value={String(ew?.events ?? 0)}
            sub={`${EVENT_START_LABEL.slice(0, 10)} → ${EVENT_END_LABEL.slice(0, 10)}`}
            accent
          />
          <MetricCard
            label="Days since last rsETH liq"
            value={daysSinceLastLiq != null ? String(daysSinceLastLiq) : "—"}
            sub={
              bl?.lastTimestamp
                ? `Last: ${fmtDate(bl.lastTimestamp)}`
                : "No prior events"
            }
          />
          <MetricCard
            label="Historical baseline (all-time)"
            value={formatNumber(bl?.events || 0)}
            sub={
              bl?.firstTimestamp
                ? `Since ${fmtDate(bl.firstTimestamp)} · ${eventsPerWeekHistorical.toFixed(2)} events/week avg`
                : ""
            }
          />
          <MetricCard
            label="System-wide liqs in same window"
            value={formatNumber(totalEventWindowSystemwide || 0)}
            sub={
              data && data.allDuringWindow.length > 0
                ? data.allDuringWindow
                    .map((r) => `${protocolLabel(r.protocol)}: ${r.events}`)
                    .join(" · ")
                : ""
            }
          />
        </div>
      )}

      {/* Story callout */}
      <div
        className="tui-card rounded p-4"
        style={{
          background: "rgba(255, 68, 68, 0.05)",
          border: "1px solid rgba(255, 68, 68, 0.25)",
        }}
      >
        <div className="text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          <span className="font-semibold" style={{ color: "#FF4444" }}>
            The finding:{" "}
          </span>
          rsETH had a depeg-driven week of theoretical maximum liquidation demand and the
          system absorbed{" "}
          <span className="font-medium text-text-primary">{ew?.events ?? 0}</span>{" "}
          on-chain liquidations of the asset. The same week, the broader Aave/Spark/Morpho/Fluid
          system processed{" "}
          <span className="font-medium text-text-primary">
            {formatNumber(totalEventWindowSystemwide || 0)}
          </span>{" "}
          liquidations on other assets. The asset wasn't out of trouble — it was out of
          economic viability for liquidators.
        </div>
      </div>

      {/* Daily timeline chart */}
      {loading && !data ? (
        <SkeletonChart height={300} />
      ) : (
        <ChartWrapper title="rsETH Daily Liquidation Activity (event window highlighted)" height={300}>
          {data && data.timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.timeline} margin={{ top: 24, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                  interval="preserveStartEnd"
                  minTickGap={50}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
                  contentStyle={{
                    background: "var(--tooltip-bg)",
                    border: "1px solid var(--card-border)",
                    borderRadius: 4,
                    fontSize: 11,
                    color: "var(--text-primary)",
                  }}
                  itemStyle={{ color: "var(--text-primary)" }}
                  labelStyle={{ color: "var(--text-secondary)", fontWeight: 600 }}
                  formatter={(v: any, n: any) => {
                    if (n === "events") return [`${v} liquidation${Number(v) === 1 ? "" : "s"}`, "Events"]
                    if (n === "volume") return [formatUSD(Number(v)), "Volume"]
                    return [v, n]
                  }}
                />
                {/* Highlight event window */}
                <ReferenceArea
                  x1={EVENT_START_LABEL.slice(0, 10).replace(/(\d+), (\d+)/, "$2-$1")}
                  x2={EVENT_END_LABEL.slice(0, 10).replace(/(\d+), (\d+)/, "$2-$1")}
                  fill="rgba(255, 68, 68, 0.08)"
                  stroke="rgba(255, 68, 68, 0.4)"
                  strokeDasharray="3 3"
                />
                <Bar dataKey="events" radius={[2, 2, 0, 0]}>
                  {data.timeline.map((d) => {
                    const inWindow =
                      d.day >= "2026-04-18" && d.day <= "2026-04-25"
                    return (
                      <Cell
                        key={d.day}
                        fill={inWindow ? "#FF4444" : CHART_COLORS.accent || "#FF6B35"}
                      />
                    )
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-text-tertiary text-xs">
              No rsETH events in the visualized 60-day window. The bar chart is empty by
              construction — that is the finding.
            </div>
          )}
        </ChartWrapper>
      )}

      {/* Hourly bad-debt formation curve (Aave V3 rsETH-collateral users) */}
      {data && data.hourlySnapshots && data.hourlySnapshots.length > 0 && (() => {
        const series = data.hourlySnapshots.map((s) => ({
          ts: s.timestamp,
          dt: new Date(s.timestamp * 1000).toISOString().slice(5, 16).replace("T", " "),
          collateral: s.totalCollateralUsd,
          debt: s.totalDebtUsd,
          badDebt: s.badDebtUsd,
          underwater: s.underwaterUsers,
          active: s.activeUsers,
        }))
        const peakBadDebt = series.reduce(
          (m, r) => (r.badDebt > m ? r.badDebt : m),
          0
        )
        const peakUnderwater = series.reduce(
          (m, r) => (r.underwater > m ? r.underwater : m),
          0
        )
        const eventStartLabel = "04-18 00:00"
        const eventEndLabel = "04-25 23:00"

        return (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-text-primary">
                📉 Hourly Bad-Debt Formation — Aave V3 rsETH Positions
              </h2>
              <span className="text-[10px] text-text-tertiary">
                Per-user state via{" "}
                <code className="text-accent">getUserAccountData</code> · Alchemy archive ·{" "}
                {data.hourlySnapshots.length} hourly snapshots
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <MetricCard
                label="Peak bad debt"
                value={formatUSD(peakBadDebt)}
                sub="Sum of (debt − collateral) across underwater positions"
                accent={peakBadDebt > 0}
              />
              <MetricCard
                label="Peak underwater users"
                value={String(peakUnderwater)}
                sub="Hourly maximum across the analysis window"
              />
              <MetricCard
                label="Active rsETH-collateral users"
                value={String(series[series.length - 1]?.active || 0)}
                sub="As of last snapshot"
              />
            </div>

            <ChartWrapper title="Collateral, Debt & Bad-Debt Curve" height={340}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={series}
                  margin={{ top: 24, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis
                    dataKey="dt"
                    tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                    interval="preserveStartEnd"
                    minTickGap={50}
                  />
                  <YAxis
                    yAxisId="usd"
                    tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`}
                    width={65}
                  />
                  <YAxis
                    yAxisId="users"
                    orientation="right"
                    tick={{ fontSize: 10, fill: "#FF4444" }}
                    width={45}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(255, 255, 255, 0.15)", strokeDasharray: "3 3" }}
                    contentStyle={{
                      background: "var(--tooltip-bg)",
                      border: "1px solid var(--card-border)",
                      borderRadius: 4,
                      fontSize: 11,
                      color: "var(--text-primary)",
                    }}
                    itemStyle={{ color: "var(--text-primary)" }}
                    labelStyle={{ color: "var(--text-secondary)", fontWeight: 600 }}
                    formatter={(v: any, n: any) => {
                      if (n === "underwater")
                        return [`${v} positions`, "Underwater users"]
                      return [formatUSD(Number(v)), n]
                    }}
                  />
                  <ReferenceArea
                    x1={eventStartLabel}
                    x2={eventEndLabel}
                    yAxisId="usd"
                    fill="rgba(255, 68, 68, 0.06)"
                    stroke="rgba(255, 68, 68, 0.3)"
                    strokeDasharray="3 3"
                  />
                  <Area
                    yAxisId="usd"
                    name="Collateral"
                    dataKey="collateral"
                    stroke="#5B7FFF"
                    fill="#5B7FFF"
                    fillOpacity={0.15}
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Area
                    yAxisId="usd"
                    name="Debt"
                    dataKey="debt"
                    stroke="#FF6B35"
                    fill="#FF6B35"
                    fillOpacity={0.18}
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Area
                    yAxisId="usd"
                    name="Bad debt"
                    dataKey="badDebt"
                    stroke="#FF4444"
                    fill="#FF4444"
                    fillOpacity={0.45}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="users"
                    name="underwater"
                    dataKey="underwater"
                    stroke="#FF4444"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartWrapper>

            <div
              className="tui-card rounded p-3 text-[10px] leading-relaxed"
              style={{
                background: "rgba(91, 127, 255, 0.05)",
                border: "1px solid rgba(91, 127, 255, 0.2)",
                color: "var(--text-secondary)",
              }}
            >
              <span className="font-semibold text-text-primary">How this is computed: </span>
              for each hour in the analysis window, every address that has ever held
              aRsETH on Aave V3 mainnet is queried via{" "}
              <code className="text-accent">Pool.getUserAccountData(user)</code> at the
              corresponding archive block. The aggregate plotted is the sum of
              <span style={{ color: "#5B7FFF" }}> total collateral</span>,
              <span style={{ color: "#FF6B35" }}> total debt</span>, and the residual{" "}
              <span style={{ color: "#FF4444" }}>bad debt</span> = max(0, debt − collateral)
              for any user where debt exceeds collateral. Counts the number of
              underwater users on the right axis. The shaded red region is the depeg
              event window (Apr 18 – 25).
            </div>
          </div>
        )
      })()}

      {/* "Who showed up" — top historical liquidators × event window activity */}
      {loading && !data ? (
        <SkeletonTable
          columns={5}
          rows={10}
          headers={["Bot", "Total liqs", "Distinct collateral", "Profit", "rsETH window"]}
          title="Who showed up vs. who didn't"
        />
      ) : (
        <div className="tui-card bg-card-bg border border-card-border rounded overflow-hidden">
          <div className="px-3 py-2 border-b border-card-border flex items-center justify-between">
            <h3 className="text-xs font-medium text-text-secondary">
              Top 50 Aave V3 + Morpho Liquidators — Did They Show Up for rsETH?
            </h3>
            <span className="text-[10px] text-text-tertiary">
              {showedUpCount} of {topBots.length} active in event window ·{" "}
              {everTouchedCount} of {topBots.length} have ever liquidated rsETH
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-text-tertiary border-b border-card-border">
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">Bot</th>
                  <th className="text-right px-3 py-2 font-medium">Total liqs</th>
                  <th className="text-right px-3 py-2 font-medium">Distinct collateral</th>
                  <th className="text-right px-3 py-2 font-medium">Total profit</th>
                  <th className="text-center px-3 py-2 font-medium">rsETH event window</th>
                  <th className="text-center px-3 py-2 font-medium">Ever touched rsETH</th>
                </tr>
              </thead>
              <tbody>
                {topBots.slice(0, 25).map((b, i) => (
                  <tr
                    key={b.liquidator}
                    className="border-b border-card-border/50 hover:bg-card-hover transition-colors"
                  >
                    <td className="px-3 py-2 text-text-tertiary">{i + 1}</td>
                    <td className="px-3 py-2 text-text-primary">
                      <a
                        href={etherscanAddress(b.liquidator)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-accent"
                        title={b.liquidator}
                      >
                        {formatAddress(b.liquidator)}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right text-text-secondary">
                      {formatNumber(b.totalEvents)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-secondary">
                      {b.distinctCollateral}
                    </td>
                    <td className="px-3 py-2 text-right text-positive">
                      {formatUSD(b.totalProfit)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {b.activeInEventWindow ? (
                        <span style={{ color: "var(--positive)" }} title="Active during event window">
                          ✓
                        </span>
                      ) : (
                        <span style={{ color: "#FF4444" }} title="No-show during event window">
                          ✗
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-text-tertiary">
                      {b.everTouchedRseth ? (
                        <span title="Has liquidated rsETH at some point">●</span>
                      ) : (
                        <span style={{ color: "var(--text-tertiary)" }} title="Never liquidated rsETH">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* By-pair breakdown */}
      {loading && !data ? (
        <SkeletonTable
          columns={6}
          rows={8}
          headers={["Pair", "Protocol", "Events", "Volume", "Profit", "Last seen"]}
          title="Historical rsETH liquidations by pair"
        />
      ) : (
        data && data.byPair.length > 0 && (
          <div className="tui-card bg-card-bg border border-card-border rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-card-border">
              <h3 className="text-xs font-medium text-text-secondary">
                Historical rsETH Liquidations by Pair
              </h3>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-text-tertiary border-b border-card-border">
                  <th className="text-left px-3 py-2 font-medium">Protocol</th>
                  <th className="text-left px-3 py-2 font-medium">Pair</th>
                  <th className="text-right px-3 py-2 font-medium">Events</th>
                  <th className="text-right px-3 py-2 font-medium">Volume</th>
                  <th className="text-right px-3 py-2 font-medium">Profit</th>
                  <th className="text-right px-3 py-2 font-medium">Bots</th>
                  <th className="text-right px-3 py-2 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.byPair.map((p) => (
                  <tr
                    key={`${p.protocol}-${p.collateralSymbol}-${p.debtSymbol}`}
                    className="border-b border-card-border/50 hover:bg-card-hover"
                  >
                    <td className="px-3 py-2 text-text-secondary">{protocolLabel(p.protocol)}</td>
                    <td className="px-3 py-2 text-text-primary">
                      <span className="font-medium">{p.collateralSymbol}</span>
                      <span className="text-text-tertiary mx-1">/</span>
                      <span>{p.debtSymbol}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-text-secondary">
                      {formatNumber(p.events)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-secondary">
                      {formatUSD(p.volume)}
                    </td>
                    <td className="px-3 py-2 text-right text-positive">
                      {formatUSD(p.profit)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-tertiary">{p.liquidators}</td>
                    <td className="px-3 py-2 text-right text-text-tertiary">
                      {p.lastTimestamp ? fmtDate(p.lastTimestamp) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Methodology + caveats */}
      <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[11px] leading-relaxed space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-text-primary mb-1">Methodology</h3>
          <p className="text-text-secondary">
            All counts are direct queries on the indexer's{" "}
            <code className="text-accent">liquidation_events</code> table — every
            on-chain <code className="text-accent">LiquidationCall</code> event from
            Aave V3, SparkLend, Morpho Blue, and Fluid is captured here. The rsETH
            filter matches case-insensitively on either collateral or debt symbol so
            wrapped variants (wrsETH, rseth-wrapped, etc.) are included. The event
            window is defined as the 7 days following the depeg trigger.
          </p>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-text-primary mb-1">Data freshness</h3>
          <div className="text-text-secondary">
            Last block scanned per protocol:
            <ul className="ml-4 mt-1">
              {data?.scannerState.map((s) => (
                <li key={s.name}>
                  <span className="text-text-tertiary">{protocolLabel(s.name)}:</span> block{" "}
                  <span className="text-text-primary">{formatNumber(s.lastBlock)}</span> ·{" "}
                  <span className="text-text-tertiary">{s.updatedAt.slice(0, 16).replace("T", " ")}Z</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-text-primary mb-1">What's missing</h3>
          <ul className="text-text-secondary list-disc ml-5 space-y-1">
            <li>
              <strong>Failed/reverted liquidation attempts</strong> — would prove "bots
              tried but couldn't" rather than "bots didn't try." Requires failed-tx
              archives or Flashbots data.
            </li>
            <li>
              <strong>Oracle vs market price gap</strong> — needs Chainlink rsETH
              oracle reads paired with rsETH/ETH DEX VWAP across the event window.
            </li>
            <li>
              <strong>Cross-protocol bad-debt aggregation</strong> — current curve
              covers Aave V3 only. Morpho Blue and Spark would need their own
              user-state probes.
            </li>
          </ul>
        </div>
      </div>
    </main>
  )
}
