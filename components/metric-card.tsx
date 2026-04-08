interface MetricCardProps {
  label: string
  value: string
  sub?: string
  accent?: boolean
}

export function MetricCard({ label, value, sub, accent }: MetricCardProps) {
  return (
    <div className="tui-card bg-card-bg border border-card-border rounded p-4">
      <div className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`text-xl font-semibold ${accent ? "text-accent" : "text-text-primary"}`}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-text-secondary mt-0.5">{sub}</div>
      )}
    </div>
  )
}
