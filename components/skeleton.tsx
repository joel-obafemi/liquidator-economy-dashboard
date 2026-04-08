/**
 * Reusable skeleton loaders for the dashboard.
 * All skeletons use the `animate-pulse` utility and `--card-border` as the bone color.
 */

interface SkeletonProps {
  className?: string
  width?: string | number
  height?: string | number
}

/** Base bar — use for any single placeholder */
export function SkeletonBar({ className = "", width, height = "0.75rem" }: SkeletonProps) {
  return (
    <div
      className={`rounded bg-[var(--card-border)] ${className}`}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  )
}

/** KPI metric card skeleton — matches <MetricCard /> dimensions */
export function SkeletonKpi() {
  return (
    <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse">
      <SkeletonBar width="60%" height={10} className="mb-2" />
      <SkeletonBar width="75%" height={22} className="mb-1.5" />
      <SkeletonBar width="50%" height={9} />
    </div>
  )
}

/** Grid of KPI cards */
export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonKpi key={i} />
      ))}
    </div>
  )
}

/** A chart placeholder with ghost bars simulating data */
export function SkeletonChart({ height = 280, title = true }: { height?: number; title?: boolean }) {
  // Pseudo-random heights so the skeleton looks organic but deterministic
  const heights = [65, 45, 85, 30, 55, 70, 40, 90, 25, 60, 75, 50, 35, 80, 48, 68, 33, 77, 52, 42]
  return (
    <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse">
      {title && <SkeletonBar width={140} height={10} className="mb-4" />}
      <div className="flex items-end justify-between gap-1" style={{ height }}>
        {heights.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-[var(--card-border)]"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  )
}

/** Donut/pie chart placeholder */
export function SkeletonDonut({ height = 280, title = true }: { height?: number; title?: boolean }) {
  return (
    <div className="tui-card bg-card-bg border border-card-border rounded p-4 animate-pulse">
      {title && <SkeletonBar width={120} height={10} className="mb-4" />}
      <div className="flex items-center justify-center" style={{ height }}>
        <div
          className="rounded-full border-[24px] border-[var(--card-border)]"
          style={{ width: height * 0.7, height: height * 0.7 }}
        />
      </div>
    </div>
  )
}

/** Table row skeleton */
export function SkeletonTableRow({ columns = 6 }: { columns?: number }) {
  return (
    <tr className="border-b border-card-border/40">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <SkeletonBar
            width={i === 0 ? "60%" : i === 1 ? "80%" : `${50 + (i * 13) % 40}%`}
            height={10}
          />
        </td>
      ))}
    </tr>
  )
}

/** Full table skeleton with header */
export function SkeletonTable({
  columns = 6,
  rows = 10,
  headers,
  title,
}: {
  columns?: number
  rows?: number
  headers?: string[]
  title?: string
}) {
  const colCount = headers?.length || columns
  return (
    <div className="tui-card bg-card-bg border border-card-border rounded overflow-hidden animate-pulse">
      {title && (
        <div className="px-3 py-3 border-b border-card-border">
          <SkeletonBar width={160} height={11} />
        </div>
      )}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-card-border bg-card-bg">
            {(headers || Array.from({ length: colCount }, (_, i) => `col${i}`)).map((h, i) => (
              <th key={i} className="px-3 py-2.5 text-left">
                <SkeletonBar width={headers ? `${h.length * 7}px` : 60} height={9} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonTableRow key={i} columns={colCount} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Section header skeleton */
export function SkeletonSection({ children }: { children?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <SkeletonBar width={180} height={14} className="animate-pulse" />
      {children}
    </div>
  )
}
