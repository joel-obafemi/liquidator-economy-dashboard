/**
 * Same CSV exports as scripts/export-rseth-csv.ts but sources data from the
 * production API instead of querying Neon directly. Useful when the local
 * machine can't reach the Neon endpoint (e.g. transient network issues) but
 * the deployed Vercel app can.
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/export-rseth-csv-from-api.ts \
 *     [--url=https://your-prod-domain]
 *
 * Defaults to https://liquidator-economy-dashboard.vercel.app
 */
import * as fs from "fs"
import * as path from "path"

const OUT_DIR = path.resolve(__dirname, "../data/rseth-incident")
fs.mkdirSync(OUT_DIR, { recursive: true })

// Allow override via --url=... or PROD_URL env var
const urlArg = process.argv.find((a) => a.startsWith("--url="))
const PROD_URL =
  (urlArg ? urlArg.slice("--url=".length) : process.env.PROD_URL) ||
  "https://liquidator-economy-dashboard.vercel.app"

const EVENT_START = Math.floor(new Date("2026-04-18T00:00:00Z").getTime() / 1000)
const EVENT_END = Math.floor(new Date("2026-04-25T23:59:59Z").getTime() / 1000)

function csvEscape(v: any): string {
  if (v === null || v === undefined) return ""
  const s = typeof v === "string" ? v : String(v)
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function writeCsv(name: string, headers: string[], rows: any[][]) {
  const lines = [headers.map(csvEscape).join(",")]
  for (const r of rows) lines.push(r.map(csvEscape).join(","))
  const file = path.join(OUT_DIR, name)
  fs.writeFileSync(file, lines.join("\n") + "\n")
  console.log(`  ${name}  ·  ${rows.length} rows`)
}

function isoFromTs(ts: number | null | undefined): string {
  if (!ts) return ""
  return new Date(Number(ts) * 1000).toISOString()
}

interface ApiResponse {
  eventWindow: any
  baseline: any
  timeline: any[]
  byPair: any[]
  liquidatorActivity: any[]
  topLiquidatorsOverall: any[]
  scannerState: any[]
  allDuringWindow: any[]
  hourlySnapshots: any[]
}

async function main() {
  console.log(`Fetching from ${PROD_URL}/api/research/rseth-incident\n`)

  const r = await fetch(`${PROD_URL}/api/research/rseth-incident`, {
    headers: { "User-Agent": "rseth-csv-exporter" },
    signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) {
    throw new Error(`API returned HTTP ${r.status}`)
  }
  const data = (await r.json()) as ApiResponse

  console.log(`Exporting CSVs to ${OUT_DIR}\n`)

  // ─── 1. Headline KPIs ─────────────────────────────────────────────────
  const ew = data.eventWindow
  const bl = data.baseline
  const systemwideTotal = data.allDuringWindow.reduce(
    (s, r) => s + Number(r.events),
    0
  )
  const systemwideBreakdown = data.allDuringWindow
    .map((r) => `${r.protocol}=${r.events}`)
    .join(" | ")

  const daysSinceLastLiq =
    bl.lastTimestamp != null
      ? Math.floor((EVENT_START - Number(bl.lastTimestamp)) / 86400)
      : null
  const baselineSpanDays =
    bl.firstTimestamp && bl.lastTimestamp
      ? Math.max(
          1,
          Math.floor(
            (Number(bl.lastTimestamp) - Number(bl.firstTimestamp)) / 86400
          )
        )
      : 1
  const eventsPerWeekHistorical =
    bl.events > 0 ? (Number(bl.events) / baselineSpanDays) * 7 : 0

  writeCsv(
    "01_headline_kpis.csv",
    ["metric", "value", "context"],
    [
      [
        "event_window_liquidations",
        ew.events,
        `${new Date(EVENT_START * 1000).toISOString().slice(0, 10)} → ${new Date(EVENT_END * 1000).toISOString().slice(0, 10)}`,
      ],
      [
        "event_window_volume_usd",
        Number(ew.volume).toFixed(2),
        "Sum of collateral_amount_usd",
      ],
      [
        "event_window_profit_usd",
        Number(ew.profit).toFixed(2),
        "Sum of gross_profit_usd",
      ],
      [
        "event_window_bad_debt_usd",
        Number(ew.badDebt).toFixed(2),
        `${ew.badDebtEvents} events with bad debt`,
      ],
      ["event_window_unique_liquidators", ew.liquidators, "Distinct addresses"],
      ["event_window_unique_borrowers", ew.borrowers, "Distinct addresses"],
      [
        "days_since_last_rseth_liquidation",
        daysSinceLastLiq ?? "",
        bl.lastTimestamp
          ? `Last: ${isoFromTs(Number(bl.lastTimestamp)).slice(0, 10)}`
          : "",
      ],
      [
        "historical_baseline_total_liquidations",
        bl.events,
        `Since ${bl.firstTimestamp ? isoFromTs(Number(bl.firstTimestamp)).slice(0, 10) : ""} · ${eventsPerWeekHistorical.toFixed(2)} events/week avg`,
      ],
      [
        "historical_baseline_unique_liquidators",
        bl.liquidators,
        "All-time distinct rsETH liquidators",
      ],
      [
        "historical_baseline_unique_borrowers",
        bl.borrowers,
        "All-time distinct borrowers",
      ],
      [
        "historical_baseline_volume_usd",
        Number(bl.volume).toFixed(2),
        "All-time rsETH liquidation collateral seized",
      ],
      [
        "historical_baseline_profit_usd",
        Number(bl.profit).toFixed(2),
        "All-time rsETH liquidation gross profit",
      ],
      [
        "historical_baseline_bad_debt_usd",
        Number(bl.badDebt).toFixed(2),
        "All-time rsETH bad debt",
      ],
      [
        "system_wide_liquidations_in_event_window",
        systemwideTotal,
        systemwideBreakdown,
      ],
    ]
  )

  // ─── 2. Top 50 historical liquidators × event window activity ─────────
  writeCsv(
    "02_top_50_bots_event_window_participation.csv",
    [
      "rank",
      "liquidator_address",
      "total_liquidations_aave_morpho",
      "distinct_collateral_assets",
      "total_gross_profit_usd",
      "active_in_event_window",
      "ever_touched_rseth",
    ],
    data.topLiquidatorsOverall.map((r, i) => [
      i + 1,
      r.liquidator,
      r.totalEvents,
      r.distinctCollateral,
      Number(r.totalProfit).toFixed(2),
      r.activeInEventWindow,
      r.everTouchedRseth,
    ])
  )

  // ─── 3. Historical rsETH liquidations by pair ────────────────────────
  writeCsv(
    "03_historical_rseth_pairs.csv",
    [
      "protocol",
      "collateral_symbol",
      "debt_symbol",
      "events",
      "unique_bots",
      "unique_borrowers",
      "volume_usd",
      "profit_usd",
      "bad_debt_usd",
      "last_seen_iso",
    ],
    data.byPair.map((r) => [
      r.protocol,
      r.collateralSymbol,
      r.debtSymbol,
      r.events,
      r.liquidators,
      r.borrowers,
      Number(r.volume).toFixed(2),
      Number(r.profit).toFixed(2),
      Number(r.badDebt).toFixed(2),
      isoFromTs(r.lastTimestamp),
    ])
  )

  // ─── 4. Daily timeline ────────────────────────────────────────────────
  writeCsv(
    "04_daily_timeline_pre_event_through_post_event.csv",
    [
      "day",
      "events",
      "in_event_window",
      "volume_usd",
      "profit_usd",
      "bad_debt_usd",
    ],
    data.timeline.map((r) => [
      r.day,
      r.events,
      r.day >= "2026-04-18" && r.day <= "2026-04-25",
      Number(r.volume).toFixed(2),
      Number(r.profit).toFixed(2),
      Number(r.badDebt).toFixed(2),
    ])
  )

  // ─── 5. System-wide breakdown during window ──────────────────────────
  writeCsv(
    "05_system_wide_event_window_breakdown.csv",
    ["protocol", "events"],
    data.allDuringWindow.map((r) => [r.protocol, r.events])
  )

  // ─── 6. Hourly bad debt formation (Aave V3 rsETH-collateral) ─────────
  writeCsv(
    "06_hourly_bad_debt_formation_aave_v3.csv",
    [
      "iso_timestamp",
      "unix_timestamp",
      "block_number",
      "total_collateral_usd",
      "total_debt_usd",
      "bad_debt_usd",
      "underwater_users",
      "active_users",
      "in_event_window",
    ],
    (data.hourlySnapshots || []).map((r) => {
      const ts = Number(r.timestamp)
      return [
        isoFromTs(ts),
        ts,
        Number(r.blockNumber),
        Number(r.totalCollateralUsd).toFixed(2),
        Number(r.totalDebtUsd).toFixed(2),
        Number(r.badDebtUsd).toFixed(2),
        Number(r.underwaterUsers),
        Number(r.activeUsers),
        ts >= EVENT_START && ts <= EVENT_END,
      ]
    })
  )

  // ─── README ──────────────────────────────────────────────────────────
  fs.writeFileSync(
    path.join(OUT_DIR, "README.md"),
    `# rsETH Liquidation Vacuum — CSV exports

Snapshots of the data shown on \`/research/rseth-incident\` in the
Liquidator Economy Terminal dashboard. Sourced from the production API
at ${PROD_URL}.

## Files

| File | Description |
|---|---|
| \`01_headline_kpis.csv\` | Event window vs. all-time baseline metrics |
| \`02_top_50_bots_event_window_participation.csv\` | Top-50 Aave V3 + Morpho liquidators with rsETH-window flags |
| \`03_historical_rseth_pairs.csv\` | Per-protocol-pair history of rsETH liquidations |
| \`04_daily_timeline_pre_event_through_post_event.csv\` | Daily counts ±30 days around the event window |
| \`05_system_wide_event_window_breakdown.csv\` | Number of liquidations per protocol during the event window (any asset) |
| \`06_hourly_bad_debt_formation_aave_v3.csv\` | Hourly aggregates of rsETH-collateral users on Aave V3 (bad debt formation) — empty until snapshot scan completes |

## Definitions

- **Event window**: 2026-04-18 00:00 UTC → 2026-04-25 23:59 UTC (the 7 days following the rsETH depeg)
- **Bad debt** (USD): \`max(0, total_debt_usd − total_collateral_usd)\` summed over underwater positions
- **Active users**: addresses with non-zero collateral or debt on Aave V3 at the snapshot block
- **Underwater users**: subset of active users with debt > collateral
- **Aave V3 base unit**: divided by 1e8 to get USD

## How the hourly curve is computed

For every hour in the analysis window (2026-04-17 12:00 → 2026-04-26 00:00 UTC),
\`scripts/snapshot-rseth-aave.ts\`:
1. Resolves the corresponding archive block via a binary search anchor + 300-blocks/hour estimate.
2. Calls \`Pool.getUserAccountData(user)\` on Aave V3 mainnet (\`0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2\`)
   at that block for every address that has ever held aRsETH (\`0x2d62109243b87c4ba3ee7ba1d91b0dd0a074d7b1\`).
3. Aggregates totalCollateralBase, totalDebtBase, and the residual bad debt.

Calls are issued via Alchemy archive RPC, batched 10 per request with a
1-second inter-batch delay to stay under the free-tier 330 CU/sec cap.
`
  )

  console.log(`\nDone. Files in ${OUT_DIR}`)
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e)
  process.exit(1)
})
