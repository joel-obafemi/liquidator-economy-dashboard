"use client"

import { useState, useEffect } from "react"
import { useCachedFetch } from "@/lib/use-cached-fetch"
import {
  formatUSD, formatDateTime, formatAddress, etherscanTx, etherscanAddress, protocolLabel,
} from "@/lib/utils"
import { ProtocolToggle, PeriodToggle } from "@/components/protocol-toggle"
import { SkeletonBar } from "@/components/skeleton"
import Link from "next/link"

interface ExplorerData {
  events: Array<{
    id: number
    protocol: string
    txHash: string
    blockTimestamp: number
    liquidator: string
    borrower: string
    collateralSymbol: string
    debtSymbol: string
    collateralAmountUsd: number
    debtAmountUsd: number
    grossProfitUsd: number
  }>
  total: number
  page: number
  pages: number
}

export default function ExplorerPage() {
  const [protocol, setProtocol] = useState("all")
  const [period, setPeriod] = useState("all")
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState("block_timestamp")
  const [order, setOrder] = useState("DESC")
  const [liquidatorSearch, setLiquidatorSearch] = useState("")
  const [debouncedLiquidator, setDebouncedLiquidator] = useState("")

  // Debounce the search input so we don't fire requests on every keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedLiquidator(liquidatorSearch.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [liquidatorSearch])

  // Validate the search: must look like an Ethereum address (0x + 40 hex chars)
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(debouncedLiquidator)
  const searchInvalid = debouncedLiquidator.length > 0 && !isValidAddress

  const params = new URLSearchParams({
    period,
    page: String(page),
    limit: "50",
    sort,
    order,
  })
  if (protocol !== "all") params.set("protocol", protocol)
  if (isValidAddress) params.set("liquidator", debouncedLiquidator)

  const { data, loading } = useCachedFetch<ExplorerData>(
    `/api/liquidations?${params.toString()}`,
    { enabled: !searchInvalid }
  )

  const toggleSort = (col: string) => {
    if (sort === col) {
      setOrder(order === "DESC" ? "ASC" : "DESC")
    } else {
      setSort(col)
      setOrder("DESC")
    }
    setPage(1)
  }

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Liquidation Explorer</h1>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {data?.total || 0} liquidation events
            {isValidAddress && <span className="text-accent"> · filtered by liquidator</span>}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ProtocolToggle protocol={protocol} onProtocolChange={(v) => { setProtocol(v); setPage(1) }} />
          <PeriodToggle period={period} onPeriodChange={(v) => { setPeriod(v); setPage(1) }} />
        </div>
      </div>

      {/* Liquidator search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={liquidatorSearch}
            onChange={(e) => setLiquidatorSearch(e.target.value)}
            placeholder="Search by liquidator address (0x...)"
            className={`w-full bg-card-bg border rounded px-3 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none transition-colors ${
              searchInvalid
                ? "border-negative/50 focus:border-negative"
                : "border-card-border focus:border-accent/40"
            }`}
          />
          {liquidatorSearch && (
            <button
              onClick={() => setLiquidatorSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary text-[10px]"
              title="Clear"
            >
              ✕
            </button>
          )}
        </div>
        {searchInvalid && (
          <span className="text-[10px] text-negative">Enter a valid 0x address</span>
        )}
        {isValidAddress && (
          <span className="text-[10px] text-text-tertiary">
            Showing liquidations by {debouncedLiquidator.slice(0, 6)}…{debouncedLiquidator.slice(-4)}
          </span>
        )}
      </div>

      <div className="tui-card bg-card-bg border border-card-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-card-border bg-card-bg">
                {[
                  { key: "block_timestamp", label: "Time" },
                  { key: "protocol", label: "Protocol" },
                  { key: "pair", label: "Pair" },
                  { key: "collateral_amount_usd", label: "Collateral" },
                  { key: "debt_amount_usd", label: "Debt" },
                  { key: "gross_profit_usd", label: "Profit" },
                  { key: "liquidator", label: "Liquidator" },
                  { key: "borrower", label: "Borrower" },
                  { key: "tx", label: "Tx" },
                ].map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 font-medium text-text-tertiary text-left cursor-pointer hover:text-accent whitespace-nowrap`}
                    onClick={() => {
                      if (!["pair", "tx", "protocol", "liquidator", "borrower"].includes(col.key)) {
                        toggleSort(col.key)
                      }
                    }}
                  >
                    {col.label}
                    {col.key === sort && (order === "DESC" ? " v" : " ^")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.events || []).map((e) => (
                <tr
                  key={`${e.txHash}-${e.id}`}
                  className="border-b border-card-border/40 hover:bg-[var(--hover-overlay)] transition-colors"
                >
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    {formatDateTime(e.blockTimestamp)}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {protocolLabel(e.protocol)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {e.collateralSymbol}/{e.debtSymbol}
                  </td>
                  <td className="px-3 py-2">{formatUSD(e.collateralAmountUsd)}</td>
                  <td className="px-3 py-2">{formatUSD(e.debtAmountUsd)}</td>
                  <td className="px-3 py-2 text-positive font-medium">
                    {formatUSD(e.grossProfitUsd)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/liquidators/${e.liquidator}`}
                      className="text-accent hover:underline"
                    >
                      {formatAddress(e.liquidator)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={etherscanAddress(e.borrower)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-secondary hover:text-accent"
                    >
                      {formatAddress(e.borrower)}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={etherscanTx(e.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      {e.txHash.slice(0, 8)}...
                    </a>
                  </td>
                </tr>
              ))}
              {loading && !data &&
                Array.from({ length: 15 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-card-border/40 animate-pulse">
                    <td className="px-3 py-3"><SkeletonBar width={120} height={10} /></td>
                    <td className="px-3 py-3"><SkeletonBar width={50} height={10} /></td>
                    <td className="px-3 py-3"><SkeletonBar width={80} height={10} /></td>
                    <td className="px-3 py-3"><SkeletonBar width={60} height={10} /></td>
                    <td className="px-3 py-3"><SkeletonBar width={60} height={10} /></td>
                    <td className="px-3 py-3"><SkeletonBar width={55} height={10} /></td>
                    <td className="px-3 py-3"><SkeletonBar width={80} height={10} /></td>
                    <td className="px-3 py-3"><SkeletonBar width={80} height={10} /></td>
                    <td className="px-3 py-3"><SkeletonBar width={70} height={10} /></td>
                  </tr>
                ))
              }
              {!loading && (!data?.events || data.events.length === 0) && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-text-tertiary">
                    No data yet. Run the scanner to populate.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-card-border">
            <span className="text-[10px] text-text-tertiary">
              Page {data.page} of {data.pages} ({data.total} events)
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
