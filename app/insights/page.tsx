"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useCachedFetch } from "@/lib/use-cached-fetch"
import {
  formatUSD, formatNumber, formatDate, formatAddress, etherscanAddress, etherscanTx, protocolLabel, CHART_COLORS,
} from "@/lib/utils"
import { MetricCard } from "@/components/metric-card"
import { ProtocolToggle } from "@/components/protocol-toggle"
import { SkeletonBar, SkeletonKpiRow, SkeletonChart } from "@/components/skeleton"
import { ChartWrapper } from "@/components/chart-wrapper"
import Link from "next/link"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, Cell, Treemap,
  PieChart, Pie,
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
  overlapMatrix: Array<{
    protocolA: string
    protocolB: string
    sharedLiquidators: number
    sharedVolume: number
    sharedProfit: number
  }>
  protocolStats: Array<{
    protocol: string
    uniqueLiquidators: number
    totalVolume: number
    totalProfit: number
  }>
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
  sizeDistribution: Array<{
    bucket: string
    sortOrder: number
    count: number
    totalVolume: number
    avgSize: number
  }>
  monthlyProfit: Array<{
    month: string
    protocol: string
    grossProfit: number
    netProfit: number
    eventCount: number
  }>
  gasByLiquidator: Array<{
    liquidator: string
    eventCount: number
    avgGasGwei: number
    avgGasUsd: number
    avgGasUsed: number
    totalGasUsd: number
    totalGrossProfit: number
    totalNetProfit: number
    eventsWithGas: number
  }>
  profitConcentration: Array<{
    tier: string
    sortOrder: number
    liquidatorCount: number
    tierProfit: number
    tierEvents: number
  }>
  flashLoans: {
    stats: {
      flashEvents: number
      nonFlashEvents: number
      flashLiquidators: number
      nonFlashLiquidators: number
      flashVolume: number
      nonFlashVolume: number
      flashProfit: number
      nonFlashProfit: number
      avgFlashSize: number
      avgNonFlashSize: number
      avgFlashProfit: number
      avgNonFlashProfit: number
      avgFlashGas: number
      avgNonFlashGas: number
      totalEvents: number
    }
    bySource: Array<{
      source: string
      eventCount: number
      uniqueLiquidators: number
      volume: number
      profit: number
    }>
    monthly: Array<{
      month: string
      flashCount: number
      nonFlashCount: number
      flashVolume: number
      nonFlashVolume: number
    }>
    topLiquidators: Array<{
      liquidator: string
      flashEvents: number
      totalEvents: number
      flashVolume: number
      flashProfit: number
      totalProfit: number
    }>
  }
  badDebt?: {
    monthly: Array<{
      month: string
      protocol: string
      events: number
      badDebt: number
      borrowers: number
    }>
    topEvents: Array<{
      txHash: string
      blockNumber: number
      blockTimestamp: number
      protocol: string
      collateralSymbol: string
      debtSymbol: string
      borrower: string
      liquidator: string
      badDebtUsd: number
      collateralAmountUsd: number
      debtAmountUsd: number
    }>
    byAsset: Array<{
      collateralSymbol: string
      events: number
      badDebt: number
      borrowers: number
      latestTimestamp: number | null
    }>
  }
  funding?: {
    breakdown: Array<{
      category: string
      events: number
      liquidators: number
      volume: number
      profit: number
      avgSize: number
      avgProfit: number
      avgGas: number
    }>
    monthly: Array<{
      month: string
      category: string
      events: number
    }>
  }
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

const FLASH_SOURCE_LABELS: Record<string, string> = {
  aave_v2: "Aave V2",
  aave_v3: "Aave V3",
  balancer: "Balancer",
  uniswap_v3: "Uniswap V3",
  maker: "Maker",
  maker_dai: "Maker DAI",
  dydx: "dYdX Solo",
  erc3156_other: "ERC-3156 Other",
}

const FLASH_SOURCE_COLORS: Record<string, string> = {
  aave_v2: "#B6509E",
  aave_v3: "#2EBAC6",
  balancer: "#1E1E1E",
  uniswap_v3: "#FF007A",
  maker: "#1AAB9B",
  maker_dai: "#1AAB9B",
  dydx: "#6966FF",
  erc3156_other: "#9CA3AF",
}

const FUNDING_CATEGORY_LABELS: Record<string, string> = {
  flash_loan: "Flash Loan",
  dex_swap: "DEX Swap",
  aggregator: "Aggregator",
  pre_funded: "Pre-funded (proven)",
  unknown: "Other / non-standard",
  unclassified: "Awaiting scan",
}

const FUNDING_CATEGORY_COLORS: Record<string, string> = {
  flash_loan: "#FF6B35",   // Datum orange (like flash loans in branding)
  dex_swap: "#5B7FFF",     // chart-1 blue
  aggregator: "#B44AFF",   // chart-4 purple
  pre_funded: "#10B981",   // success green (definitively proven)
  unknown: "#6B7280",      // neutral gray
  unclassified: "#374151", // dark gray
}

const FUNDING_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  flash_loan: "Debt asset borrowed from a lending pool (Aave V2/V3, Balancer, Maker DssFlash, dYdX Solo, or Uniswap V3) and repaid in the same transaction.",
  dex_swap: "Bot swapped a base asset (ETH, stables) to the debt asset via a DEX pool (Uniswap V2/V3, Curve, or Balancer V2) inside the liquidation tx.",
  aggregator: "Bot used a DEX aggregator (1inch, 0x, Cowswap, Paraswap) to source the debt asset.",
  pre_funded: "Liquidator's own address held ≥ the debt amount at block N-1 — proven self-funded via an on-chain balanceOf check.",
  unknown: "Confirmed not pre-funded at block N-1 (balance < debt), and no flash-loan or DEX-swap event we track. Likely funded by a flash loan provider we don't yet match (Euler, Radiant, Morpho, Compound V3), a block-internal transfer from a treasury contract, a CEX withdrawal in a prior block, or a DEX pool outside our topic list (Sushi, Kyber, smaller venues).",
  unclassified: "New events that the enrichment cron hasn't processed yet — classification will arrive on the next scheduled run.",
}

const BONUS_EFFICIENCY_PAGE_SIZE = 20

// Tab definitions — each tab groups a set of related sections. Order here is
// the display order in the tab bar.
const INSIGHT_TABS = [
  { id: "profit", label: "Profit & Economics", icon: "💸" },
  { id: "behavior", label: "Behavior & Markets", icon: "🏦" },
  { id: "funding", label: "Funding & Flash Loans", icon: "⚡" },
  { id: "badDebt", label: "Bad Debt", icon: "🩸" },
] as const

type InsightsTabId = (typeof INSIGHT_TABS)[number]["id"]

function isValidTab(v: string | null): v is InsightsTabId {
  return !!v && INSIGHT_TABS.some((t) => t.id === v)
}

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

  // Tab selection with URL sync (?tab=funding makes shareable)
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlTab = searchParams?.get("tab")
  const [tab, setTabState] = useState<InsightsTabId>(
    isValidTab(urlTab ?? null) ? (urlTab as InsightsTabId) : "profit"
  )
  const setTab = (next: InsightsTabId) => {
    setTabState(next)
    const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []))
    if (next === "profit") params.delete("tab")
    else params.set("tab", next)
    router.replace(params.toString() ? `/insights?${params.toString()}` : "/insights", {
      scroll: false,
    })
  }

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

  // Merge monthly profit data into chart-ready format (stacked by protocol)
  const monthlyProfitMap = new Map<string, any>()
  for (const m of data?.monthlyProfit || []) {
    if (!monthlyProfitMap.has(m.month)) {
      monthlyProfitMap.set(m.month, { month: m.month, aave_v3: 0, spark: 0, morpho_blue: 0, fluid: 0, total: 0 })
    }
    const entry = monthlyProfitMap.get(m.month)!
    entry[m.protocol] = m.grossProfit
    entry.total += m.grossProfit
  }
  const monthlyProfitChart = [...monthlyProfitMap.values()].sort((a, b) => a.month.localeCompare(b.month))

  // Profit concentration data for pie chart
  const concentrationPie = (data?.profitConcentration || []).map((t) => {
    const TIER_COLORS: Record<string, string> = {
      "Top 5": "#FF6B35",
      "Top 6-10": "#FF9F1C",
      "Top 11-20": "#FFD166",
      "Top 21-50": "#06D6A0",
      "Everyone Else": "#118AB2",
    }
    return { ...t, fill: TIER_COLORS[t.tier] || CHART_COLORS.accent }
  })
  const totalConcentrationProfit = concentrationPie.reduce((s, t) => s + t.tierProfit, 0)

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

      {/* Tab bar — groups sections into focused views */}
      <div
        className="flex items-center gap-1 border-b"
        style={{ borderColor: "var(--card-border)" }}
      >
        {INSIGHT_TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-3 py-2 text-[11px] uppercase tracking-[0.08em] transition-colors"
              style={{
                color: active ? "var(--accent-orange)" : "var(--text-muted)",
                borderBottom: active
                  ? "2px solid var(--accent-orange)"
                  : "2px solid transparent",
                marginBottom: "-1px",
                fontWeight: active ? 600 : 400,
              }}
            >
              <span className="mr-1.5">{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* === SECTION 1: Net Profit Analysis === */}
      {tab === "profit" && (
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
      )}

      {/* Profit Distribution Histogram + Cross-Protocol Activity side-by-side */}
      {tab === "profit" && (
      <div className="grid grid-cols-2 gap-4">
        <ChartWrapper title="Net Profit Distribution Per Liquidation" height={250}>
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
        </ChartWrapper>

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
      )}

      {/* === Liquidation Size Distribution + Monthly Profit === */}
      {tab === "profit" && (
      <div className="grid grid-cols-2 gap-4">
        {/* Chart 3: Liquidation Size Distribution */}
        <ChartWrapper title="Liquidation Size Distribution" subtitle="How big are typical liquidations?">
          <div className="h-[280px]">
            {(data?.sizeDistribution || []).length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data!.sizeDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: "var(--text-tertiary)" }} />
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
                    formatter={(v: number, name: string) => {
                      if (name === "count") return [formatNumber(v), "Liquidations"]
                      return [v, name]
                    }}
                  />
                  <Bar dataKey="count" name="count" fill={CHART_COLORS.accent} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
            )}
          </div>
        </ChartWrapper>

        {/* Chart 5: Monthly Profit */}
        <ChartWrapper title="Monthly Liquidator Profit" subtitle="When is the most money made?">
          <div className="h-[280px]">
            {monthlyProfitChart.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyProfitChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 9, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => v.slice(2)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`}
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
                      const labels: Record<string, string> = {
                        aave_v3: "Aave V3", spark: "SparkLend",
                        morpho_blue: "Morpho", fluid: "Fluid",
                      }
                      return [formatUSD(v), labels[name] || name]
                    }}
                  />
                  <Bar dataKey="aave_v3" name="aave_v3" stackId="a" fill={CHART_COLORS.aave_v3} />
                  <Bar dataKey="spark" name="spark" stackId="a" fill={CHART_COLORS.spark} />
                  <Bar dataKey="morpho_blue" name="morpho_blue" stackId="a" fill={CHART_COLORS.morpho_blue} />
                  <Bar dataKey="fluid" name="fluid" stackId="a" fill={CHART_COLORS.fluid} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
            )}
          </div>
        </ChartWrapper>
      </div>
      )}

      {/* === Cross-Protocol Bot Overlap Matrix === */}
      {tab === "behavior" && data?.overlapMatrix && data.overlapMatrix.length > 0 && data?.protocolStats && (
        <div>
          <h2 className="text-sm font-semibold text-accent mb-1">Cross-Protocol Bot Overlap</h2>
          <p className="text-[11px] text-text-tertiary mb-3">
            Do the same liquidator addresses operate across multiple protocols? This matrix reveals
            shared infrastructure — bots go where the profit is.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {/* Overlap Matrix Heatmap */}
            <div className="tui-card bg-card-bg border border-card-border rounded p-4">
              <h3 className="text-xs font-medium text-text-secondary mb-3">
                Shared Liquidators Between Protocols
              </h3>
              {(() => {
                const protocols = data.protocolStats.map((p) => p.protocol).sort()
                // Build lookup for pairwise data
                const pairKey = (a: string, b: string) =>
                  a < b ? `${a}|${b}` : `${b}|${a}`
                const pairMap = new Map<string, typeof data.overlapMatrix[0]>()
                for (const o of data.overlapMatrix) {
                  pairMap.set(pairKey(o.protocolA, o.protocolB), o)
                }
                const diagMap = new Map<string, typeof data.protocolStats[0]>()
                for (const p of data.protocolStats) {
                  diagMap.set(p.protocol, p)
                }
                // Find max shared for color scaling (exclude diagonal)
                const maxShared = Math.max(
                  ...data.overlapMatrix.map((o) => o.sharedLiquidators),
                  1
                )

                return (
                  <div>
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr>
                          <th className="pb-2 text-left font-medium text-text-tertiary w-[100px]"></th>
                          {protocols.map((p) => (
                            <th
                              key={p}
                              className="pb-2 text-center font-medium text-text-secondary px-2"
                            >
                              {protocolLabel(p)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {protocols.map((row) => (
                          <tr key={row}>
                            <td className="py-2 font-medium text-text-secondary pr-2">
                              {protocolLabel(row)}
                            </td>
                            {protocols.map((col) => {
                              const isDiag = row === col
                              const diag = diagMap.get(row)
                              const pair = !isDiag ? pairMap.get(pairKey(row, col)) : null

                              const count = isDiag
                                ? diag?.uniqueLiquidators || 0
                                : pair?.sharedLiquidators || 0
                              const intensity = isDiag
                                ? 1
                                : count / maxShared

                              return (
                                <td
                                  key={col}
                                  className="py-2 text-center px-2 relative group"
                                  style={{ cursor: "default" }}
                                >
                                  <div
                                    className="rounded px-2 py-2 transition-all"
                                    style={{
                                      background: isDiag
                                        ? "var(--accent-orange)"
                                        : `rgba(255, 107, 53, ${Math.max(0.06, intensity * 0.55)})`,
                                      color: isDiag
                                        ? "#fff"
                                        : intensity > 0.4
                                        ? "var(--text-primary)"
                                        : "var(--text-secondary)",
                                      fontWeight: isDiag ? 700 : count > 0 ? 600 : 400,
                                      fontSize: isDiag ? 13 : 12,
                                    }}
                                  >
                                    {count}
                                  </div>
                                  {/* Hover tooltip */}
                                  <div
                                    className="absolute z-50 hidden group-hover:block top-full left-1/2 -translate-x-1/2 mt-2 min-w-[180px]"
                                    style={{
                                      background: "var(--tooltip-bg)",
                                      border: "1px solid var(--card-border)",
                                      borderRadius: 6,
                                      padding: "8px 12px",
                                      fontSize: 10,
                                      color: "var(--text-primary)",
                                      fontFamily: "JetBrains Mono, monospace",
                                      pointerEvents: "none",
                                      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                                    }}
                                  >
                                    {isDiag ? (
                                      <>
                                        <div className="font-semibold mb-1" style={{ color: "var(--accent-orange)" }}>
                                          {protocolLabel(row)}
                                        </div>
                                        <div className="flex justify-between mb-0.5">
                                          <span className="text-text-tertiary">Liquidators</span>
                                          <span>{diag?.uniqueLiquidators || 0}</span>
                                        </div>
                                        <div className="flex justify-between mb-0.5">
                                          <span className="text-text-tertiary">Volume</span>
                                          <span>{formatUSD(diag?.totalVolume || 0)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-text-tertiary">Profit</span>
                                          <span className="text-positive">{formatUSD(diag?.totalProfit || 0)}</span>
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div className="font-semibold mb-1" style={{ color: "var(--accent-orange)" }}>
                                          {protocolLabel(row)} + {protocolLabel(col)}
                                        </div>
                                        <div className="flex justify-between mb-0.5">
                                          <span className="text-text-tertiary">Shared Bots</span>
                                          <span>{pair?.sharedLiquidators || 0}</span>
                                        </div>
                                        <div className="flex justify-between mb-0.5">
                                          <span className="text-text-tertiary">Combined Vol</span>
                                          <span>{formatUSD(pair?.sharedVolume || 0)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-text-tertiary">Combined Profit</span>
                                          <span className="text-positive">{formatUSD(pair?.sharedProfit || 0)}</span>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[9px] text-text-tertiary mt-3">
                      Diagonal (orange) = total unique liquidators per protocol.
                      Off-diagonal = bots active on <strong>both</strong> protocols. Hover for details.
                    </p>
                  </div>
                )
              })()}
            </div>

            {/* Overlap Insights */}
            <div className="tui-card bg-card-bg border border-card-border rounded p-4">
              <h3 className="text-xs font-medium text-text-secondary mb-3">
                Protocol Overlap Rankings
              </h3>
              <div className="space-y-3">
                {data.overlapMatrix
                  .sort((a, b) => b.sharedLiquidators - a.sharedLiquidators)
                  .map((o, i) => {
                    const maxShared = data.overlapMatrix[0]?.sharedLiquidators || 1
                    const pct = (o.sharedLiquidators / maxShared) * 100
                    // Calculate what % of each protocol's liquidators are shared
                    const statsA = data.protocolStats.find((p) => p.protocol === o.protocolA)
                    const statsB = data.protocolStats.find((p) => p.protocol === o.protocolB)
                    const pctOfA = statsA ? ((o.sharedLiquidators / statsA.uniqueLiquidators) * 100).toFixed(0) : "?"
                    const pctOfB = statsB ? ((o.sharedLiquidators / statsB.uniqueLiquidators) * 100).toFixed(0) : "?"

                    return (
                      <div key={`${o.protocolA}-${o.protocolB}`}>
                        <div className="flex items-baseline justify-between text-[11px] mb-0.5">
                          <span className="font-medium text-text-primary">
                            <span className="text-text-tertiary mr-1.5">#{i + 1}</span>
                            {protocolLabel(o.protocolA)} + {protocolLabel(o.protocolB)}
                          </span>
                          <span className="text-accent font-mono font-semibold">
                            {o.sharedLiquidators} shared
                          </span>
                        </div>
                        <div className="h-2 bg-card-border/30 rounded overflow-hidden">
                          <div
                            className="h-full rounded transition-all"
                            style={{
                              width: `${pct}%`,
                              background: "var(--accent-orange)",
                              opacity: 0.7,
                            }}
                          />
                        </div>
                        <div className="flex items-center gap-3 text-[9px] text-text-tertiary mt-0.5">
                          <span>{pctOfA}% of {protocolLabel(o.protocolA)}</span>
                          <span>{pctOfB}% of {protocolLabel(o.protocolB)}</span>
                          <span className="text-positive">{formatUSD(o.sharedProfit)} profit</span>
                        </div>
                      </div>
                    )
                  })}
                {data.overlapMatrix.length === 0 && (
                  <div className="text-text-tertiary text-xs text-center py-8">
                    Select the &ldquo;All&rdquo; protocol filter to see overlap data
                  </div>
                )}
              </div>
              <p className="text-[10px] text-text-tertiary mt-4 leading-relaxed border-t border-card-border pt-3">
                Multi-protocol operators run the same liquidation infrastructure across
                different lending markets. The liquidation economy has no protocol loyalty
                — bots go where the profit is.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* === SECTION 2: Collateral-Debt Pair Treemap === */}
      {tab === "behavior" && (
      <div>
        <h2 className="text-sm font-semibold text-accent mb-3">Top Collateral–Debt Pairs by Liquidation Volume</h2>
        <div className="grid grid-cols-3 gap-4">
          {/* Treemap */}
          <ChartWrapper title="Volume Treemap — larger area = more liquidation volume" className="col-span-2" height={380}>
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
          </ChartWrapper>

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
      )}

      {/* === SECTION 3: Cascades === */}
      {tab === "behavior" && (
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
      )}

      {/* === SECTION 3: Repeat Offenders === */}
      {tab === "behavior" && (
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
      )}

      {/* === SECTION 4: Market Concentration === */}
      {tab === "behavior" && (
      <div>
        <h2 className="text-sm font-semibold text-accent mb-3">Market Concentration</h2>
        <div className="grid grid-cols-2 gap-4">
          <ChartWrapper title="Top 5 Liquidators Profit Share Over Time" height={240}>
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
          </ChartWrapper>

          <ChartWrapper title="Active Liquidators Per Month" height={240}>
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
          </ChartWrapper>
        </div>
      </div>
      )}

      {/* === Gas Strategy + Profit Concentration === */}
      {tab === "profit" && (
      <div className="grid grid-cols-2 gap-4">
        {/* Chart 10: Gas Prices by Liquidator */}
        <ChartWrapper title="Gas Strategy by Top Liquidators" subtitle="How do bots compete on execution?">
          <div className="h-[320px]">
            {(data?.gasByLiquidator || []).length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(data?.gasByLiquidator || []).slice(0, 15).map((g) => ({
                    ...g,
                    label: `${g.liquidator.slice(0, 6)}...${g.liquidator.slice(-4)}`,
                    marginPct: g.totalGrossProfit > 0
                      ? ((g.totalGrossProfit - g.totalGasUsd) / g.totalGrossProfit * 100)
                      : 0,
                  }))}
                  layout="vertical"
                  margin={{ left: 10, right: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 9, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => `${v.toFixed(0)} gwei`}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fontSize: 9, fill: "var(--text-tertiary)" }}
                    width={85}
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
                    formatter={(v: number, name: string, props: any) => {
                      const d = props.payload
                      if (name === "avgGasGwei") return [`${v.toFixed(1)} gwei`, "Avg Gas Price"]
                      return [v, name]
                    }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null
                      const d = payload[0].payload
                      return (
                        <div
                          className="rounded p-2.5 text-[10px] space-y-1"
                          style={{
                            background: "var(--tooltip-bg)",
                            border: "1px solid var(--card-border)",
                            color: "var(--text-primary)",
                            minWidth: 180,
                          }}
                        >
                          <div className="font-semibold text-[11px]" style={{ color: "var(--accent)" }}>
                            {d.label}
                          </div>
                          <div className="flex justify-between">
                            <span className="text-text-tertiary">Avg Gas Price</span>
                            <span>{d.avgGasGwei.toFixed(1)} gwei</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-text-tertiary">Avg Gas Cost</span>
                            <span>{formatUSD(d.avgGasUsd)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-text-tertiary">Total Gas Spent</span>
                            <span className="text-negative">{formatUSD(d.totalGasUsd)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-text-tertiary">Gross Profit</span>
                            <span className="text-positive">{formatUSD(d.totalGrossProfit)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-text-tertiary">Profit Margin</span>
                            <span className={d.marginPct >= 0 ? "text-positive" : "text-negative"}>
                              {d.marginPct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-text-tertiary">Events (w/ gas)</span>
                            <span>{d.eventsWithGas}</span>
                          </div>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="avgGasGwei" name="avgGasGwei" fill={CHART_COLORS.accent} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">
                Run gas backfill to see this chart
              </div>
            )}
          </div>
        </ChartWrapper>

        {/* Chart 8: Profit Concentration Snapshot */}
        <ChartWrapper title="Profit Concentration Snapshot" subtitle="How concentrated is the market?">
          <div className="h-[320px]">
            {concentrationPie.length > 0 ? (
              <div className="flex h-full">
                <div className="flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={concentrationPie}
                        cx="50%"
                        cy="45%"
                        innerRadius={55}
                        outerRadius={95}
                        dataKey="tierProfit"
                        nameKey="tier"
                        stroke="var(--card-bg)"
                        strokeWidth={2}
                      >
                        {concentrationPie.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "var(--tooltip-bg)",
                          border: "1px solid var(--card-border)",
                          borderRadius: 4,
                          fontSize: 11,
                          color: "var(--text-primary)",
                        }}
                        itemStyle={{ color: "var(--text-primary)" }}
                        formatter={(v: number, name: string) => [formatUSD(v), name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-[180px] flex flex-col justify-center gap-2.5 pl-2">
                  {concentrationPie.map((t) => {
                    const pct = totalConcentrationProfit > 0
                      ? (t.tierProfit / totalConcentrationProfit * 100)
                      : 0
                    return (
                      <div key={t.tier}>
                        <div className="flex items-center gap-2 text-[11px] mb-0.5">
                          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: t.fill }} />
                          <span className="font-medium text-text-primary">{t.tier}</span>
                        </div>
                        <div className="ml-4.5 text-[10px] text-text-tertiary space-y-0.5" style={{ marginLeft: 18 }}>
                          <div>{pct.toFixed(1)}% of profit ({formatUSD(t.tierProfit)})</div>
                          <div>{t.liquidatorCount} liquidators · {formatNumber(t.tierEvents)} events</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
            )}
          </div>
        </ChartWrapper>
      </div>
      )}

      {/* === SECTION 5: Bonus Efficiency === */}
      {tab === "profit" && (
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
      )}

      {/* ============================================================ */}
      {/* FLASH LOAN ANALYSIS SECTION                                  */}
      {/* ============================================================ */}
      {tab === "funding" && data?.flashLoans && data.flashLoans.stats.flashEvents > 0 && (
        <>
          <div className="border-t border-card-border pt-4 mt-2">
            <h2 className="text-sm font-semibold text-text-primary">⚡ Flash Loan Analysis</h2>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              Transactions using flash loans from Aave, Balancer, Uniswap V3, or Maker to fund liquidations
            </p>
          </div>

          {/* Flash Loan KPIs */}
          <div className="grid grid-cols-4 gap-4">
            <MetricCard
              label="Flash Loan Events"
              value={formatNumber(data.flashLoans.stats.flashEvents)}
              sub={`${((data.flashLoans.stats.flashEvents / data.flashLoans.stats.totalEvents) * 100).toFixed(1)}% of all events`}
              accent
            />
            <MetricCard
              label="Flash Loan Volume"
              value={formatUSD(data.flashLoans.stats.flashVolume)}
              sub={`${((data.flashLoans.stats.flashVolume / (data.flashLoans.stats.flashVolume + data.flashLoans.stats.nonFlashVolume)) * 100).toFixed(1)}% of total volume`}
            />
            <MetricCard
              label="Flash Loan Profit"
              value={formatUSD(data.flashLoans.stats.flashProfit)}
              sub={`Avg ${formatUSD(data.flashLoans.stats.avgFlashProfit)} per event`}
            />
            <MetricCard
              label="Flash Liquidators"
              value={formatNumber(data.flashLoans.stats.flashLiquidators)}
              sub={`of ${data.flashLoans.stats.flashLiquidators + data.flashLoans.stats.nonFlashLiquidators} total`}
            />
          </div>

          {/* Flash Loan Charts Row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Flash vs Non-Flash Monthly */}
            <ChartWrapper title="Flash Loan Adoption Over Time" height={260}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.flashLoans.monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 9, fill: "var(--text-tertiary)" }}
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
                    formatter={(v: number, name: string) => {
                      if (name === "flashCount") return [formatNumber(v), "Flash Loan"]
                      return [formatNumber(v), "Non-Flash"]
                    }}
                  />
                  <Bar dataKey="nonFlashCount" name="nonFlashCount" stackId="a" fill="var(--text-tertiary)" opacity={0.4} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="flashCount" name="flashCount" stackId="a" fill="#FBBF24" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartWrapper>

            {/* Flash Loan Source Pie */}
            <ChartWrapper title="Flash Loan Providers" height={260}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.flashLoans.bySource.map((s) => ({
                      name: FLASH_SOURCE_LABELS[s.source] || s.source,
                      value: s.eventCount,
                      source: s.source,
                    }))}
                    cx="50%"
                    cy="45%"
                    innerRadius={55}
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {data.flashLoans.bySource.map((s) => (
                      <Cell
                        key={s.source}
                        fill={FLASH_SOURCE_COLORS[s.source] || CHART_COLORS.accent}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--tooltip-bg)",
                      border: "1px solid var(--card-border)",
                      borderRadius: 4,
                      fontSize: 11,
                      color: "var(--text-primary)",
                    }}
                    formatter={(v: number) => [formatNumber(v), "Events"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartWrapper>
          </div>

          {/* Flash vs Non-Flash Comparison Table */}
          <div className="tui-card bg-card-bg border border-card-border rounded p-4">
            <h3 className="text-xs font-medium text-text-secondary mb-3">
              Flash Loan vs Non-Flash Loan Comparison
            </h3>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-text-tertiary border-b border-card-border">
                  <th className="text-left pb-2 font-medium">Metric</th>
                  <th className="text-right pb-2 font-medium">⚡ Flash Loan</th>
                  <th className="text-right pb-2 font-medium">Standard</th>
                  <th className="text-right pb-2 font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-card-border/50">
                  <td className="py-2 text-text-secondary">Avg Liquidation Size</td>
                  <td className="py-2 text-right font-medium text-accent">{formatUSD(data.flashLoans.stats.avgFlashSize)}</td>
                  <td className="py-2 text-right text-text-secondary">{formatUSD(data.flashLoans.stats.avgNonFlashSize)}</td>
                  <td className="py-2 text-right text-positive">
                    {data.flashLoans.stats.avgNonFlashSize > 0
                      ? `${((data.flashLoans.stats.avgFlashSize / data.flashLoans.stats.avgNonFlashSize - 1) * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                </tr>
                <tr className="border-b border-card-border/50">
                  <td className="py-2 text-text-secondary">Avg Profit Per Event</td>
                  <td className="py-2 text-right font-medium text-accent">{formatUSD(data.flashLoans.stats.avgFlashProfit)}</td>
                  <td className="py-2 text-right text-text-secondary">{formatUSD(data.flashLoans.stats.avgNonFlashProfit)}</td>
                  <td className="py-2 text-right text-positive">
                    {data.flashLoans.stats.avgNonFlashProfit > 0
                      ? `${((data.flashLoans.stats.avgFlashProfit / data.flashLoans.stats.avgNonFlashProfit - 1) * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                </tr>
                <tr className="border-b border-card-border/50">
                  <td className="py-2 text-text-secondary">Avg Gas Cost</td>
                  <td className="py-2 text-right font-medium text-accent">{formatUSD(data.flashLoans.stats.avgFlashGas)}</td>
                  <td className="py-2 text-right text-text-secondary">{formatUSD(data.flashLoans.stats.avgNonFlashGas)}</td>
                  <td className="py-2 text-right text-negative">
                    {data.flashLoans.stats.avgNonFlashGas > 0
                      ? `+${((data.flashLoans.stats.avgFlashGas / data.flashLoans.stats.avgNonFlashGas - 1) * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-text-secondary">Total Volume</td>
                  <td className="py-2 text-right font-medium text-accent">{formatUSD(data.flashLoans.stats.flashVolume)}</td>
                  <td className="py-2 text-right text-text-secondary">{formatUSD(data.flashLoans.stats.nonFlashVolume)}</td>
                  <td className="py-2 text-right text-text-tertiary">
                    {((data.flashLoans.stats.flashVolume / (data.flashLoans.stats.flashVolume + data.flashLoans.stats.nonFlashVolume)) * 100).toFixed(1)}% flash
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Top Flash Loan Liquidators */}
          {data.flashLoans.topLiquidators.length > 0 && (
            <div className="tui-card bg-card-bg border border-card-border rounded p-4">
              <h3 className="text-xs font-medium text-text-secondary mb-3">
                Top Flash Loan Liquidators
              </h3>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-text-tertiary border-b border-card-border">
                    <th className="text-left pb-2 font-medium">#</th>
                    <th className="text-left pb-2 font-medium">Address</th>
                    <th className="text-right pb-2 font-medium">Flash Events</th>
                    <th className="text-right pb-2 font-medium">Total Events</th>
                    <th className="text-right pb-2 font-medium">Flash %</th>
                    <th className="text-right pb-2 font-medium">Flash Volume</th>
                    <th className="text-right pb-2 font-medium">Flash Profit</th>
                    <th className="text-right pb-2 font-medium">Total Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.flashLoans.topLiquidators.map((l, i) => (
                    <tr key={l.liquidator} className="border-b border-card-border/50 hover:bg-card-hover transition-colors">
                      <td className="py-2 text-text-tertiary">{i + 1}</td>
                      <td className="py-2">
                        <Link
                          href={`/liquidators/${l.liquidator}`}
                          className="text-accent hover:underline font-mono text-[10px]"
                        >
                          {formatAddress(l.liquidator)}
                        </Link>
                      </td>
                      <td className="py-2 text-right text-accent font-medium">{formatNumber(l.flashEvents)}</td>
                      <td className="py-2 text-right text-text-secondary">{formatNumber(l.totalEvents)}</td>
                      <td className="py-2 text-right text-text-secondary">
                        {((l.flashEvents / l.totalEvents) * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 text-right text-text-secondary">{formatUSD(l.flashVolume)}</td>
                      <td className="py-2 text-right text-positive font-medium">{formatUSD(l.flashProfit)}</td>
                      <td className="py-2 text-right text-text-secondary">{formatUSD(l.totalProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Flash Loan Source Details */}
          {data.flashLoans.bySource.length > 0 && (
            <div className="tui-card bg-card-bg border border-card-border rounded p-4">
              <h3 className="text-xs font-medium text-text-secondary mb-3">
                Flash Loan Provider Breakdown
              </h3>
              <div className="grid grid-cols-5 gap-3">
                {data.flashLoans.bySource.map((s) => (
                  <div
                    key={s.source}
                    className="text-center p-3 rounded"
                    style={{ background: `${FLASH_SOURCE_COLORS[s.source] || CHART_COLORS.accent}15` }}
                  >
                    <div
                      className="text-[13px] font-semibold"
                      style={{ color: FLASH_SOURCE_COLORS[s.source] || CHART_COLORS.accent }}
                    >
                      {FLASH_SOURCE_LABELS[s.source] || s.source}
                    </div>
                    <div className="text-[10px] text-text-tertiary mt-1">{formatNumber(s.eventCount)} events</div>
                    <div className="text-[10px] text-text-secondary">{formatUSD(s.volume)} vol</div>
                    <div className="text-[10px] text-positive">{formatUSD(s.profit)} profit</div>
                    <div className="text-[9px] text-text-tertiary">{s.uniqueLiquidators} liquidators</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ──────────────────────────────────────────────────────────
          Bad Debt Formation
          ────────────────────────────────────────────────────────── */}
      {tab === "badDebt" && data?.badDebt && data.badDebt.monthly.length > 0 && (() => {
            // Pivot monthly data into one row per month with a column per protocol.
            // Protocol colors come from CHART_COLORS so the chart reads the same
            // as the other protocol-stacked views.
            const protocols = Array.from(new Set(data.badDebt.monthly.map((r) => r.protocol)))
            const monthMap: Record<string, Record<string, number>> = {}
            for (const r of data.badDebt.monthly) {
              if (!monthMap[r.month]) monthMap[r.month] = { month: r.month as any }
              monthMap[r.month][r.protocol] = r.badDebt
            }
            const chartData = Object.keys(monthMap)
              .sort()
              .map((m) => ({ month: m, ...monthMap[m] }))

            const totalBadDebt = data.badDebt.monthly.reduce((s, r) => s + r.badDebt, 0)
            const totalEvents = data.badDebt.monthly.reduce((s, r) => s + r.events, 0)
            const totalBorrowers = new Set(
              data.badDebt.monthly.flatMap((r) => Array(r.borrowers).fill(0).map((_, i) => `${r.protocol}_${r.month}_${i}`))
            ).size // rough — we don't have distinct borrowers across months

            const worstMonth = Object.entries(monthMap)
              .map(([m, row]) => ({ m, total: Object.entries(row).filter(([k]) => k !== "month").reduce((s, [, v]) => s + (v as number), 0) }))
              .sort((a, b) => b.total - a.total)[0]

            return (
              <div className="mt-8 space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold text-text-primary">
                    🩸 Bad Debt Formation
                  </h2>
                  <span className="text-[10px] text-text-tertiary">
                    When collateral seized {"<"} debt repaid · protocols absorb the loss
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <MetricCard
                    label="Total Bad Debt"
                    value={formatUSD(totalBadDebt)}
                    sub="All time, all protocols"
                    accent
                  />
                  <MetricCard
                    label="Loss-bearing Events"
                    value={formatNumber(totalEvents)}
                    sub={`${((totalEvents / (data.netProfit.totalEvents || 1)) * 100).toFixed(2)}% of all liquidations`}
                  />
                  <MetricCard
                    label="Worst Month"
                    value={worstMonth ? formatUSD(worstMonth.total) : "—"}
                    sub={worstMonth?.m || ""}
                  />
                  <MetricCard
                    label="Protocols Affected"
                    value={String(protocols.length)}
                    sub="Distinct chains of pain"
                  />
                </div>

                {/* Monthly stacked bar chart */}
                <ChartWrapper title="Bad Debt by Protocol per Month" height={320}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 24, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                        interval="preserveStartEnd"
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                        tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`}
                        width={65}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--tooltip-bg)",
                          border: "1px solid var(--card-border)",
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                        formatter={(v: any, n: any) => [formatUSD(Number(v)), protocolLabel(String(n))]}
                      />
                      {protocols.map((p) => (
                        <Bar
                          key={p}
                          dataKey={p}
                          stackId="a"
                          fill={(CHART_COLORS as any)[p] || CHART_COLORS.negative}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </ChartWrapper>

                {/* Bad debt by collateral asset + top events in a 2-col layout */}
                <div className="grid grid-cols-2 gap-4">
                  {/* By collateral asset */}
                  <div className="tui-card bg-card-bg border border-card-border rounded overflow-hidden">
                    <div className="px-3 py-2 border-b border-card-border">
                      <h3 className="text-xs font-medium text-text-secondary">
                        Bad Debt by Collateral Asset
                      </h3>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-text-tertiary border-b border-card-border">
                          <th className="text-left px-3 py-2 font-medium">Asset</th>
                          <th className="text-right px-3 py-2 font-medium">Bad Debt</th>
                          <th className="text-right px-3 py-2 font-medium">Events</th>
                          <th className="text-right px-3 py-2 font-medium">Borrowers</th>
                          <th className="text-right px-3 py-2 font-medium">Last</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.badDebt.byAsset.map((a) => (
                          <tr
                            key={a.collateralSymbol}
                            className="border-b border-card-border/50 hover:bg-card-hover"
                          >
                            <td className="px-3 py-2 font-medium text-text-primary">
                              {a.collateralSymbol}
                            </td>
                            <td className="px-3 py-2 text-right font-medium" style={{ color: "#FF4444" }}>
                              {formatUSD(a.badDebt)}
                            </td>
                            <td className="px-3 py-2 text-right text-text-secondary">
                              {formatNumber(a.events)}
                            </td>
                            <td className="px-3 py-2 text-right text-text-secondary">
                              {formatNumber(a.borrowers)}
                            </td>
                            <td className="px-3 py-2 text-right text-text-tertiary">
                              {a.latestTimestamp ? formatDate(a.latestTimestamp) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Top bad debt events */}
                  <div className="tui-card bg-card-bg border border-card-border rounded overflow-hidden">
                    <div className="px-3 py-2 border-b border-card-border">
                      <h3 className="text-xs font-medium text-text-secondary">
                        Hall of Pain — Largest Single Bad-Debt Events
                      </h3>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-text-tertiary border-b border-card-border">
                          <th className="text-left px-3 py-2 font-medium">Date</th>
                          <th className="text-left px-3 py-2 font-medium">Pair</th>
                          <th className="text-left px-3 py-2 font-medium">Protocol</th>
                          <th className="text-right px-3 py-2 font-medium">Bad Debt</th>
                          <th className="text-center px-3 py-2 font-medium">Tx</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.badDebt.topEvents.slice(0, 10).map((e) => (
                          <tr
                            key={e.txHash}
                            className="border-b border-card-border/50 hover:bg-card-hover"
                          >
                            <td className="px-3 py-2 text-text-secondary">
                              {formatDate(e.blockTimestamp)}
                            </td>
                            <td className="px-3 py-2 text-text-primary">
                              <span className="font-medium">{e.collateralSymbol}</span>
                              <span className="text-text-tertiary mx-1">/</span>
                              <span>{e.debtSymbol}</span>
                            </td>
                            <td className="px-3 py-2 text-text-tertiary">
                              {protocolLabel(e.protocol)}
                            </td>
                            <td className="px-3 py-2 text-right font-medium" style={{ color: "#FF4444" }}>
                              {formatUSD(e.badDebtUsd)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <a
                                href={etherscanTx(e.txHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent hover:underline"
                                title={e.txHash}
                              >
                                ↗
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* ──────────────────────────────────────────────────────────
              Funding Source Classification
              ────────────────────────────────────────────────────────── */}
          {tab === "funding" && data?.funding && data.funding.breakdown.length > 0 && (() => {
            const breakdown = data.funding.breakdown
            const total = breakdown.reduce((s, r) => s + r.events, 0)
            const chartData = breakdown.map((r) => ({
              name: FUNDING_CATEGORY_LABELS[r.category] || r.category,
              value: r.events,
              category: r.category,
              pct: total > 0 ? (r.events / total) * 100 : 0,
            }))
            return (
              <div className="mt-8 space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold text-text-primary">
                    💰 Liquidator Funding Sources
                  </h2>
                  <span className="text-[10px] text-text-tertiary">
                    How bots source the debt asset to repay · {formatNumber(total)} events classified
                  </span>
                </div>

                {/* Methodology note — what each bucket actually means */}
                <div
                  className="tui-card rounded p-3 text-[10px] leading-relaxed"
                  style={{
                    background: "rgba(91, 127, 255, 0.05)",
                    border: "1px solid rgba(91, 127, 255, 0.2)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <span className="font-semibold text-text-primary">Methodology: </span>
                  each event is checked in order against a deterministic pipeline — (1) known
                  flash-loan event topics from 5 providers, (2) DEX swap topics from Uniswap
                  V2/V3, Curve, Balancer V2, (3) aggregator router addresses, (4) an on-chain{" "}
                  <code className="text-accent">balanceOf</code> check at block N-1 against the
                  liquidator's own address. Events that match none of the above fall into{" "}
                  <span style={{ color: FUNDING_CATEGORY_COLORS.unknown }}>
                    "Other / non-standard"
                  </span>
                  . Those are <em>confirmed not pre-funded</em> (balance {"<"} debt) but get
                  their debt asset from a path we don't yet classify: smaller flash-loan
                  providers (Euler, Morpho, Radiant), treasury contracts, CEX withdrawals in
                  prior blocks, or less-common DEX pools.
                </div>

                {/* Pie chart + per-category cards */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-5">
                    <ChartWrapper title="Share of Liquidations" height={320}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={110}
                            dataKey="value"
                            labelLine={false}
                            label={(e: any) =>
                              e.pct >= 5 ? `${e.name} ${e.pct.toFixed(0)}%` : ""
                            }
                          >
                            {chartData.map((e) => (
                              <Cell
                                key={e.category}
                                fill={FUNDING_CATEGORY_COLORS[e.category] || CHART_COLORS.accent}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              background: "var(--tooltip-bg)",
                              border: "1px solid var(--card-border)",
                              borderRadius: 4,
                              fontSize: 11,
                            }}
                            formatter={(v: any, _n: any, p: any) =>
                              [`${formatNumber(Number(v))} events (${p.payload.pct.toFixed(1)}%)`, p.payload.name]
                            }
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </ChartWrapper>
                  </div>

                  {/* Per-category KPI cards */}
                  <div className="col-span-7 grid grid-cols-2 gap-3">
                    {breakdown.map((r) => {
                      const color = FUNDING_CATEGORY_COLORS[r.category] || CHART_COLORS.accent
                      const pct = total > 0 ? (r.events / total) * 100 : 0
                      return (
                        <div
                          key={r.category}
                          className="tui-card rounded p-3 border"
                          style={{
                            background: `${color}10`,
                            borderColor: `${color}40`,
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className="text-[11px] font-semibold uppercase tracking-wider"
                              style={{ color }}
                            >
                              {FUNDING_CATEGORY_LABELS[r.category] || r.category}
                            </span>
                            <span className="text-[10px] text-text-tertiary">
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="mt-1 text-lg font-semibold text-text-primary">
                            {formatNumber(r.events)}
                            <span className="text-[10px] text-text-tertiary ml-1 font-normal">events</span>
                          </div>
                          <div className="mt-1 grid grid-cols-3 gap-1 text-[10px]">
                            <div>
                              <div className="text-text-tertiary">Volume</div>
                              <div className="text-text-secondary">{formatUSD(r.volume)}</div>
                            </div>
                            <div>
                              <div className="text-text-tertiary">Profit</div>
                              <div className="text-positive">{formatUSD(r.profit)}</div>
                            </div>
                            <div>
                              <div className="text-text-tertiary">Bots</div>
                              <div className="text-text-secondary">{formatNumber(r.liquidators)}</div>
                            </div>
                          </div>
                          <div className="mt-2 text-[9px] text-text-tertiary leading-snug">
                            {FUNDING_CATEGORY_DESCRIPTIONS[r.category]}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Average size / profit / gas comparison table */}
                <div className="tui-card bg-card-bg border border-card-border rounded overflow-hidden">
                  <div className="px-3 py-2 border-b border-card-border">
                    <h3 className="text-xs font-medium text-text-secondary">
                      Per-event Economics by Funding Type
                    </h3>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-text-tertiary border-b border-card-border">
                        <th className="text-left px-3 py-2 font-medium">Funding type</th>
                        <th className="text-right px-3 py-2 font-medium">Events</th>
                        <th className="text-right px-3 py-2 font-medium">Avg size</th>
                        <th className="text-right px-3 py-2 font-medium">Avg profit</th>
                        <th className="text-right px-3 py-2 font-medium">Avg gas</th>
                        <th className="text-right px-3 py-2 font-medium">Net / event</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.map((r) => {
                        const color = FUNDING_CATEGORY_COLORS[r.category] || CHART_COLORS.accent
                        const net = r.avgProfit - r.avgGas
                        return (
                          <tr
                            key={r.category}
                            className="border-b border-card-border/50 hover:bg-card-hover"
                          >
                            <td className="px-3 py-2.5">
                              <span
                                className="inline-flex items-center gap-1.5"
                                style={{ color }}
                              >
                                <span
                                  className="inline-block w-2 h-2 rounded-full"
                                  style={{ background: color }}
                                />
                                {FUNDING_CATEGORY_LABELS[r.category] || r.category}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right text-text-secondary">
                              {formatNumber(r.events)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-text-secondary">
                              {formatUSD(r.avgSize)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-positive">
                              {formatUSD(r.avgProfit)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-text-secondary">
                              {r.avgGas > 0 ? formatUSD(r.avgGas) : "—"}
                            </td>
                            <td
                              className="px-3 py-2.5 text-right font-medium"
                              style={{ color: net >= 0 ? "var(--positive)" : "#FF4444" }}
                            >
                              {r.avgGas > 0 ? formatUSD(net) : "—"}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
    </main>
  )
}
