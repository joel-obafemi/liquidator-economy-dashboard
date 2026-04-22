"use client"

import { useState } from "react"
import { useCachedFetch } from "@/lib/use-cached-fetch"
import { formatUSD, formatNumber, protocolLabel, etherscanAddress, CHART_COLORS } from "@/lib/utils"
import { MetricCard } from "@/components/metric-card"
import { SkeletonKpiRow, SkeletonTable } from "@/components/skeleton"
import Link from "next/link"

interface ClusterData {
  clusters: Array<{
    rank: number
    clusterId: number
    clusterLabel: string
    fundingSource: string
    fundingLabel: string | null
    memberCount: number
    totalProfit: number
    totalVolume: number
    totalEvents: number
    protocols: string[]
    profitShare: number
  }>
  total: number
  page: number
  limit: number
  pages: number
  summary: {
    clusterCount: number
    clusteredAddresses: number
    totalLiquidators: number
    clusteredProfit: number
    clusteredVolume: number
    clusteredEvents: number
    globalProfit: number
    globalVolume: number
    globalEvents: number
  }
}

export default function ClustersPage() {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState("total_profit")
  const [order, setOrder] = useState("DESC")

  const { data, loading } = useCachedFetch<ClusterData>(
    `/api/clusters?page=${page}&limit=25&sort=${sort}&order=${order}`
  )

  const summary = data?.summary
  const clusteredPct = summary && summary.totalLiquidators > 0
    ? ((summary.clusteredAddresses / summary.totalLiquidators) * 100).toFixed(1)
    : "0"
  const profitPct = summary && summary.globalProfit > 0
    ? ((summary.clusteredProfit / summary.globalProfit) * 100).toFixed(1)
    : "0"

  const handleSort = (col: string) => {
    if (sort === col) {
      setOrder(order === "DESC" ? "ASC" : "DESC")
    } else {
      setSort(col)
      setOrder("DESC")
    }
    setPage(1)
  }

  const sortIcon = (col: string) => {
    if (sort !== col) return ""
    return order === "DESC" ? " ↓" : " ↑"
  }

  const formatAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Bot Clusters</h1>
        <p className="text-[11px] text-text-tertiary mt-0.5">
          Liquidator wallets grouped by shared funding source — revealing the real operators behind the bots
        </p>
      </div>

      {/* KPI Cards */}
      {loading && !data ? (
        <SkeletonKpiRow count={4} />
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            label="Operator Clusters"
            value={formatNumber(summary?.clusterCount || 0)}
            sub={`${formatNumber(summary?.clusteredAddresses || 0)} addresses clustered`}
            accent
          />
          <MetricCard
            label="Clustered Liquidators"
            value={`${clusteredPct}%`}
            sub={`${summary?.clusteredAddresses || 0} of ${summary?.totalLiquidators || 0} addresses`}
          />
          <MetricCard
            label="Clustered Profit"
            value={formatUSD(summary?.clusteredProfit || 0)}
            sub={`${profitPct}% of all profit`}
          />
          <MetricCard
            label="Clustered Volume"
            value={formatUSD(summary?.clusteredVolume || 0)}
            sub={`${formatNumber(summary?.clusteredEvents || 0)} events`}
          />
        </div>
      )}

      {/* Cluster Table */}
      {loading && !data ? (
        <SkeletonTable
          columns={7}
          rows={10}
          headers={["#", "Operator", "Wallets", "Events", "Volume", "Profit", "Share"]}
          title="Operator Clusters"
        />
      ) : (
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium text-text-secondary">
              Operator Clusters — Ranked by Profit
            </h2>
            <span className="text-[10px] text-text-tertiary">
              Click any row to explore the cluster
            </span>
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-text-tertiary border-b border-card-border">
                <th className="text-left pb-2 font-medium w-10">#</th>
                <th className="text-left pb-2 font-medium">Operator</th>
                <th className="text-left pb-2 font-medium">Funding Source</th>
                <th
                  className="text-right pb-2 font-medium cursor-pointer hover:text-accent"
                  onClick={() => handleSort("member_count")}
                >
                  Wallets{sortIcon("member_count")}
                </th>
                <th
                  className="text-right pb-2 font-medium cursor-pointer hover:text-accent"
                  onClick={() => handleSort("total_events")}
                >
                  Events{sortIcon("total_events")}
                </th>
                <th
                  className="text-right pb-2 font-medium cursor-pointer hover:text-accent"
                  onClick={() => handleSort("total_volume")}
                >
                  Volume{sortIcon("total_volume")}
                </th>
                <th
                  className="text-right pb-2 font-medium cursor-pointer hover:text-accent"
                  onClick={() => handleSort("total_profit")}
                >
                  Profit{sortIcon("total_profit")}
                </th>
                <th className="text-right pb-2 font-medium">Share</th>
                <th className="text-left pb-2 font-medium pl-3">Protocols</th>
              </tr>
            </thead>
            <tbody>
              {(data?.clusters || []).map((c) => (
                <tr
                  key={c.clusterId}
                  className="border-b border-card-border/50 hover:bg-card-hover transition-colors cursor-pointer"
                >
                  <td className="py-2.5 text-text-tertiary">{c.rank}</td>
                  <td className="py-2.5">
                    <Link
                      href={`/clusters/${c.clusterId}`}
                      className="text-accent hover:underline font-medium"
                    >
                      {c.clusterLabel}
                    </Link>
                  </td>
                  <td className="py-2.5">
                    <a
                      href={etherscanAddress(c.fundingSource)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-secondary hover:text-accent font-mono text-[10px]"
                    >
                      {formatAddr(c.fundingSource)}
                    </a>
                    {c.fundingLabel && (
                      <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-card-border/50 text-text-tertiary">
                        {c.fundingLabel}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right text-accent font-medium">
                    {c.memberCount}
                  </td>
                  <td className="py-2.5 text-right text-text-secondary">
                    {formatNumber(c.totalEvents)}
                  </td>
                  <td className="py-2.5 text-right text-text-secondary">
                    {formatUSD(c.totalVolume)}
                  </td>
                  <td className="py-2.5 text-right text-positive font-medium">
                    {formatUSD(c.totalProfit)}
                  </td>
                  <td className="py-2.5 text-right text-text-secondary">
                    {c.profitShare.toFixed(1)}%
                  </td>
                  <td className="py-2.5 pl-3">
                    <div className="flex flex-wrap gap-1">
                      {c.protocols.sort().map((p) => (
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
                </tr>
              ))}
              {(!data?.clusters || data.clusters.length === 0) && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-text-tertiary">
                    No clusters found. Run the clustering script to populate.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {data && data.pages > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-card-border">
              <span className="text-[10px] text-text-tertiary">
                Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, data.total)} of {data.total} clusters
                · Page {page} of {data.pages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                  className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
                >
                  « First
                </button>
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
                >
                  ‹ Prev
                </button>
                <button
                  onClick={() => setPage(Math.min(data.pages, page + 1))}
                  disabled={page >= data.pages}
                  className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
                >
                  Next ›
                </button>
                <button
                  onClick={() => setPage(data.pages)}
                  disabled={page >= data.pages}
                  className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
                >
                  Last »
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Explanation */}
      <div className="text-[10px] text-text-tertiary leading-relaxed border-t border-card-border pt-4">
        <p>
          <span className="text-text-primary font-medium">How clustering works:</span>{" "}
          We trace the first incoming ETH transfer to each liquidator wallet. Wallets
          funded by the same address are grouped into a cluster, revealing the real
          operators behind multiple bot addresses. Contract wallets are grouped by their
          deployer address instead.
        </p>
      </div>
    </main>
  )
}
