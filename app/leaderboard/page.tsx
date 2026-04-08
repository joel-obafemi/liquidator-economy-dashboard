"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useCachedFetch } from "@/lib/use-cached-fetch"
import { formatUSD, formatNumber, formatDate, protocolLabel } from "@/lib/utils"
import { ProtocolToggle, PeriodToggle } from "@/components/protocol-toggle"
import { SkeletonBar } from "@/components/skeleton"

interface LeaderboardData {
  liquidators: Array<{
    rank: number
    liquidator: string
    liquidationCount: number
    totalDebtRepaid: number
    totalVolume: number
    totalGrossProfit: number
    profitShare: number
    lastActive: number
    protocols: string[]
  }>
  total: number
  page: number
  pages: number
}

export default function LeaderboardPage() {
  const router = useRouter()
  const [protocol, setProtocol] = useState("all")
  const [period, setPeriod] = useState("all")
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState("total_gross_profit")

  const { data, loading } = useCachedFetch<LeaderboardData>(
    `/api/liquidators?protocol=${protocol}&period=${period}&page=${page}&limit=25&sort=${sort}`
  )

  const formatAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`

  const columns = [
    { key: "rank", label: "#", sortable: false },
    { key: "liquidator", label: "Liquidator", sortable: false },
    { key: "liquidation_count", label: "Events", sortable: true },
    { key: "total_debt_repaid", label: "Debt Repaid", sortable: true },
    { key: "total_volume", label: "Collateral Seized", sortable: true },
    { key: "total_gross_profit", label: "Gross Profit", sortable: true },
    { key: "profitShare", label: "Share", sortable: false },
    { key: "last_active", label: "Last Active", sortable: true },
    { key: "protocols", label: "Protocols", sortable: false },
    { key: "chevron", label: "", sortable: false },
  ]

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Liquidator Leaderboard</h1>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {data?.total || 0} unique liquidators ranked by gross profit
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ProtocolToggle protocol={protocol} onProtocolChange={(v) => { setProtocol(v); setPage(1) }} />
          <PeriodToggle period={period} onPeriodChange={(v) => { setPeriod(v); setPage(1) }} />
        </div>
      </div>

      {/* Click-to-open hint */}
      <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
        <span>
          Click any row to open the liquidator&apos;s full profile — activity timeline,
          cross-protocol stats, gas efficiency, funding source, and event history.
        </span>
      </div>

      <div className="tui-card bg-card-bg border border-card-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-card-border bg-card-bg">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 font-medium text-text-tertiary ${
                      col.key === "liquidator" ? "text-left" : "text-right"
                    } ${col.key === "rank" ? "text-left w-10" : ""} ${
                      col.sortable ? "cursor-pointer hover:text-accent" : ""
                    }`}
                    onClick={() => {
                      if (col.sortable) {
                        setSort(col.key)
                        setPage(1)
                      }
                    }}
                  >
                    {col.label}
                    {col.key === sort && " *"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.liquidators || []).map((l) => (
                <tr
                  key={l.liquidator}
                  onClick={() => router.push(`/liquidators/${l.liquidator}`)}
                  onMouseEnter={() => {
                    // Prefetch the profile for snappy navigation
                    router.prefetch(`/liquidators/${l.liquidator}`)
                  }}
                  className="group border-b border-card-border/40 hover:bg-[var(--hover-overlay)] hover:border-accent/20 transition-colors cursor-pointer"
                  title={`View full profile for ${l.liquidator}`}
                >
                  <td className="px-3 py-2 text-text-tertiary">{l.rank}</td>
                  <td className="px-3 py-2 text-left">
                    <span className="text-accent group-hover:underline font-mono">
                      {formatAddr(l.liquidator)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(l.liquidationCount)}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(l.totalDebtRepaid)}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(l.totalVolume)}</td>
                  <td className="px-3 py-2 text-right text-positive font-medium">
                    {formatUSD(l.totalGrossProfit)}
                  </td>
                  <td className="px-3 py-2 text-right text-text-secondary">
                    {l.profitShare.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right text-text-secondary">
                    {formatDate(l.lastActive)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {l.protocols.map((p) => (
                        <span
                          key={p}
                          className="px-1.5 py-0.5 rounded text-[9px] bg-card-border/50"
                        >
                          {protocolLabel(p)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right w-8">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="inline text-text-tertiary group-hover:text-accent group-hover:translate-x-0.5 transition-all"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </td>
                </tr>
              ))}
              {loading && !data &&
                Array.from({ length: 15 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-card-border/40 animate-pulse">
                    <td className="px-3 py-3"><SkeletonBar width={18} height={10} /></td>
                    <td className="px-3 py-3"><SkeletonBar width="70%" height={10} /></td>
                    <td className="px-3 py-3"><div className="flex justify-end"><SkeletonBar width={38} height={10} /></div></td>
                    <td className="px-3 py-3"><div className="flex justify-end"><SkeletonBar width={56} height={10} /></div></td>
                    <td className="px-3 py-3"><div className="flex justify-end"><SkeletonBar width={60} height={10} /></div></td>
                    <td className="px-3 py-3"><div className="flex justify-end"><SkeletonBar width={54} height={10} /></div></td>
                    <td className="px-3 py-3"><div className="flex justify-end"><SkeletonBar width={32} height={10} /></div></td>
                    <td className="px-3 py-3"><div className="flex justify-end"><SkeletonBar width={60} height={10} /></div></td>
                    <td className="px-3 py-3"><div className="flex justify-end"><SkeletonBar width={50} height={10} /></div></td>
                    <td className="px-3 py-3"><div className="flex justify-end"><SkeletonBar width={12} height={10} /></div></td>
                  </tr>
                ))
              }
              {!loading && (!data?.liquidators || data.liquidators.length === 0) && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-text-tertiary">
                    No data yet. Run the scanner to populate.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-card-border">
            <span className="text-[10px] text-text-tertiary">
              Page {data.page} of {data.pages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(Math.min(data.pages, page + 1))}
                disabled={page >= data.pages}
                className="px-2 py-1 text-[10px] rounded border border-card-border disabled:opacity-30 hover:border-accent/30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
