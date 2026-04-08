"use client"

const PROTOCOLS = [
  { value: "all", label: "All" },
  { value: "aave_v3", label: "Aave V3" },
  { value: "spark", label: "SparkLend" },
  { value: "morpho_blue", label: "Morpho" },
  { value: "fluid", label: "Fluid" },
]

const PERIODS = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "365d", label: "1Y" },
  { value: "all", label: "All" },
]

export function ProtocolToggle({
  protocol,
  onProtocolChange,
}: {
  protocol: string
  onProtocolChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {PROTOCOLS.map((p) => (
        <button
          key={p.value}
          onClick={() => onProtocolChange(p.value)}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            protocol === p.value
              ? "bg-accent/15 text-accent border border-accent/25"
              : "text-text-secondary hover:text-text-primary border border-transparent"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

export function PeriodToggle({
  period,
  onPeriodChange,
}: {
  period: string
  onPeriodChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onPeriodChange(p.value)}
          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            period === p.value
              ? "bg-accent/15 text-accent border border-accent/25"
              : "text-text-secondary hover:text-text-primary border border-transparent"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
