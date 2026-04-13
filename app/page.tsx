"use client"

import { useState } from "react"
import { useCachedFetch } from "@/lib/use-cached-fetch"
import { formatUSD, formatNumber, protocolLabel, CHART_COLORS } from "@/lib/utils"
import { MetricCard } from "@/components/metric-card"
import { ProtocolToggle, PeriodToggle } from "@/components/protocol-toggle"
import { SkeletonKpiRow, SkeletonChart, SkeletonDonut, SkeletonTable } from "@/components/skeleton"
import { ChartWrapper } from "@/components/chart-wrapper"
import Link from "next/link"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts"

const PROTOCOL_NAME_MAP: Record<string, string> = {
  aave_v3: "Aave V3",
  spark: "SparkLend",
  morpho_blue: "Morpho",
  fluid: "Fluid",
}

interface OverviewData {
  stats: Array<{
    protocol: string
    totalEvents: number
    totalVolume: number
    totalGrossProfit: number
    uniqueLiquidators: number
    uniqueBorrowers: number
  }>
  totals: {
    totalEvents: number
    totalVolume: number
    totalGrossProfit: number
    uniqueLiquidators: number
    uniqueBorrowers: number
  }
  monthly: Array<{
    month: string
    protocol: string
    volume: number
    count: number
    profit: number
  }>
  top5: Array<{
    liquidator: string
    count: number
    totalProfit: number
    totalVolume: number
  }>
  recentLarge: Array<{
    txHash: string
    protocol: string
    collateralSymbol: string
    debtSymbol: string
    collateralAmountUsd: number
    grossProfitUsd: number
    blockTimestamp: number
  }>
}

export default function OverviewPage() {
  const [protocol, setProtocol] = useState("all")
  const [period, setPeriod] = useState("all")

  const { data, loading } = useCachedFetch<OverviewData>(
    `/api/overview?protocol=${protocol}&period=${period}`
  )

  // Use the API's pre-aggregated `totals` so cross-protocol liquidators
  // (and borrowers) are counted ONCE, not summed naively across protocols.
  const totals = data?.totals

  // Prepare monthly chart data - merge protocols by month
  const monthlyMap = new Map<string, any>()
  for (const m of data?.monthly || []) {
    if (!monthlyMap.has(m.month)) {
      monthlyMap.set(m.month, { month: m.month, aave_v3: 0, spark: 0, morpho_blue: 0, fluid: 0 })
    }
    const entry = monthlyMap.get(m.month)!
    entry[m.protocol] = m.volume
  }
  const chartData = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month))

  // Protocol breakdown for pie chart
  const pieData = (data?.stats || []).map((s) => ({
    name: protocolLabel(s.protocol),
    value: s.totalVolume,
    protocol: s.protocol,
  }))

  const formatAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Liquidation Economy</h1>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            Who profits when DeFi borrowers get liquidated?
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ProtocolToggle protocol={protocol} onProtocolChange={setProtocol} />
          <PeriodToggle period={period} onPeriodChange={setPeriod} />
        </div>
      </div>

      {/* KPI Cards */}
      {loading && !data ? (
        <SkeletonKpiRow count={4} />
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            label="Total Liquidation Volume"
            value={formatUSD(totals?.totalVolume || 0)}
            sub="Collateral seized"
            accent
          />
          <MetricCard
            label="Gross Profit Extracted"
            value={formatUSD(totals?.totalGrossProfit || 0)}
            sub="Before gas costs"
          />
          <MetricCard
            label="Unique Liquidators"
            value={formatNumber(totals?.uniqueLiquidators || 0)}
          />
          <MetricCard
            label="Total Events"
            value={formatNumber(totals?.totalEvents || 0)}
            sub={`${formatNumber(totals?.uniqueBorrowers || 0)} borrowers liquidated`}
          />
        </div>
      )}

      {/* Charts row */}
      {loading && !data ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <SkeletonChart height={280} />
          </div>
          <SkeletonDonut height={280} />
        </div>
      ) : (
      <div className="grid grid-cols-3 gap-4">
        {/* Volume over time */}
        <ChartWrapper title="Liquidation Volume Over Time" className="col-span-2" height={280}>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => v.slice(2)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`}
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
                    formatter={(v: number, name: string) => [formatUSD(v), PROTOCOL_NAME_MAP[name] || name]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)", paddingTop: 8 }}
                    iconType="square"
                    formatter={(v) => PROTOCOL_NAME_MAP[v] || v}
                  />
                  <Bar dataKey="aave_v3" name="aave_v3" stackId="a" fill={CHART_COLORS.aave_v3} />
                  <Bar dataKey="spark" name="spark" stackId="a" fill={CHART_COLORS.spark} />
                  <Bar dataKey="morpho_blue" name="morpho_blue" stackId="a" fill={CHART_COLORS.morpho_blue} />
                  <Bar dataKey="fluid" name="fluid" stackId="a" fill={CHART_COLORS.fluid} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">
                {loading ? "Loading..." : "No data yet. Run the scanner to populate."}
              </div>
            )}
        </ChartWrapper>

        {/* Protocol breakdown */}
        <ChartWrapper title="Protocol Breakdown" height={280}>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="45%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {pieData.map((entry) => (
                      <Cell
                        key={entry.protocol}
                        fill={
                          CHART_COLORS[entry.protocol as keyof typeof CHART_COLORS] ||
                          CHART_COLORS.accent
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatUSD(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">
                No data
              </div>
            )}
        </ChartWrapper>
      </div>
      )}

      {/* Top Liquidators + Recent Large */}
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4">
          <SkeletonTable columns={4} rows={5} headers={["#", "Address", "Profit", "Count"]} title="Top Liquidators" />
          <SkeletonTable columns={4} rows={5} headers={["Protocol", "Pair", "Volume", "Profit"]} title="Largest Liquidations" />
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-4">
        {/* Top 5 */}
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium text-text-secondary">Top Liquidators</h2>
            <Link href="/leaderboard" className="text-[10px] text-accent hover:underline">
              View All
            </Link>
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-text-tertiary border-b border-card-border">
                <th className="text-left pb-2 font-medium">#</th>
                <th className="text-left pb-2 font-medium">Address</th>
                <th className="text-right pb-2 font-medium">Profit</th>
                <th className="text-right pb-2 font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {(data?.top5 || []).map((l, i) => (
                <tr key={l.liquidator} className="border-b border-card-border/50">
                  <td className="py-2 text-text-tertiary">{i + 1}</td>
                  <td className="py-2">
                    <Link
                      href={`/liquidators/${l.liquidator}`}
                      className="text-accent hover:underline"
                    >
                      {formatAddr(l.liquidator)}
                    </Link>
                  </td>
                  <td className="py-2 text-right text-positive">{formatUSD(l.totalProfit)}</td>
                  <td className="py-2 text-right text-text-secondary">{l.count}</td>
                </tr>
              ))}
              {(!data?.top5 || data.top5.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-text-tertiary">
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Recent large liquidations */}
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-3">
            Largest Liquidations
          </h2>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-text-tertiary border-b border-card-border">
                <th className="text-left pb-2 font-medium">Protocol</th>
                <th className="text-left pb-2 font-medium">Pair</th>
                <th className="text-right pb-2 font-medium">Volume</th>
                <th className="text-right pb-2 font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentLarge || []).map((e) => (
                <tr key={e.txHash} className="border-b border-card-border/50">
                  <td className="py-2">
                    <span className="text-text-secondary">{protocolLabel(e.protocol)}</span>
                  </td>
                  <td className="py-2">
                    {e.collateralSymbol}/{e.debtSymbol}
                  </td>
                  <td className="py-2 text-right">{formatUSD(e.collateralAmountUsd)}</td>
                  <td className="py-2 text-right text-positive">
                    {formatUSD(e.grossProfitUsd)}
                  </td>
                </tr>
              ))}
              {(!data?.recentLarge || data.recentLarge.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-text-tertiary">
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </main>
  )
}
