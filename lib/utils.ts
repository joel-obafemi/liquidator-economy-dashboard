export function formatUSD(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value > 0) return `$${value.toFixed(4)}`
  return "$0.00"
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function etherscanTx(hash: string): string {
  return `https://etherscan.io/tx/${hash}`
}

export function etherscanAddress(address: string): string {
  return `https://etherscan.io/address/${address}`
}

export function protocolLabel(protocol: string): string {
  if (protocol === "aave_v3") return "Aave V3"
  if (protocol === "spark") return "SparkLend"
  if (protocol === "morpho_blue") return "Morpho Blue"
  if (protocol === "fluid") return "Fluid"
  return protocol
}

// Datum Labs brand palette — matches @datumlabs/dashboard-kit globals.css
// Each protocol gets one slot from the 8-color chart palette.
export const CHART_COLORS = {
  aave_v3: "#B44AFF",      // chart-4 — purple
  spark: "#F59E0B",        // chart-3 — amber
  morpho_blue: "#5B7FFF",  // chart-1 — blue
  fluid: "#00D4FF",        // chart-5 — cyan
  accent: "#FF6B35",       // Datum orange (brand accent)
  positive: "#10B981",     // success green
  negative: "#FF4444",     // danger red
}

export function timeFilterToTimestamp(period: string): number {
  const now = Math.floor(Date.now() / 1000)
  switch (period) {
    case "7d": return now - 7 * 86400
    case "30d": return now - 30 * 86400
    case "90d": return now - 90 * 86400
    case "365d": return now - 365 * 86400
    default: return 0
  }
}
