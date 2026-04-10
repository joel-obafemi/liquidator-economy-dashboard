"use client"

import { useState } from "react"
import { useCachedFetch } from "@/lib/use-cached-fetch"
import { formatUSD, formatNumber, formatDate, protocolLabel, CHART_COLORS } from "@/lib/utils"
import { MetricCard } from "@/components/metric-card"
import { ProtocolToggle, PeriodToggle } from "@/components/protocol-toggle"
import { SkeletonKpiRow, SkeletonChart, SkeletonTable } from "@/components/skeleton"
import { ChartWrapper } from "@/components/chart-wrapper"
import Link from "next/link"
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts"

const REKT_COLORS = {
  barDefault: "rgba(255, 107, 53, 0.6)",
  barRekt: "#FF4444",
  ethLine: "#10B981",
  rektDot: "#FF4444",
}

interface DailyEntry {
  day: string
  eventCount: number
  totalVolume: number
  totalGrossProfit: number
  biggestLiquidation: number
  uniqueLiquidators: number
  uniqueBorrowers: number
  topProtocol: string
  ethPrice: number | null
  isTopRekt: boolean
  rektRank: number
}

interface RektDay {
  day: string
  eventCount: number
  totalVolume: number
  totalGrossProfit: number
  biggestLiquidation: number
  uniqueLiquidators: number
  uniqueBorrowers: number
  topProtocol: string
  ethPrice: number | null
  ethPriceChange: number | null
  rektRank: number
}

interface RektMapData {
  daily: DailyEntry[]
  topRektDays: RektDay[]
  summary: {
    totalDays: number
    totalVolume: number
    totalEvents: number
    avgDailyVolume: number
    maxDailyVolume: number
  }
}

function formatShortDate(day: string) {
  const d = new Date(day + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
}

function formatFullDate(day: string) {
  const d = new Date(day + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload as DailyEntry
  return (
    <div
      className="rounded p-3 text-[11px] space-y-1.5 max-w-[220px]"
      style={{
        background: "var(--tooltip-bg)",
        border: "1px solid var(--card-border)",
        color: "var(--text-primary)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{formatFullDate(d.day)}</span>
        {d.isTopRekt && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "rgba(255, 68, 68, 0.2)", color: "#FF4444" }}
          >
            REKT #{d.rektRank}
          </span>
        )}
      </div>
      <div className="border-t pt-1.5" style={{ borderColor: "var(--card-border)" }}>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-tertiary)" }}>Volume</span>
          <span className="font-medium">{formatUSD(d.totalVolume)}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-tertiary)" }}>Events</span>
          <span>{formatNumber(d.eventCount)}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-tertiary)" }}>Profit Extracted</span>
          <span style={{ color: "var(--positive)" }}>{formatUSD(d.totalGrossProfit)}</span>
        </div>
        {d.ethPrice != null && (
          <div className="flex justify-between">
            <span style={{ color: "var(--text-tertiary)" }}>ETH Price</span>
            <span style={{ color: REKT_COLORS.ethLine }}>
              ${d.ethPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span style={{ color: "var(--text-tertiary)" }}>Top Protocol</span>
          <span>{protocolLabel(d.topProtocol)}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-tertiary)" }}>Biggest Liq</span>
          <span>{formatUSD(d.biggestLiquidation)}</span>
        </div>
      </div>
    </div>
  )
}

// Custom dot renderer for rekt days on the bar chart
function RektDot({ cx, cy, payload }: any) {
  if (!payload?.isTopRekt) return null
  return (
    <g>
      {/* Outer glow */}
      <circle cx={cx} cy={cy} r={12} fill="rgba(255, 68, 68, 0.15)" />
      {/* Main dot */}
      <circle cx={cx} cy={cy} r={6} fill={REKT_COLORS.rektDot} stroke="#fff" strokeWidth={1.5} />
      {/* Rank label */}
      <text
        x={cx}
        y={cy - 16}
        textAnchor="middle"
        fill="#FF4444"
        fontSize={9}
        fontWeight="bold"
        fontFamily="JetBrains Mono, monospace"
      >
        #{payload.rektRank}
      </text>
    </g>
  )
}

export default function RektMapPage() {
  const [protocol, setProtocol] = useState("all")
  const [period, setPeriod] = useState("all")

  const { data, loading } = useCachedFetch<RektMapData>(
    `/api/rekt-map?protocol=${protocol}&period=${period}`
  )

  const chartData = data?.daily || []
  const topRekt = data?.topRektDays || []
  const summary = data?.summary
  const rektDaySet = new Set(topRekt.map((r) => r.day))

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">
            Rekt Map
          </h1>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            When ETH dumps, liquidations cascade. A visual timeline of DeFi's worst days.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ProtocolToggle protocol={protocol} onProtocolChange={setProtocol} />
          <PeriodToggle period={period} onPeriodChange={setPeriod} />
        </div>
      </div>

      {/* Hero Chart */}
      {loading && !data ? (
        <SkeletonChart height={400} />
      ) : (
        <ChartWrapper
          title="Liquidation Volume vs ETH Price"
          height={400}
          headerExtra={
            <div className="flex items-center gap-4 text-[10px] text-text-tertiary">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2 rounded-sm" style={{ background: REKT_COLORS.barDefault }} />
                Volume
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5" style={{ background: REKT_COLORS.ethLine }} />
                ETH Price
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: REKT_COLORS.rektDot }} />
                Top 10 Rekt Days
              </span>
            </div>
          }
        >
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 24, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => {
                      const d = new Date(v + "T00:00:00")
                      return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
                    }}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    yAxisId="volume"
                    tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
                    tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`}
                    width={65}
                  />
                  <YAxis
                    yAxisId="price"
                    orientation="right"
                    tick={{ fontSize: 10, fill: REKT_COLORS.ethLine }}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                    width={55}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="totalVolume"
                    yAxisId="volume"
                    radius={[1, 1, 0, 0]}
                    maxBarSize={8}
                  >
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={rektDaySet.has(entry.day) ? REKT_COLORS.barRekt : REKT_COLORS.barDefault}
                      />
                    ))}
                  </Bar>
                  <Line
                    dataKey="ethPrice"
                    yAxisId="price"
                    type="monotone"
                    stroke={REKT_COLORS.ethLine}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    activeDot={false}
                  />
                  {/* Rekt day dots rendered as custom Line dots */}
                  <Line
                    dataKey="totalVolume"
                    yAxisId="volume"
                    stroke="none"
                    fill="none"
                    dot={<RektDot />}
                    activeDot={false}
                    legendType="none"
                    tooltipType="none"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-xs">
                No data available for the selected filters.
              </div>
            )}
        </ChartWrapper>
      )}

      {/* KPI Cards */}
      {loading && !data ? (
        <SkeletonKpiRow count={4} />
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            label="Trading Days"
            value={formatNumber(summary?.totalDays || 0)}
            sub="Days with liquidations"
          />
          <MetricCard
            label="Total Volume"
            value={formatUSD(summary?.totalVolume || 0)}
            sub="Collateral seized"
          />
          <MetricCard
            label="Avg Daily Volume"
            value={formatUSD(summary?.avgDailyVolume || 0)}
          />
          <MetricCard
            label="Worst Day Volume"
            value={formatUSD(summary?.maxDailyVolume || 0)}
            accent
          />
        </div>
      )}

      {/* Hall of Rekt Table */}
      {loading && !data ? (
        <SkeletonTable
          columns={8}
          rows={10}
          headers={["Rank", "Date", "Volume", "Events", "ETH Price", "ETH Change", "Top Protocol", "Biggest Liq"]}
          title="Hall of Rekt"
        />
      ) : (
        <div className="tui-card bg-card-bg border border-card-border rounded p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-3">
            Hall of Rekt — Top 10 Worst Liquidation Days
          </h2>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-text-tertiary border-b border-card-border">
                <th className="text-left pb-2 font-medium w-12">#</th>
                <th className="text-left pb-2 font-medium">Date</th>
                <th className="text-right pb-2 font-medium">Volume</th>
                <th className="text-right pb-2 font-medium">Events</th>
                <th className="text-right pb-2 font-medium">Profit</th>
                <th className="text-right pb-2 font-medium">ETH Price</th>
                <th className="text-right pb-2 font-medium">ETH Change</th>
                <th className="text-left pb-2 font-medium pl-3">Top Protocol</th>
                <th className="text-right pb-2 font-medium">Biggest Liq</th>
              </tr>
            </thead>
            <tbody>
              {topRekt.map((r) => (
                <tr
                  key={r.day}
                  className="border-b border-card-border/50 hover:bg-card-hover transition-colors"
                >
                  <td className="py-2.5">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-bold"
                      style={{
                        background: r.rektRank <= 3
                          ? "rgba(255, 68, 68, 0.15)"
                          : "rgba(255, 107, 53, 0.1)",
                        color: r.rektRank <= 3 ? "#FF4444" : "var(--accent)",
                      }}
                    >
                      {r.rektRank}
                    </span>
                  </td>
                  <td className="py-2.5 font-medium text-text-primary">
                    {formatFullDate(r.day)}
                  </td>
                  <td className="py-2.5 text-right font-medium" style={{ color: "#FF4444" }}>
                    {formatUSD(r.totalVolume)}
                  </td>
                  <td className="py-2.5 text-right text-text-secondary">
                    {formatNumber(r.eventCount)}
                  </td>
                  <td className="py-2.5 text-right" style={{ color: "var(--positive)" }}>
                    {formatUSD(r.totalGrossProfit)}
                  </td>
                  <td className="py-2.5 text-right text-text-secondary">
                    {r.ethPrice != null
                      ? `$${r.ethPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                      : "—"}
                  </td>
                  <td className="py-2.5 text-right">
                    {r.ethPriceChange != null ? (
                      <span
                        style={{
                          color: r.ethPriceChange < 0 ? "#FF4444" : "var(--positive)",
                        }}
                      >
                        {r.ethPriceChange > 0 ? "+" : ""}
                        {r.ethPriceChange.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-text-tertiary">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pl-3 text-text-secondary">
                    {protocolLabel(r.topProtocol)}
                  </td>
                  <td className="py-2.5 text-right text-text-secondary">
                    {formatUSD(r.biggestLiquidation)}
                  </td>
                </tr>
              ))}
              {topRekt.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-text-tertiary">
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
