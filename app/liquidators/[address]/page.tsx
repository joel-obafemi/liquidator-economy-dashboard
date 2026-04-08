"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { useCachedFetch } from "@/lib/use-cached-fetch"
import {
  formatUSD, formatNumber, formatDate, formatDateTime,
  etherscanAddress, etherscanTx, protocolLabel, CHART_COLORS,
} from "@/lib/utils"
import { MetricCard } from "@/components/metric-card"
import { SkeletonBar, SkeletonKpiRow, SkeletonChart, SkeletonDonut } from "@/components/skeleton"
import Link from "next/link"
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts"

interface ProfileData {
  address: string
  summary: {
    totalCount: number
    totalDebtRepaid: number
    totalVolume: number
    totalProfit: number
    totalGasUsd: number
    totalGasEth: number
    totalNetProfit: number
    avgProfit: number
    avgGasUsd: number
    eventsWithGas: number
    profitableCount: number
    unprofitableCount: number
    firstActive: number
    lastActive: number
    uniqueBorrowers: number
    protocols: string[]
  }
  byProtocol: Array<{
    protocol: string
    count: number
    volume: number
    grossProfit: number
    netProfit: number
    gasUsd: number
  }>
  daily: Array<{ day: string; count: number; profit: number; gasUsd: number; netProfit: number }>
  monthly: Array<{
    month: string
    protocol: string
    count: number
    profit: number
    netProfit: number
    volume: number
    gasUsd: number
  }>
  collateralBreakdown: Array<{ symbol: string; count: number; volume: number; profit: number }>
  debtBreakdown: Array<{ symbol: string; count: number; volume: number }>
  recentEvents: Array<{
    txHash: string
    protocol: string
    borrower: string
    collateralSymbol: string
    debtSymbol: string
    collateralAmountUsd: number
    debtAmountUsd: number
    grossProfitUsd: number
    gasCostUsd: number
    netProfitUsd: number
    gasPriceGwei: number
    gasUsed: number
    blockTimestamp: number
    blockNumber: number
  }>
  fundingSource: {
    fromAddress: string
    txHash: string
    blockNumber: number
    timestamp: number
    valueEth: number
    fromLabel?: string
    kind: "deployer" | "funding"
  } | null
}

const PIE_COLORS = ["#00d4ff", "#B6509E", "#F79A2A", "#22c55e", "#ef4444", "#6366f1", "#f59e0b", "#8b5cf6", "#14b8a6", "#f43f5e", "#a855f7", "#06b6d4"]

const EVENTS_PER_PAGE = 20

export default function LiquidatorProfilePage() {
  const params = useParams()
  const address = (params.address as string)?.toLowerCase()
  const [eventsPage, setEventsPage] = useState(1)

  const { data, loading, error } = useCachedFetch<ProfileData>(
    `/api/liquidators/${address}`,
    { enabled: !!address }
  )

  if (loading && !data) {
    return (
      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        {/* Header skeleton */}
        <div className="animate-pulse space-y-2">
          <SkeletonBar width={80} height={10} />
          <SkeletonBar width={200} height={18} />
          <SkeletonBar width={280} height={10} />
        </div>

        {/* 5 KPI cards */}
        <SkeletonKpiRow count={5} />

        {/* Funding source card */}
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse space-y-2">
          <SkeletonBar width={160} height={10} />
          <SkeletonBar width="80%" height={10} />
          <SkeletonBar width="60%" height={9} />
        </div>

        {/* Cross-protocol table */}
        <div>
          <SkeletonBar width={180} height={12} className="mb-3 animate-pulse" />
          <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-2 border-b border-card-border/40 last:border-0">
                <SkeletonBar width={80} height={10} />
                <div className="flex-1" />
                <SkeletonBar width={60} height={10} />
                <SkeletonBar width={70} height={10} />
                <SkeletonBar width={65} height={10} />
                <SkeletonBar width={60} height={10} />
              </div>
            ))}
          </div>
        </div>

        {/* Activity timeline */}
        <SkeletonChart height={200} />

        {/* Cumulative profit + donut */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <SkeletonChart height={260} />
          </div>
          <SkeletonDonut height={260} />
        </div>

        {/* Asset donuts */}
        <div className="grid grid-cols-2 gap-4">
          <SkeletonDonut height={260} />
          <SkeletonDonut height={260} />
        </div>

        {/* Recent liquidations table */}
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse space-y-3">
          <SkeletonBar width={180} height={11} />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <SkeletonBar width={120} height={10} />
              <SkeletonBar width={60} height={10} />
              <SkeletonBar width={80} height={10} />
              <div className="flex-1" />
              <SkeletonBar width={60} height={10} />
              <SkeletonBar width={60} height={10} />
              <SkeletonBar width={60} height={10} />
            </div>
          ))}
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <p className="text-text-tertiary">Liquidator not found.</p>
        <Link href="/leaderboard" className="text-accent text-xs hover:underline mt-2 block">
          Back to leaderboard
        </Link>
      </main>
    )
  }

  const { summary, byProtocol, daily, monthly, fundingSource } = data

  // Build cumulative profit chart from monthly aggregations
  const monthlyMap = new Map<string, { profit: number; netProfit: number; gasUsd: number }>()
  for (const m of monthly) {
    const cur = monthlyMap.get(m.month) || { profit: 0, netProfit: 0, gasUsd: 0 }
    cur.profit += m.profit
    cur.netProfit += m.netProfit
    cur.gasUsd += m.gasUsd
    monthlyMap.set(m.month, cur)
  }
  const profitChart = [...monthlyMap.entries()]
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month))

  let cumulativeGross = 0
  let cumulativeNet = 0
  const cumulativeChart = profitChart.map((p) => {
    cumulativeGross += p.profit
    cumulativeNet += p.netProfit
    return { ...p, cumulativeGross, cumulativeNet }
  })

  // Activity timeline: daily bars with profit/gas/net
  const dailyChart = daily.map((d) => ({
    day: d.day,
    count: d.count,
    profit: d.profit,
    gasUsd: d.gasUsd,
    netProfit: d.netProfit,
  }))

  // Profitability donut for events with gas data
  const profitabilityData = summary.eventsWithGas > 0 ? [
    { name: "Profitable", value: summary.profitableCount, fill: CHART_COLORS.positive },
    { name: "Unprofitable", value: summary.unprofitableCount, fill: CHART_COLORS.negative },
  ] : []

  // Collapse asset breakdowns to top 6 + "Others" so donut labels don't clash
  const buildDonutData = (items: Array<{ symbol: string; volume: number; count: number }>) => {
    if (items.length <= 6) return items
    const top = items.slice(0, 6)
    const rest = items.slice(6)
    const othersVolume = rest.reduce((s, x) => s + x.volume, 0)
    const othersCount = rest.reduce((s, x) => s + x.count, 0)
    return [...top, { symbol: "Others", volume: othersVolume, count: othersCount }]
  }
  const collateralChart = buildDonutData(data.collateralBreakdown)
  const debtChart = buildDonutData(data.debtBreakdown)

  // Paginated events
  const totalEventPages = Math.max(1, Math.ceil(data.recentEvents.length / EVENTS_PER_PAGE))
  const currentEventsPage = Math.min(eventsPage, totalEventPages)
  const pagedEvents = data.recentEvents.slice(
    (currentEventsPage - 1) * EVENTS_PER_PAGE,
    currentEventsPage * EVENTS_PER_PAGE
  )

  const formatAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`
  const profitMargin = summary.totalProfit > 0
    ? ((summary.totalNetProfit / summary.totalProfit) * 100)
    : 0

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <Link href="/leaderboard" className="text-text-tertiary hover:text-accent text-xs">
          &larr; Leaderboard
        </Link>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <h1 className="text-lg font-semibold font-mono">{formatAddr(address)}</h1>
          <a
            href={etherscanAddress(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-accent hover:underline"
          >
            Etherscan ↗
          </a>
          <div className="flex items-center gap-1">
            {summary.protocols.map((p) => (
              <span key={p} className="px-1.5 py-0.5 rounded text-[9px] bg-card-border/50">
                {protocolLabel(p)}
              </span>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-text-tertiary mt-1">
          Active {formatDate(summary.firstActive)} – {formatDate(summary.lastActive)} ·{" "}
          {formatNumber(summary.uniqueBorrowers)} unique borrowers liquidated
        </p>
      </div>

      {/* === Summary KPIs === */}
      <div className="grid grid-cols-5 gap-3">
        <MetricCard
          label="Gross Profit"
          value={formatUSD(summary.totalProfit)}
          sub={`Avg ${formatUSD(summary.avgProfit)} / event`}
          accent
        />
        <MetricCard
          label="Net Profit (After Gas)"
          value={formatUSD(summary.totalNetProfit)}
          sub={`${profitMargin.toFixed(1)}% of gross`}
        />
        <MetricCard
          label="Gas Spent"
          value={formatUSD(summary.totalGasUsd)}
          sub={`${summary.totalGasEth.toFixed(2)} ETH · avg ${formatUSD(summary.avgGasUsd)}`}
        />
        <MetricCard
          label="Total Liquidations"
          value={formatNumber(summary.totalCount)}
          sub={`${formatNumber(summary.totalVolume)} volume`}
        />
        <MetricCard
          label="Profitable / Loss"
          value={summary.eventsWithGas > 0
            ? `${((summary.profitableCount / summary.eventsWithGas) * 100).toFixed(0)}%`
            : "—"}
          sub={summary.eventsWithGas > 0
            ? `${summary.profitableCount} win · ${summary.unprofitableCount} loss`
            : "No gas data"}
        />
      </div>

      {/* === Funding Source / Deployer Card === */}
      {fundingSource && (
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-2">
            {fundingSource.kind === "deployer" ? "Smart Contract Deployer" : "Funding Source"}
            <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-card-border/50 text-text-tertiary">
              {fundingSource.kind === "deployer" ? "Contract" : "EOA"}
            </span>
          </h2>
          <div className="flex items-center gap-4 flex-wrap text-[11px]">
            <div>
              <span className="text-text-tertiary">
                {fundingSource.kind === "deployer" ? "Deployed by:" : "First funded by:"}
              </span>{" "}
              <a
                href={etherscanAddress(fundingSource.fromAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline font-mono"
              >
                {fundingSource.fromLabel || formatAddr(fundingSource.fromAddress)}
              </a>
              {fundingSource.fromLabel && (
                <span className="ml-1 text-text-tertiary font-mono">
                  ({formatAddr(fundingSource.fromAddress)})
                </span>
              )}
            </div>
            {fundingSource.valueEth > 0 && (
              <>
                <div className="text-text-tertiary">·</div>
                <div>
                  <span className="text-text-tertiary">Amount:</span>{" "}
                  <span className="text-text-primary font-mono">{fundingSource.valueEth.toFixed(4)} ETH</span>
                </div>
              </>
            )}
            <div className="text-text-tertiary">·</div>
            <div>
              <span className="text-text-tertiary">
                {fundingSource.kind === "deployer" ? "Deployed:" : "Funded:"}
              </span>{" "}
              <span className="text-text-primary">{formatDate(fundingSource.timestamp)}</span>
            </div>
            <div className="text-text-tertiary">·</div>
            <a
              href={etherscanTx(fundingSource.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline font-mono"
            >
              Tx ↗
            </a>
          </div>
          <p className="text-[10px] text-text-tertiary mt-2 leading-relaxed">
            {fundingSource.kind === "deployer"
              ? "This liquidator is a smart contract. Bots deployed by the same address are likely operated by the same entity, even if they appear as separate liquidators."
              : "This is the first inbound ETH transfer to this wallet. Bots funded from the same source (often a CEX deposit address or a shared operator wallet) are likely operated by the same entity."}
          </p>
        </div>
      )}

      {/* === Cross-Protocol Activity === */}
      {byProtocol.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-accent mb-3">Cross-Protocol Activity</h2>
          <div className="tui-card bg-card-bg border border-card-border rounded overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-card-border text-text-tertiary">
                  <th className="text-left px-3 py-2 font-medium">Protocol</th>
                  <th className="text-right px-3 py-2 font-medium">Liquidations</th>
                  <th className="text-right px-3 py-2 font-medium">Volume</th>
                  <th className="text-right px-3 py-2 font-medium">Gross Profit</th>
                  <th className="text-right px-3 py-2 font-medium">Gas Spent</th>
                  <th className="text-right px-3 py-2 font-medium">Net Profit</th>
                </tr>
              </thead>
              <tbody>
                {byProtocol.map((p) => (
                  <tr key={p.protocol} className="border-b border-card-border/40">
                    <td className="px-3 py-2 font-medium">{protocolLabel(p.protocol)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(p.count)}</td>
                    <td className="px-3 py-2 text-right">{formatUSD(p.volume)}</td>
                    <td className="px-3 py-2 text-right text-positive">{formatUSD(p.grossProfit)}</td>
                    <td className="px-3 py-2 text-right text-negative">{formatUSD(p.gasUsd)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${p.netProfit >= 0 ? "text-positive" : "text-negative"}`}>
                      {formatUSD(p.netProfit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === Activity Timeline === */}
      <div className="tui-card bg-card-bg border border-card-border rounded p-4">
        <h2 className="text-xs font-medium text-text-secondary mb-3">
          Activity Timeline (Liquidations Per Day)
        </h2>
        <div className="h-[200px]">
          {dailyChart.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 9, fill: "var(--text-tertiary)" }}
                  tickFormatter={(v) => v.slice(2, 7)}
                  interval={Math.max(0, Math.floor(dailyChart.length / 12))}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-tertiary)" }} />
                <Tooltip
                  cursor={{ fill: "var(--hover-overlay)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null
                    const d = payload[0].payload as {
                      day: string
                      count: number
                      profit: number
                      gasUsd: number
                      netProfit: number
                    }
                    return (
                      <div
                        className="rounded border shadow-lg backdrop-blur-sm"
                        style={{
                          background: "var(--tooltip-bg)",
                          borderColor: "var(--card-border)",
                          padding: "10px 12px",
                          minWidth: 180,
                        }}
                      >
                        <div className="text-[11px] font-semibold text-text-primary mb-1.5">
                          {d.day}
                        </div>
                        <div className="space-y-1 text-[10px]">
                          <div className="flex justify-between gap-4">
                            <span className="text-text-tertiary">Liquidations</span>
                            <span className="text-accent font-medium">{d.count}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-text-tertiary">Gross profit</span>
                            <span className="text-positive font-medium">{formatUSD(d.profit)}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-text-tertiary">Gas spent</span>
                            <span className="text-negative font-medium">
                              {d.gasUsd > 0 ? formatUSD(d.gasUsd) : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4 pt-1 mt-1 border-t border-card-border">
                            <span className="text-text-tertiary">Net profit</span>
                            <span className={`font-medium ${
                              d.gasUsd === 0 ? "text-text-tertiary" :
                              (d.netProfit >= 0 ? "text-positive" : "text-negative")
                            }`}>
                              {d.gasUsd > 0 ? formatUSD(d.netProfit) : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="count" fill={CHART_COLORS.accent} name="count" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
          )}
        </div>
        <p className="text-[10px] text-text-tertiary mt-2">
          Hover any bar to see the day&apos;s total liquidations, gross profit, gas spent, and net profit.
        </p>
      </div>

      {/* === Profit Over Time === */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 tui-card bg-card-bg border border-card-border rounded p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-3">
            Cumulative Profit Over Time (Gross vs Net)
          </h2>
          <div className="h-[260px]">
            {cumulativeChart.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulativeChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => v.slice(2)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => formatUSD(v)}
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
                      if (name === "cumulativeGross") return [formatUSD(v), "Gross"]
                      if (name === "cumulativeNet") return [formatUSD(v), "Net (after gas)"]
                      return [formatUSD(v), name]
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)", paddingTop: 8 }}
                    iconType="square"
                    formatter={(v) => {
                      if (v === "cumulativeGross") return "Gross profit"
                      if (v === "cumulativeNet") return "Net profit (after gas)"
                      return v
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulativeGross"
                    stroke={CHART_COLORS.accent}
                    fill={CHART_COLORS.accent}
                    fillOpacity={0.1}
                    name="cumulativeGross"
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulativeNet"
                    stroke={CHART_COLORS.positive}
                    fill={CHART_COLORS.positive}
                    fillOpacity={0.15}
                    name="cumulativeNet"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
            )}
          </div>
        </div>

        {/* Profitability donut */}
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-3">
            Win/Loss Rate
          </h2>
          <div className="h-[260px]">
            {profitabilityData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={profitabilityData}
                    cx="50%"
                    cy="45%"
                    innerRadius={50}
                    outerRadius={85}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {profitabilityData.map((entry, i) => (
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
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No gas data</div>
            )}
          </div>
        </div>
      </div>

      {/* === Preferred Assets === */}
      <div className="grid grid-cols-2 gap-4">
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-3">
            Top Collateral Assets Targeted
          </h2>
          <div className="flex gap-4 h-[260px]">
            <div className="flex-1">
              {collateralChart.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={collateralChart}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      dataKey="volume"
                      nameKey="symbol"
                      stroke="var(--card-bg)"
                      strokeWidth={2}
                    >
                      {collateralChart.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
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
                      formatter={(v: number, _n: string, props: any) => [formatUSD(v), props.payload.symbol]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
              )}
            </div>
            <div className="w-[140px] flex flex-col justify-center gap-1.5 overflow-y-auto">
              {collateralChart.map((c, i) => {
                const total = collateralChart.reduce((s, x) => s + x.volume, 0)
                const pct = total > 0 ? (c.volume / total) * 100 : 0
                return (
                  <div key={c.symbol} className="flex items-center gap-2 text-[10px]">
                    <span
                      className="w-2 h-2 rounded-sm flex-shrink-0"
                      style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className="text-text-primary font-medium flex-1 truncate">{c.symbol}</span>
                    <span className="text-text-tertiary">{pct.toFixed(1)}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-3">
            Top Debt Assets Repaid
          </h2>
          <div className="flex gap-4 h-[260px]">
            <div className="flex-1">
              {debtChart.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={debtChart}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      dataKey="volume"
                      nameKey="symbol"
                      stroke="var(--card-bg)"
                      strokeWidth={2}
                    >
                      {debtChart.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
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
                      formatter={(v: number, _n: string, props: any) => [formatUSD(v), props.payload.symbol]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
              )}
            </div>
            <div className="w-[140px] flex flex-col justify-center gap-1.5 overflow-y-auto">
              {debtChart.map((c, i) => {
                const total = debtChart.reduce((s, x) => s + x.volume, 0)
                const pct = total > 0 ? (c.volume / total) * 100 : 0
                return (
                  <div key={c.symbol} className="flex items-center gap-2 text-[10px]">
                    <span
                      className="w-2 h-2 rounded-sm flex-shrink-0"
                      style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className="text-text-primary font-medium flex-1 truncate">{c.symbol}</span>
                    <span className="text-text-tertiary">{pct.toFixed(1)}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* === Recent Liquidations Table with Full Details === */}
      <div className="tui-card bg-card-bg border border-card-border rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-text-secondary">
            Recent Liquidations ({data.recentEvents.length} shown)
          </h2>
          <span className="text-[10px] text-text-tertiary">
            Click any tx hash to view on Etherscan
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-separate border-spacing-0">
            <thead>
              <tr className="text-text-tertiary">
                <th className="text-left pb-2 pr-4 font-medium whitespace-nowrap">Date / Time</th>
                <th className="text-left pb-2 pr-4 font-medium">Protocol</th>
                <th className="text-left pb-2 pr-4 font-medium">Pair</th>
                <th className="text-right pb-2 pr-4 font-medium">Collateral</th>
                <th className="text-right pb-2 pr-4 font-medium">Debt</th>
                <th className="text-right pb-2 pr-4 font-medium whitespace-nowrap">Gross Profit</th>
                <th className="text-right pb-2 pr-4 font-medium whitespace-nowrap">Gas Spent</th>
                <th className="text-right pb-2 pr-6 font-medium whitespace-nowrap">Net Profit</th>
                <th className="text-left pb-2 pr-4 font-medium">Borrower</th>
                <th className="text-left pb-2 font-medium">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {pagedEvents.map((e) => (
                <tr key={e.txHash} className="hover:bg-[var(--hover-overlay)] transition-colors">
                  <td className="py-2 pr-4 text-text-secondary whitespace-nowrap border-t border-card-border/40">
                    {formatDateTime(e.blockTimestamp)}
                  </td>
                  <td className="py-2 pr-4 text-text-secondary border-t border-card-border/40">{protocolLabel(e.protocol)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap border-t border-card-border/40">{e.collateralSymbol}/{e.debtSymbol}</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap border-t border-card-border/40">{formatUSD(e.collateralAmountUsd)}</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap border-t border-card-border/40">{formatUSD(e.debtAmountUsd)}</td>
                  <td className="py-2 pr-4 text-right text-positive whitespace-nowrap border-t border-card-border/40">{formatUSD(e.grossProfitUsd)}</td>
                  <td className="py-2 pr-4 text-right text-negative whitespace-nowrap border-t border-card-border/40">
                    {e.gasCostUsd > 0 ? formatUSD(e.gasCostUsd) : "—"}
                  </td>
                  <td className={`py-2 pr-6 text-right font-medium whitespace-nowrap border-t border-card-border/40 ${
                    e.gasCostUsd === 0 ? "text-text-tertiary" : (e.netProfitUsd >= 0 ? "text-positive" : "text-negative")
                  }`}>
                    {e.gasCostUsd > 0 ? formatUSD(e.netProfitUsd) : "—"}
                  </td>
                  <td className="py-2 pr-4 border-t border-card-border/40">
                    <a
                      href={etherscanAddress(e.borrower)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-secondary hover:text-accent font-mono whitespace-nowrap"
                    >
                      {formatAddr(e.borrower)}
                    </a>
                  </td>
                  <td className="py-2 border-t border-card-border/40">
                    <a
                      href={etherscanTx(e.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline font-mono whitespace-nowrap"
                    >
                      {e.txHash.slice(0, 10)}…
                    </a>
                  </td>
                </tr>
              ))}
              {data.recentEvents.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-4 text-center text-text-tertiary">No events</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {totalEventPages > 1 && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-card-border">
            <span className="text-[10px] text-text-tertiary">
              Showing{" "}
              {(currentEventsPage - 1) * EVENTS_PER_PAGE + 1}–
              {Math.min(currentEventsPage * EVENTS_PER_PAGE, data.recentEvents.length)} of{" "}
              {data.recentEvents.length} events · Page {currentEventsPage} of {totalEventPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setEventsPage(1)}
                disabled={currentEventsPage <= 1}
                className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
              >
                « First
              </button>
              <button
                onClick={() => setEventsPage(Math.max(1, currentEventsPage - 1))}
                disabled={currentEventsPage <= 1}
                className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
              >
                ‹ Prev
              </button>
              <button
                onClick={() => setEventsPage(Math.min(totalEventPages, currentEventsPage + 1))}
                disabled={currentEventsPage >= totalEventPages}
                className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
              >
                Next ›
              </button>
              <button
                onClick={() => setEventsPage(totalEventPages)}
                disabled={currentEventsPage >= totalEventPages}
                className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
              >
                Last »
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer link to methodology */}
      <div className="text-[10px] text-text-tertiary text-center pt-4">
        Curious how these numbers are calculated?{" "}
        <Link href="/methodology" className="text-accent hover:underline">
          Read the methodology →
        </Link>
      </div>
    </main>
  )
}
