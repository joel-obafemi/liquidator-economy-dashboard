"use client"

import { useState, useEffect } from "react"
import { useCachedFetch } from "@/lib/use-cached-fetch"
import {
  formatUSD, formatNumber, formatDate, formatAddress, etherscanAddress, protocolLabel, CHART_COLORS,
} from "@/lib/utils"
import { MetricCard } from "@/components/metric-card"
import { ProtocolToggle } from "@/components/protocol-toggle"
import { SkeletonBar, SkeletonKpiRow, SkeletonChart } from "@/components/skeleton"
import Link from "next/link"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, Cell, Treemap,
} from "recharts"

interface InsightsData {
  netProfit: {
    withGasData: number
    profitableCount: number
    unprofitableCount: number
    totalGasUsd: number
    avgGasUsd: number
    avgGasGwei: number
    totalNetProfit: number
    totalGrossProfit: number
    totalEvents: number
  }
  profitDistribution: Array<{ bucket: string; count: number; totalProfit: number }>
  cascades: {
    topCascades: Array<{
      blockNumber: number
      blockTimestamp: number
      eventsInBlock: number
      blockVolume: number
      uniqueBorrowers: number
    }>
    stats: {
      cascadeBlocks: number
      majorCascadeBlocks: number
      maxEventsInBlock: number
      totalCascadeEvents: number
    }
  }
  repeatBorrowers: {
    topOffenders: Array<{
      borrower: string
      timesLiquidated: number
      totalVolumeLost: number
      totalProfitGiven: number
      firstLiquidation: number
      lastLiquidation: number
      collateralAssets: string[]
    }>
    stats: {
      totalBorrowers: number
      repeatBorrowers: number
      serialBorrowers: number
      repeatVolume: number
      totalVolume: number
    }
  }
  concentration: Array<{
    month: string
    totalProfit: number
    numLiquidators: number
    top5Profit: number
    top5Share: number
  }>
  bonusEfficiency: Array<{
    collateralSymbol: string
    count: number
    avgBonusPct: number
    avgGrossProfit: number
    avgGasCost: number
    avgNetProfit: number
  }>
  crossProtocol: {
    breakdown: Array<{ numProtocols: number; count: number; totalProfit: number }>
    totalDistinct: number
  }
  collateralDebtPairs: Array<{
    collateral: string
    debt: string
    pair: string
    eventCount: number
    totalVolume: number
    totalProfit: number
    uniqueLiquidators: number
    avgBonusPct: number
  }>
}

const BUCKET_LABELS: Record<string, string> = {
  loss_gt_100: "< -$100",
  loss_10_100: "-$100 to -$10",
  loss_0_10: "-$10 to $0",
  profit_0_10: "$0 to $10",
  profit_10_100: "$10 to $100",
  profit_100_1k: "$100 to $1K",
  profit_1k_10k: "$1K to $10K",
  profit_gt_10k: "> $10K",
}

const BUCKET_ORDER = [
  "loss_gt_100", "loss_10_100", "loss_0_10",
  "profit_0_10", "profit_10_100", "profit_100_1k", "profit_1k_10k", "profit_gt_10k",
]

const BONUS_EFFICIENCY_PAGE_SIZE = 20

function TreemapCell(props: any) {
  const { x, y, width, height, name, fill, volume } = props
  if (width < 2 || height < 2) return null
  const showLabel = width > 55 && height > 30
  const showVolume = width > 70 && height > 45
  const textShadow = "0 1px 3px rgba(0,0,0,0.6)"
  return (
    <g>
      <rect
        x={x} y={y} width={width} height={height}
        fill={fill} opacity={0.8}
        rx={3} ry={3}
        style={{ cursor: "pointer" }}
      />
      {showLabel && (
        <text
          x={x + width / 2} y={y + height / 2 - (showVolume ? 6 : 0)}
          textAnchor="middle" dominantBaseline="central"
          fill="#fff" fontSize={width > 100 ? 11 : 9.5} fontWeight={500}
          fontFamily="JetBrains Mono, monospace"
          style={{ pointerEvents: "none", textShadow }}
        >
          {name}
        </text>
      )}
      {showVolume && (
        <text
          x={x + width / 2} y={y + height / 2 + 12}
          textAnchor="middle" dominantBaseline="central"
          fill="rgba(255,255,255,0.8)" fontSize={8.5} fontWeight={400}
          fontFamily="JetBrains Mono, monospace"
          style={{ pointerEvents: "none", textShadow }}
        >
          {formatUSD(volume)}
        </text>
      )}
    </g>
  )
}

export default function InsightsPage() {
  const [protocol, setProtocol] = useState("all")
  const [bonusPage, setBonusPage] = useState(1)

  // Reset table pagination whenever the protocol filter changes
  useEffect(() => {
    setBonusPage(1)
  }, [protocol])

  const { data, loading } = useCachedFetch<InsightsData>(
    `/api/insights?protocol=${protocol}`,
    { ttl: 5 * 60 * 1000 }
  )

  const np = data?.netProfit
  const unprofitablePct = np && np.withGasData > 0
    ? ((np.unprofitableCount / np.withGasData) * 100).toFixed(1)
    : "0"

  // Sort profit distribution by bucket order
  const sortedDist = (data?.profitDistribution || [])
    .filter((d) => d.bucket !== "no_gas_data")
    .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket))
    .map((d) => ({
      ...d,
      label: BUCKET_LABELS[d.bucket] || d.bucket,
      fill: d.bucket.startsWith("loss") ? CHART_COLORS.negative : CHART_COLORS.positive,
    }))

  const repeatStats = data?.repeatBorrowers?.stats
  const repeatPct = repeatStats && repeatStats.totalBorrowers > 0
    ? ((repeatStats.repeatBorrowers / repeatStats.totalBorrowers) * 100).toFixed(1)
    : "0"
  const repeatVolPct = repeatStats && repeatStats.totalVolume > 0
    ? ((repeatStats.repeatVolume / repeatStats.totalVolume) * 100).toFixed(1)
    : "0"

  // Full-page skeleton while initial data loads
  if (loading && !data) {
    return (
      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <SkeletonBar width={180} height={16} className="animate-pulse" />
            <SkeletonBar width={320} height={10} className="animate-pulse" />
          </div>
          <ProtocolToggle protocol={protocol} onProtocolChange={setProtocol} />
        </div>

        {/* Net Profit section */}
        <div className="space-y-3">
          <SkeletonBar width={240} height={12} className="animate-pulse" />
          <SkeletonKpiRow count={5} />
        </div>

        {/* Histogram */}
        <SkeletonChart height={250} />

        {/* Treemap section */}
        <div className="space-y-3">
          <SkeletonBar width={320} height={12} className="animate-pulse" />
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2"><SkeletonChart height={380} /></div>
            <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse space-y-3">
              <SkeletonBar width={120} height={11} />
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between">
                    <SkeletonBar width={80} height={10} />
                    <SkeletonBar width={60} height={10} />
                  </div>
                  <SkeletonBar width="100%" height={8} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Cascades section */}
        <div className="space-y-3">
          <SkeletonBar width={180} height={12} className="animate-pulse" />
          <SkeletonKpiRow count={4} />
          <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse space-y-3">
            <SkeletonBar width={140} height={11} />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <SkeletonBar width={90} height={10} />
                <div className="flex-1" />
                <SkeletonBar width={60} height={10} />
                <SkeletonBar width={40} height={10} />
                <SkeletonBar width={70} height={10} />
                <SkeletonBar width={40} height={10} />
              </div>
            ))}
          </div>
        </div>

        {/* Repeat offenders section */}
        <div className="space-y-3">
          <SkeletonBar width={180} height={12} className="animate-pulse" />
          <SkeletonKpiRow count={4} />
          <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse space-y-3">
            <SkeletonBar width={180} height={11} />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <SkeletonBar width={110} height={10} />
                <div className="flex-1" />
                <SkeletonBar width={40} height={10} />
                <SkeletonBar width={60} height={10} />
                <SkeletonBar width={60} height={10} />
                <SkeletonBar width={80} height={10} />
              </div>
            ))}
          </div>
        </div>

        {/* Concentration chart */}
        <div className="space-y-3">
          <SkeletonBar width={200} height={12} className="animate-pulse" />
          <SkeletonChart height={280} />
        </div>
        <SkeletonChart height={200} />

        {/* Bonus efficiency table */}
        <div className="space-y-3">
          <SkeletonBar width={260} height={12} className="animate-pulse" />
          <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <SkeletonBar width={60} height={10} />
                <div className="flex-1" />
                <SkeletonBar width={40} height={10} />
                <SkeletonBar width={60} height={10} />
                <SkeletonBar width={70} height={10} />
                <SkeletonBar width={60} height={10} />
                <SkeletonBar width={60} height={10} />
                <SkeletonBar width={50} height={10} />
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Research Insights</h1>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            Advanced analytics: net profit, cascades, concentration, and more
          </p>
        </div>
        <ProtocolToggle protocol={protocol} onProtocolChange={setProtocol} />
      </div>

      {/* === SECTION 1: Net Profit Analysis === */}
      <div>
        <h2 className="text-sm font-semibold text-accent mb-3">Net Profit Analysis (After Gas)</h2>
        <div className="grid grid-cols-5 gap-3">
          <MetricCard
            label="Unprofitable After Gas"
            value={`${unprofitablePct}%`}
            sub={`${np?.unprofitableCount || 0} of ${np?.withGasData || 0} events`}
            accent
          />
          <MetricCard
            label="Total Gas Spent"
            value={formatUSD(np?.totalGasUsd || 0)}
            sub={`Avg ${formatUSD(np?.avgGasUsd || 0)} per event`}
          />
          <MetricCard
            label="Net Profit (After Gas)"
            value={formatUSD(np?.totalNetProfit || 0)}
            sub={`vs ${formatUSD(np?.totalGrossProfit || 0)} gross`}
          />
          <MetricCard
            label="Avg Gas Price"
            value={`${(np?.avgGasGwei || 0).toFixed(1)} gwei`}
          />
          <MetricCard
            label="Gas Data Coverage"
            value={`${np?.withGasData || 0} / ${np?.totalEvents || 0}`}
            sub={np && np.totalEvents > 0 ? `${((np.withGasData / np.totalEvents) * 100).toFixed(0)}% covered` : ""}
          />
        </div>
      </div>

      {/* Profit Distribution Histogram + Cross-Protocol Activity side-by-side */}
      <div className="grid grid-cols-2 gap-4">
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-3">
            Net Profit Distribution Per Liquidation
          </h2>
          <div className="h-[250px]">
            {sortedDist.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sortedDist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--text-tertiary)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--text-tertiary)" }} />
                  <Tooltip
                    cursor={{ fill: "var(--hover-overlay)" }}
                    contentStyle={{
                      background: "var(--tooltip-bg)",
                      border: "1px solid var(--card-border)",
                      borderRadius: 4,
                      fontSize: 11,
                      color: "var(--text-primary)",
                    }}
                    labelStyle={{ color: "var(--text-primary)" }}
                    itemStyle={{ color: "var(--text-primary)" }}
                    formatter={(v: number) => [formatNumber(v), "Events"]}
                  />
                  <Bar dataKey="count" name="Events">
                    {sortedDist.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">
                {np?.withGasData === 0 ? "Run gas backfill to see this chart" : "No data"}
              </div>
            )}
          </div>
        </div>

        {/* Cross-Protocol Activity breakdown */}
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-xs font-medium text-text-secondary">
              Cross-Protocol Liquidator Activity
            </h2>
            {data?.crossProtocol?.totalDistinct ? (
              <span className="text-[10px] text-text-tertiary">
                {formatNumber(data.crossProtocol.totalDistinct)} distinct liquidators
              </span>
            ) : null}
          </div>
          {data?.crossProtocol?.breakdown && data.crossProtocol.breakdown.length > 0 ? (
            <div className="h-[250px] flex items-center">
              <div className="w-full space-y-3">
                {data.crossProtocol.breakdown.map((row) => {
                  const total = data.crossProtocol.totalDistinct || 1
                  const pct = (row.count / total) * 100
                  const labels = ["", "1 protocol only", "2 protocols", "3 protocols", "All 4 protocols"]
                  const label = labels[row.numProtocols] || `${row.numProtocols} protocols`
                  const colorMap = [
                    "",
                    "bg-text-tertiary",
                    "bg-accent/60",
                    "bg-accent/80",
                    "bg-accent",
                  ]
                  const barColor = colorMap[row.numProtocols] || "bg-accent"
                  return (
                    <div key={row.numProtocols}>
                      <div className="flex items-baseline justify-between text-[11px] mb-1">
                        <span className={`font-medium ${row.numProtocols === 4 ? "text-accent" : "text-text-primary"}`}>
                          {label}
                        </span>
                        <span className="text-text-secondary font-mono">
                          {row.count} <span className="text-text-tertiary">({pct.toFixed(1)}%)</span>
                        </span>
                      </div>
                      <div className="h-4 bg-card-border/40 rounded overflow-hidden">
                        <div
                          className={`h-full ${barColor} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-[9px] text-text-tertiary mt-0.5 font-mono">
                        {formatUSD(row.totalProfit)} in gross profit
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-text-tertiary text-xs">
              Select the &ldquo;All&rdquo; protocol filter to see the breakdown
            </div>
          )}
          <p className="text-[10px] text-text-tertiary mt-3 leading-relaxed">
            Only the top operators have the infrastructure to monitor and execute on
            every protocol. The vast majority specialise in a single lending market.
          </p>
        </div>
      </div>

      {/* === SECTION 2: Collateral-Debt Pair Treemap === */}
      <div>
        <h2 className="text-sm font-semibold text-accent mb-3">Top Collateral–Debt Pairs by Liquidation Volume</h2>
        <div className="grid grid-cols-3 gap-4">
          {/* Treemap */}
          <div className="col-span-2 tui-card bg-card-bg border border-card-border rounded p-4">
            <h3 className="text-xs font-medium text-text-secondary mb-3">
              Volume Treemap — larger area = more liquidation volume
            </h3>
            <div className="h-[380px]">
              {(data?.collateralDebtPairs || []).length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={(data?.collateralDebtPairs || []).map((p, i) => ({
                      name: p.pair,
                      size: p.totalVolume,
                      volume: p.totalVolume,
                      profit: p.totalProfit,
                      events: p.eventCount,
                      liquidators: p.uniqueLiquidators,
                      bonus: p.avgBonusPct,
                      fill: [
                        CHART_COLORS.aave_v3,
                        CHART_COLORS.morpho_blue,
                        CHART_COLORS.spark,
                        CHART_COLORS.fluid,
                        CHART_COLORS.accent,
                        "#6366F1",
                        "#EC4899",
                        "#14B8A6",
                      ][i % 8],
                    }))}
                    dataKey="size"
                    stroke="var(--card-bg)"
                    isAnimationActive={false}
                    content={<TreemapCell />}
                  >
                    <Tooltip
                      content={({ payload }: any) => {
                        if (!payload || !payload.length) return null
                        const d = payload[0]?.payload
                        if (!d) return null
                        return (
                          <div
                            style={{
                              background: "var(--tooltip-bg)",
                              border: "1px solid var(--card-border)",
                              borderRadius: 6,
                              padding: "10px 14px",
                              fontSize: 11,
                              color: "var(--text-primary)",
                              fontFamily: "JetBrains Mono, monospace",
                              minWidth: 180,
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: d.fill }}>
                              {d.name}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                              <span style={{ color: "var(--text-tertiary)" }}>Volume</span>
                              <span style={{ fontWeight: 600 }}>{formatUSD(d.volume)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                              <span style={{ color: "var(--text-tertiary)" }}>Profit</span>
                              <span style={{ color: "var(--positive)" }}>{formatUSD(d.profit)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                              <span style={{ color: "var(--text-tertiary)" }}>Events</span>
                              <span>{formatNumber(d.events)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                              <span style={{ color: "var(--text-tertiary)" }}>Liquidators</span>
                              <span>{d.liquidators}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "var(--text-tertiary)" }}>Avg Bonus</span>
                              <span>{d.bonus.toFixed(2)}%</span>
                            </div>
                          </div>
                        )
                      }}
                    />
                  </Treemap>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
              )}
            </div>
          </div>

          {/* Top Pairs Ranked List */}
          <div className="tui-card bg-card-bg border border-card-border rounded p-4">
            <h3 className="text-xs font-medium text-text-secondary mb-3">
              Top Pairs Ranked
            </h3>
            <div className="space-y-2 overflow-y-auto max-h-[360px] pr-1">
              {(data?.collateralDebtPairs || []).slice(0, 15).map((p, i) => {
                const maxVol = data?.collateralDebtPairs?.[0]?.totalVolume || 1
                const pct = (p.totalVolume / maxVol) * 100
                return (
                  <div key={p.pair}>
                    <div className="flex items-baseline justify-between text-[11px] mb-0.5">
                      <span className="font-medium text-text-primary">
                        <span className="text-text-tertiary mr-1.5">#{i + 1}</span>
                        {p.pair}
                      </span>
                      <span className="text-text-secondary font-mono text-[10px]">
                        {formatUSD(p.totalVolume)}
                      </span>
                    </div>
                    <div className="h-2 bg-card-border/30 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: [
                            CHART_COLORS.aave_v3,
                            CHART_COLORS.morpho_blue,
                            CHART_COLORS.spark,
                            CHART_COLORS.fluid,
                            CHART_COLORS.accent,
                            "#6366F1",
                            "#EC4899",
                            "#14B8A6",
                          ][i % 8],
                          opacity: 0.8,
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-3 text-[9px] text-text-tertiary mt-0.5">
                      <span>{formatNumber(p.eventCount)} events</span>
                      <span className="text-positive">{formatUSD(p.totalProfit)} profit</span>
                      <span>{p.uniqueLiquidators} liquidators</span>
                    </div>
                  </div>
                )
              })}
              {(!data?.collateralDebtPairs || data.collateralDebtPairs.length === 0) && (
                <div className="text-text-tertiary text-xs text-center py-8">No data</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* === SECTION 3: Cascades === */}
      <div>
        <h2 className="text-sm font-semibold text-accent mb-3">Liquidation Cascades</h2>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <MetricCard
            label="Cascade Events"
            value={formatNumber(data?.cascades?.stats?.cascadeBlocks || 0)}
            sub="Blocks with 2+ liquidations"
            accent
          />
          <MetricCard
            label="Major Cascades"
            value={formatNumber(data?.cascades?.stats?.majorCascadeBlocks || 0)}
            sub="Blocks with 5+ liquidations"
          />
          <MetricCard
            label="Max in Single Block"
            value={formatNumber(data?.cascades?.stats?.maxEventsInBlock || 0)}
            sub="Largest cascade"
          />
          <MetricCard
            label="Events in Cascades"
            value={formatNumber(data?.cascades?.stats?.totalCascadeEvents || 0)}
            sub={np ? `${((data?.cascades?.stats?.totalCascadeEvents || 0) / np.totalEvents * 100).toFixed(0)}% of all events` : ""}
          />
        </div>

        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h3 className="text-xs font-medium text-text-secondary mb-3">Top Cascade Events</h3>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-text-tertiary border-b border-card-border">
                <th className="text-left pb-2 font-medium">Date</th>
                <th className="text-right pb-2 font-medium">Block</th>
                <th className="text-right pb-2 font-medium">Liquidations</th>
                <th className="text-right pb-2 font-medium">Total Volume</th>
                <th className="text-right pb-2 font-medium">Borrowers Hit</th>
              </tr>
            </thead>
            <tbody>
              {(data?.cascades?.topCascades || []).slice(0, 10).map((c) => (
                <tr key={c.blockNumber} className="border-b border-card-border/40">
                  <td className="py-2 text-text-secondary">{formatDate(c.blockTimestamp)}</td>
                  <td className="py-2 text-right font-mono text-text-secondary">{c.blockNumber.toLocaleString()}</td>
                  <td className="py-2 text-right text-accent font-medium">{c.eventsInBlock}</td>
                  <td className="py-2 text-right">{formatUSD(c.blockVolume)}</td>
                  <td className="py-2 text-right text-text-secondary">{c.uniqueBorrowers}</td>
                </tr>
              ))}
              {(!data?.cascades?.topCascades || data.cascades.topCascades.length === 0) && (
                <tr><td colSpan={5} className="py-4 text-center text-text-tertiary">No cascades found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* === SECTION 3: Repeat Offenders === */}
      <div>
        <h2 className="text-sm font-semibold text-accent mb-3">Repeat Offenders</h2>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <MetricCard
            label="Repeat Borrowers"
            value={`${repeatPct}%`}
            sub={`${repeatStats?.repeatBorrowers || 0} of ${repeatStats?.totalBorrowers || 0}`}
            accent
          />
          <MetricCard
            label="Serial Offenders (5+)"
            value={formatNumber(repeatStats?.serialBorrowers || 0)}
            sub="Liquidated 5+ times"
          />
          <MetricCard
            label="Repeat Volume"
            value={formatUSD(repeatStats?.repeatVolume || 0)}
            sub={`${repeatVolPct}% of total`}
          />
          <MetricCard
            label="Total Borrowers"
            value={formatNumber(repeatStats?.totalBorrowers || 0)}
          />
        </div>

        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h3 className="text-xs font-medium text-text-secondary mb-3">Most Liquidated Borrowers</h3>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-text-tertiary border-b border-card-border">
                <th className="text-left pb-2 font-medium">Borrower</th>
                <th className="text-right pb-2 font-medium">Times Liquidated</th>
                <th className="text-right pb-2 font-medium">Volume Lost</th>
                <th className="text-right pb-2 font-medium">Profit Given</th>
                <th className="text-left pb-2 font-medium">Assets</th>
                <th className="text-right pb-2 font-medium">Period</th>
              </tr>
            </thead>
            <tbody>
              {(data?.repeatBorrowers?.topOffenders || []).map((b) => (
                <tr key={b.borrower} className="border-b border-card-border/40">
                  <td className="py-2">
                    <a href={etherscanAddress(b.borrower)} target="_blank" rel="noopener noreferrer"
                       className="text-accent hover:underline">{formatAddress(b.borrower)}</a>
                  </td>
                  <td className="py-2 text-right text-negative font-medium">{b.timesLiquidated}</td>
                  <td className="py-2 text-right">{formatUSD(b.totalVolumeLost)}</td>
                  <td className="py-2 text-right text-text-secondary">{formatUSD(b.totalProfitGiven)}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {b.collateralAssets.slice(0, 3).map((a) => (
                        <span key={a} className="px-1 py-0.5 rounded text-[9px] bg-card-border/50">{a}</span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 text-right text-text-tertiary text-[10px]">
                    {formatDate(b.firstLiquidation)} - {formatDate(b.lastLiquidation)}
                  </td>
                </tr>
              ))}
              {(!data?.repeatBorrowers?.topOffenders || data.repeatBorrowers.topOffenders.length === 0) && (
                <tr><td colSpan={6} className="py-4 text-center text-text-tertiary">No repeat offenders found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* === SECTION 4: Market Concentration === */}
      <div>
        <h2 className="text-sm font-semibold text-accent mb-3">Market Concentration</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="tui-card bg-card-bg border border-card-border rounded p-4">
            <h3 className="text-xs font-medium text-text-secondary mb-3">
              Top 5 Liquidators Profit Share Over Time
            </h3>
            <div className="h-[240px]">
              {(data?.concentration || []).length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data!.concentration}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                      tickFormatter={(v) => v.slice(2)}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--tooltip-bg)",
                        border: "1px solid var(--card-border)",
                        borderRadius: 4,
                        fontSize: 11,
                        color: "var(--text-primary)",
                      }}
                      labelStyle={{ color: "var(--text-primary)" }}
                      itemStyle={{ color: "var(--text-primary)" }}
                      formatter={(v: number, name: string) => {
                        if (name === "top5Share") return [`${v.toFixed(1)}%`, "Top 5 Share"]
                        if (name === "numLiquidators") return [v, "Active Liquidators"]
                        return [v, name]
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="top5Share"
                      stroke={CHART_COLORS.accent}
                      fill={CHART_COLORS.accent}
                      fillOpacity={0.15}
                      name="top5Share"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
              )}
            </div>
          </div>

          <div className="tui-card bg-card-bg border border-card-border rounded p-4">
            <h3 className="text-xs font-medium text-text-secondary mb-3">
              Active Liquidators Per Month
            </h3>
            <div className="h-[240px]">
              {(data?.concentration || []).length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data!.concentration}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                      tickFormatter={(v) => v.slice(2)}
                    />
                    <YAxis tick={{ fontSize: 10, fill: "var(--text-tertiary)" }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--tooltip-bg)",
                        border: "1px solid var(--card-border)",
                        borderRadius: 4,
                        fontSize: 11,
                        color: "var(--text-primary)",
                      }}
                      labelStyle={{ color: "var(--text-primary)" }}
                      itemStyle={{ color: "var(--text-primary)" }}
                    />
                    <Line type="monotone" dataKey="numLiquidators" stroke={CHART_COLORS.spark} name="Active Liquidators" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* === SECTION 5: Bonus Efficiency === */}
      <div>
        <h2 className="text-sm font-semibold text-accent mb-3">Liquidation Bonus Efficiency by Asset</h2>
        {(() => {
          const all = data?.bonusEfficiency || []
          const totalPages = Math.max(1, Math.ceil(all.length / BONUS_EFFICIENCY_PAGE_SIZE))
          const currentPage = Math.min(bonusPage, totalPages)
          const pagedRows = all.slice(
            (currentPage - 1) * BONUS_EFFICIENCY_PAGE_SIZE,
            currentPage * BONUS_EFFICIENCY_PAGE_SIZE
          )

          return (
            <div className="tui-card bg-card-bg border border-card-border rounded p-4">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-text-tertiary border-b border-card-border">
                    <th className="text-left pb-2 font-medium">Collateral</th>
                    <th className="text-right pb-2 font-medium">Events</th>
                    <th className="text-right pb-2 font-medium">Avg Bonus %</th>
                    <th className="text-right pb-2 font-medium">Avg Gross Profit</th>
                    <th className="text-right pb-2 font-medium">Avg Gas Cost</th>
                    <th className="text-right pb-2 font-medium">Avg Net Profit</th>
                    <th className="text-right pb-2 font-medium">Margin After Gas</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((b) => {
                    const marginAfterGas = b.avgGasCost > 0
                      ? ((b.avgNetProfit / (b.avgGrossProfit + b.avgGasCost)) * 100)
                      : null
                    return (
                      <tr key={b.collateralSymbol} className="border-b border-card-border/40">
                        <td className="py-2 font-medium">{b.collateralSymbol}</td>
                        <td className="py-2 text-right text-text-secondary">{b.count}</td>
                        <td className="py-2 text-right">{b.avgBonusPct.toFixed(2)}%</td>
                        <td className="py-2 text-right text-positive">{formatUSD(b.avgGrossProfit)}</td>
                        <td className="py-2 text-right text-negative">
                          {b.avgGasCost > 0 ? formatUSD(b.avgGasCost) : "—"}
                        </td>
                        <td className={`py-2 text-right font-medium ${b.avgNetProfit >= 0 ? "text-positive" : "text-negative"}`}>
                          {b.avgGasCost > 0 ? formatUSD(b.avgNetProfit) : "—"}
                        </td>
                        <td className="py-2 text-right text-text-secondary">
                          {marginAfterGas !== null ? `${marginAfterGas.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    )
                  })}
                  {all.length === 0 && (
                    <tr><td colSpan={7} className="py-4 text-center text-text-tertiary">No data</td></tr>
                  )}
                </tbody>
              </table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-card-border">
                  <span className="text-[10px] text-text-tertiary">
                    Showing{" "}
                    {(currentPage - 1) * BONUS_EFFICIENCY_PAGE_SIZE + 1}–
                    {Math.min(currentPage * BONUS_EFFICIENCY_PAGE_SIZE, all.length)} of{" "}
                    {all.length} assets · Page {currentPage} of {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setBonusPage(1)}
                      disabled={currentPage <= 1}
                      className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
                    >
                      « First
                    </button>
                    <button
                      onClick={() => setBonusPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage <= 1}
                      className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
                    >
                      ‹ Prev
                    </button>
                    <button
                      onClick={() => setBonusPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage >= totalPages}
                      className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
                    >
                      Next ›
                    </button>
                    <button
                      onClick={() => setBonusPage(totalPages)}
                      disabled={currentPage >= totalPages}
                      className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
                    >
                      Last »
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </main>
  )
}
