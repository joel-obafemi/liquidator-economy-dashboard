"use client"

import { useParams } from "next/navigation"
import { useCachedFetch } from "@/lib/use-cached-fetch"
import {
  formatUSD, formatNumber, formatDate, etherscanAddress, protocolLabel, CHART_COLORS,
} from "@/lib/utils"
import { MetricCard } from "@/components/metric-card"
import { ChartWrapper } from "@/components/chart-wrapper"
import { SkeletonKpiRow, SkeletonChart, SkeletonTable, SkeletonBar } from "@/components/skeleton"
import Link from "next/link"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts"

interface ClusterDetail {
  cluster: {
    clusterId: number
    clusterLabel: string
    fundingSource: string
    fundingLabel: string | null
    memberCount: number
    totalProfit: number
    totalVolume: number
    totalEvents: number
    protocols: string[]
  }
  members: Array<{
    liquidator: string
    membershipReason: string
    individualProfit: number
    individualVolume: number
    individualEvents: number
    protocols: string[]
    firstActive: number
    lastActive: number
  }>
  monthly: Array<{
    month: string
    eventCount: number
    profit: number
    volume: number
    activeMembers: number
  }>
  protocolBreakdown: Array<{
    protocol: string
    eventCount: number
    volume: number
    profit: number
    membersActive: number
  }>
  topAssets: Array<{
    symbol: string
    eventCount: number
    volume: number
    profit: number
  }>
}

const PIE_COLORS = ["#FF6B35", "#FF9F1C", "#06D6A0", "#118AB2", "#8B5CF6", "#EC4899", "#14B8A6", "#F59E0B"]

export default function ClusterDetailPage() {
  const params = useParams()
  const clusterId = params.id as string

  const { data, loading } = useCachedFetch<ClusterDetail>(
    `/api/clusters/${clusterId}`
  )

  const cluster = data?.cluster
  const members = data?.members || []
  const formatAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`

  if (loading && !data) {
    return (
      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        <SkeletonBar width={300} height={20} className="animate-pulse" />
        <SkeletonBar width={500} height={12} className="animate-pulse" />
        <SkeletonKpiRow count={4} />
        <div className="grid grid-cols-2 gap-4">
          <SkeletonChart height={280} />
          <SkeletonChart height={280} />
        </div>
        <SkeletonTable columns={6} rows={5} headers={["Address", "Events", "Volume", "Profit", "Protocols", "Active"]} title="Members" />
      </main>
    )
  }

  if (!cluster) {
    return (
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <p className="text-text-tertiary">Cluster not found</p>
        <Link href="/clusters" className="text-accent hover:underline text-sm mt-2 inline-block">
          ← Back to clusters
        </Link>
      </main>
    )
  }

  // Protocol pie data
  const protocolPie = (data?.protocolBreakdown || []).map((p) => ({
    name: protocolLabel(p.protocol),
    value: p.profit,
    protocol: p.protocol,
  }))

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <Link href="/clusters" className="text-[10px] text-accent hover:underline">
          ← All Clusters
        </Link>
        <h1 className="text-lg font-semibold text-text-primary mt-1">
          {cluster.clusterLabel}
        </h1>
        <p className="text-[11px] text-text-tertiary mt-0.5">
          {cluster.memberCount} wallet{cluster.memberCount !== 1 ? "s" : ""} funded by{" "}
          <a
            href={etherscanAddress(cluster.fundingSource)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline font-mono"
          >
            {formatAddr(cluster.fundingSource)}
          </a>
          {cluster.fundingLabel && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-card-border/50 text-text-tertiary">
              {cluster.fundingLabel}
            </span>
          )}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          label="Total Profit"
          value={formatUSD(cluster.totalProfit)}
          sub={`${cluster.memberCount} wallets combined`}
          accent
        />
        <MetricCard
          label="Total Volume"
          value={formatUSD(cluster.totalVolume)}
          sub="Collateral seized"
        />
        <MetricCard
          label="Total Events"
          value={formatNumber(cluster.totalEvents)}
        />
        <MetricCard
          label="Protocols"
          value={`${cluster.protocols.length}`}
          sub={cluster.protocols.map(protocolLabel).join(", ")}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Monthly Activity */}
        <ChartWrapper title="Monthly Cluster Activity" height={260}>
          {(data?.monthly || []).length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data!.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 9, fill: "var(--text-tertiary)" }}
                  tickFormatter={(v) => v.slice(2)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                  tickFormatter={(v) => `$${(v / 1e3).toFixed(0)}K`}
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
                    if (name === "profit") return [formatUSD(v), "Profit"]
                    if (name === "activeMembers") return [v, "Active Wallets"]
                    return [formatNumber(v), name]
                  }}
                />
                <Bar dataKey="profit" name="profit" fill={CHART_COLORS.accent} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
          )}
        </ChartWrapper>

        {/* Protocol Breakdown Pie */}
        <ChartWrapper title="Profit by Protocol" height={260}>
          {protocolPie.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={protocolPie}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={90}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {protocolPie.map((entry) => (
                    <Cell
                      key={entry.protocol}
                      fill={CHART_COLORS[entry.protocol as keyof typeof CHART_COLORS] || CHART_COLORS.accent}
                    />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatUSD(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-text-tertiary text-xs">No data</div>
          )}
        </ChartWrapper>
      </div>

      {/* Member Wallets Table */}
      <div className="tui-card bg-card-bg border border-card-border rounded p-4">
        <h2 className="text-xs font-medium text-text-secondary mb-3">
          Member Wallets ({members.length})
        </h2>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-text-tertiary border-b border-card-border">
              <th className="text-left pb-2 font-medium">#</th>
              <th className="text-left pb-2 font-medium">Address</th>
              <th className="text-right pb-2 font-medium">Events</th>
              <th className="text-right pb-2 font-medium">Volume</th>
              <th className="text-right pb-2 font-medium">Profit</th>
              <th className="text-left pb-2 font-medium pl-3">Protocols</th>
              <th className="text-right pb-2 font-medium">First Active</th>
              <th className="text-right pb-2 font-medium">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m, i) => (
              <tr key={m.liquidator} className="border-b border-card-border/50 hover:bg-card-hover transition-colors">
                <td className="py-2 text-text-tertiary">{i + 1}</td>
                <td className="py-2">
                  <Link
                    href={`/liquidators/${m.liquidator}`}
                    className="text-accent hover:underline font-mono"
                  >
                    {formatAddr(m.liquidator)}
                  </Link>
                </td>
                <td className="py-2 text-right text-text-secondary">{formatNumber(m.individualEvents)}</td>
                <td className="py-2 text-right text-text-secondary">{formatUSD(m.individualVolume)}</td>
                <td className="py-2 text-right text-positive font-medium">{formatUSD(m.individualProfit)}</td>
                <td className="py-2 pl-3">
                  <div className="flex flex-wrap gap-1">
                    {m.protocols.sort().map((p) => (
                      <span
                        key={p}
                        className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                        style={{
                          background: `${CHART_COLORS[p as keyof typeof CHART_COLORS] || CHART_COLORS.accent}20`,
                          color: CHART_COLORS[p as keyof typeof CHART_COLORS] || CHART_COLORS.accent,
                        }}
                      >
                        {protocolLabel(p)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2 text-right text-text-tertiary text-[10px]">
                  {formatDate(m.firstActive)}
                </td>
                <td className="py-2 text-right text-text-tertiary text-[10px]">
                  {formatDate(m.lastActive)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top Assets */}
      {(data?.topAssets || []).length > 0 && (
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-3">
            Top Collateral Assets Targeted
          </h2>
          <div className="grid grid-cols-5 gap-3">
            {data!.topAssets.slice(0, 5).map((a, i) => (
              <div key={a.symbol} className="text-center p-3 rounded" style={{ background: "var(--hover-overlay)" }}>
                <div className="text-[13px] font-semibold text-text-primary">{a.symbol}</div>
                <div className="text-[10px] text-text-tertiary mt-1">{formatUSD(a.volume)} vol</div>
                <div className="text-[10px] text-positive">{formatUSD(a.profit)} profit</div>
                <div className="text-[9px] text-text-tertiary">{formatNumber(a.eventCount)} events</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
