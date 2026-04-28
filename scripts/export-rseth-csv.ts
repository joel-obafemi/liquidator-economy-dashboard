/**
 * Export every dataset shown on /research/rseth-incident as CSV files.
 *
 * Writes to ./data/rseth-incident/ — one file per dataset. Safe to run
 * repeatedly; existing files are overwritten with fresh values.
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/export-rseth-csv.ts
 */
// Use Neon's HTTP-over-fetch mode — avoids the WebSocket pooler entirely so
// this script keeps working even if the WS endpoint is unreachable.
import { neon } from "@neondatabase/serverless"
import * as fs from "fs"
import * as path from "path"

const envPath = path.resolve(__dirname, "../.env.local")
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

const dbUrl = process.env.DATABASE_URL!.replace(/&?channel_binding=[^&]*/g, "")
const OUT_DIR = path.resolve(__dirname, "../data/rseth-incident")
fs.mkdirSync(OUT_DIR, { recursive: true })

// Same window as the API route — kept in sync explicitly so any analyst can
// trace the values without running the live API.
const EVENT_START = Math.floor(new Date("2026-04-18T00:00:00Z").getTime() / 1000)
const EVENT_END = Math.floor(new Date("2026-04-25T23:59:59Z").getTime() / 1000)
const RSETH_FILTER = `(collateral_symbol ILIKE '%rseth%' OR debt_symbol ILIKE '%rseth%')`

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

async function main() {
  console.log(`Exporting rsETH-incident CSVs to ${OUT_DIR}\n`)
  const sql = neon(dbUrl)
  // Tiny adapter so we keep the existing call sites — passes the SQL string
  // and parameters into Neon's HTTP-mode unsafe interpolation API.
  const pool = {
    query: async (text: string, params: any[] = []) => {
      const rows = await (sql as any).query(text, params)
      return { rows }
    },
    end: async () => {},
  }

  // ─── 1. Headline KPIs ─────────────────────────────────────────────────
  const eventWindow = (
    await pool.query(
      `SELECT
         COUNT(*)::int AS events,
         COUNT(DISTINCT liquidator)::int AS liquidators,
         COUNT(DISTINCT borrower)::int AS borrowers,
         COALESCE(SUM(collateral_amount_usd), 0) AS volume,
         COALESCE(SUM(gross_profit_usd), 0) AS profit,
         COALESCE(SUM(bad_debt_usd), 0) AS bad_debt,
         COUNT(*) FILTER (WHERE bad_debt_usd > 0)::int AS bad_debt_events
       FROM liquidation_events
       WHERE ${RSETH_FILTER}
         AND block_timestamp BETWEEN $1 AND $2`,
      [EVENT_START, EVENT_END]
    )
  ).rows[0]

  const baseline = (
    await pool.query(
      `SELECT
         COUNT(*)::int AS events,
         COUNT(DISTINCT liquidator)::int AS liquidators,
         COUNT(DISTINCT borrower)::int AS borrowers,
         COALESCE(SUM(collateral_amount_usd), 0) AS volume,
         COALESCE(SUM(gross_profit_usd), 0) AS profit,
         COALESCE(SUM(bad_debt_usd), 0) AS bad_debt,
         MIN(block_timestamp) AS first_ts,
         MAX(block_timestamp) AS last_ts
       FROM liquidation_events
       WHERE ${RSETH_FILTER}
         AND block_timestamp < $1`,
      [EVENT_START]
    )
  ).rows[0]

  const allDuringWindow = (
    await pool.query(
      `SELECT protocol, COUNT(*)::int AS events
       FROM liquidation_events
       WHERE block_timestamp BETWEEN $1 AND $2
       GROUP BY protocol ORDER BY events DESC`,
      [EVENT_START, EVENT_END]
    )
  ).rows
  const systemwideTotal = allDuringWindow.reduce(
    (s: number, r: any) => s + Number(r.events),
    0
  )
  const systemwideBreakdown = allDuringWindow
    .map((r: any) => `${r.protocol}=${r.events}`)
    .join(" | ")

  const daysSinceLastLiq =
    baseline.last_ts != null
      ? Math.floor((EVENT_START - Number(baseline.last_ts)) / 86400)
      : null
  const baselineSpanDays =
    baseline.first_ts && baseline.last_ts
      ? Math.max(
          1,
          Math.floor(
            (Number(baseline.last_ts) - Number(baseline.first_ts)) / 86400
          )
        )
      : 1
  const eventsPerWeekHistorical =
    baseline.events > 0 ? (Number(baseline.events) / baselineSpanDays) * 7 : 0

  writeCsv(
    "01_headline_kpis.csv",
    ["metric", "value", "context"],
    [
      [
        "event_window_liquidations",
        eventWindow.events,
        `${new Date(EVENT_START * 1000).toISOString().slice(0, 10)} → ${new Date(EVENT_END * 1000).toISOString().slice(0, 10)}`,
      ],
      [
        "event_window_volume_usd",
        Number(eventWindow.volume).toFixed(2),
        "Sum of collateral_amount_usd",
      ],
      [
        "event_window_profit_usd",
        Number(eventWindow.profit).toFixed(2),
        "Sum of gross_profit_usd",
      ],
      [
        "event_window_bad_debt_usd",
        Number(eventWindow.bad_debt).toFixed(2),
        `${eventWindow.bad_debt_events} events with bad debt`,
      ],
      [
        "event_window_unique_liquidators",
        eventWindow.liquidators,
        "Distinct addresses",
      ],
      [
        "event_window_unique_borrowers",
        eventWindow.borrowers,
        "Distinct addresses",
      ],
      [
        "days_since_last_rseth_liquidation",
        daysSinceLastLiq ?? "",
        baseline.last_ts
          ? `Last: ${isoFromTs(Number(baseline.last_ts)).slice(0, 10)}`
          : "",
      ],
      [
        "historical_baseline_total_liquidations",
        baseline.events,
        `Since ${baseline.first_ts ? isoFromTs(Number(baseline.first_ts)).slice(0, 10) : ""} · ${eventsPerWeekHistorical.toFixed(2)} events/week avg`,
      ],
      [
        "historical_baseline_unique_liquidators",
        baseline.liquidators,
        "All-time distinct rsETH liquidators",
      ],
      [
        "historical_baseline_unique_borrowers",
        baseline.borrowers,
        "All-time distinct borrowers",
      ],
      [
        "historical_baseline_volume_usd",
        Number(baseline.volume).toFixed(2),
        "All-time rsETH liquidation collateral seized",
      ],
      [
        "historical_baseline_profit_usd",
        Number(baseline.profit).toFixed(2),
        "All-time rsETH liquidation gross profit",
      ],
      [
        "historical_baseline_bad_debt_usd",
        Number(baseline.bad_debt).toFixed(2),
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
  const topBots = (
    await pool.query(
      `WITH top_lq AS (
         SELECT liquidator,
                COUNT(*)::int AS total_events,
                COUNT(DISTINCT collateral_symbol)::int AS distinct_collateral,
                COALESCE(SUM(gross_profit_usd), 0) AS total_profit
         FROM liquidation_events
         WHERE protocol IN ('aave_v3','morpho_blue')
         GROUP BY liquidator
         ORDER BY total_events DESC
         LIMIT 50
       ),
       rseth_window AS (
         SELECT DISTINCT liquidator
         FROM liquidation_events
         WHERE ${RSETH_FILTER} AND block_timestamp BETWEEN $1 AND $2
       ),
       rseth_ever AS (
         SELECT DISTINCT liquidator
         FROM liquidation_events WHERE ${RSETH_FILTER}
       )
       SELECT t.liquidator, t.total_events, t.distinct_collateral, t.total_profit,
              (rw.liquidator IS NOT NULL) AS active_in_event_window,
              (re.liquidator IS NOT NULL) AS ever_touched_rseth
       FROM top_lq t
       LEFT JOIN rseth_window rw ON rw.liquidator = t.liquidator
       LEFT JOIN rseth_ever re ON re.liquidator = t.liquidator
       ORDER BY t.total_events DESC`,
      [EVENT_START, EVENT_END]
    )
  ).rows

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
    topBots.map((r: any, i: number) => [
      i + 1,
      r.liquidator,
      r.total_events,
      r.distinct_collateral,
      Number(r.total_profit).toFixed(2),
      r.active_in_event_window,
      r.ever_touched_rseth,
    ])
  )

  // ─── 3. Historical rsETH liquidations by pair ────────────────────────
  const byPair = (
    await pool.query(
      `SELECT protocol, collateral_symbol, debt_symbol,
              COUNT(*)::int AS events,
              COUNT(DISTINCT liquidator)::int AS bots,
              COUNT(DISTINCT borrower)::int AS borrowers,
              COALESCE(SUM(collateral_amount_usd), 0) AS volume,
              COALESCE(SUM(gross_profit_usd), 0) AS profit,
              COALESCE(SUM(bad_debt_usd), 0) AS bad_debt,
              MAX(block_timestamp) AS last_ts
       FROM liquidation_events
       WHERE ${RSETH_FILTER}
       GROUP BY protocol, collateral_symbol, debt_symbol
       ORDER BY events DESC`
    )
  ).rows

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
    byPair.map((r: any) => [
      r.protocol,
      r.collateral_symbol,
      r.debt_symbol,
      r.events,
      r.bots,
      r.borrowers,
      Number(r.volume).toFixed(2),
      Number(r.profit).toFixed(2),
      Number(r.bad_debt).toFixed(2),
      isoFromTs(Number(r.last_ts)),
    ])
  )

  // ─── 4. Daily timeline (60 days centered on event window) ────────────
  const tlStart = EVENT_START - 30 * 86400
  const tlEnd = EVENT_END + 30 * 86400
  const timeline = (
    await pool.query(
      `SELECT
         TO_CHAR(TO_TIMESTAMP(block_timestamp), 'YYYY-MM-DD') AS day,
         COUNT(*)::int AS events,
         COALESCE(SUM(collateral_amount_usd), 0) AS volume,
         COALESCE(SUM(gross_profit_usd), 0) AS profit,
         COALESCE(SUM(bad_debt_usd), 0) AS bad_debt
       FROM liquidation_events
       WHERE ${RSETH_FILTER}
         AND block_timestamp BETWEEN $1 AND $2
       GROUP BY day
       ORDER BY day ASC`,
      [tlStart, tlEnd]
    )
  ).rows

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
    timeline.map((r: any) => [
      r.day,
      r.events,
      r.day >= "2026-04-18" && r.day <= "2026-04-25",
      Number(r.volume).toFixed(2),
      Number(r.profit).toFixed(2),
      Number(r.bad_debt).toFixed(2),
    ])
  )

  // ─── 5. System-wide liquidation activity during the event window ─────
  writeCsv(
    "05_system_wide_event_window_breakdown.csv",
    ["protocol", "events"],
    allDuringWindow.map((r: any) => [r.protocol, r.events])
  )

  // ─── 6. Hourly bad-debt formation curve (Aave V3 rsETH-collateral) ───
  // Only emits if the snapshot table has data; otherwise writes a header
  // row and a placeholder line so the file always exists.
  let hourlyRows: any[] = []
  try {
    const hourly = (
      await pool.query(
        `SELECT block_timestamp::bigint AS ts, block_number::bigint AS block,
                total_collateral_usd, total_debt_usd, bad_debt_usd,
                underwater_users, active_users
         FROM rseth_hourly_snapshots
         ORDER BY block_timestamp ASC`
      )
    ).rows
    hourlyRows = hourly
  } catch (e: any) {
    console.warn("  rseth_hourly_snapshots table empty or missing — placeholder file written")
  }
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
    hourlyRows.map((r: any) => {
      const ts = Number(r.ts)
      return [
        isoFromTs(ts),
        ts,
        Number(r.block),
        Number(r.total_collateral_usd).toFixed(2),
        Number(r.total_debt_usd).toFixed(2),
        Number(r.bad_debt_usd).toFixed(2),
        Number(r.underwater_users),
        Number(r.active_users),
        ts >= EVENT_START && ts <= EVENT_END,
      ]
    })
  )

  // ─── README ──────────────────────────────────────────────────────────
  fs.writeFileSync(
    path.join(OUT_DIR, "README.md"),
    `# rsETH Liquidation Vacuum — CSV exports

Every file here is a snapshot of the data shown on \`/research/rseth-incident\` in
the Liquidator Economy Terminal dashboard. Regenerate with:

\`\`\`
npx tsx -r tsconfig-paths/register scripts/export-rseth-csv.ts
\`\`\`

## Files

| File | Source | Description |
|---|---|---|
| \`01_headline_kpis.csv\` | DB · liquidation_events | Event window vs. all-time baseline metrics |
| \`02_top_50_bots_event_window_participation.csv\` | DB · liquidation_events | Top-50 Aave V3 + Morpho liquidators with rsETH-window flags |
| \`03_historical_rseth_pairs.csv\` | DB · liquidation_events | Per-protocol-pair history of rsETH liquidations |
| \`04_daily_timeline_pre_event_through_post_event.csv\` | DB · liquidation_events | Daily counts ±30 days around the event window |
| \`05_system_wide_event_window_breakdown.csv\` | DB · liquidation_events | Number of liquidations per protocol during the event window (any asset) |
| \`06_hourly_bad_debt_formation_aave_v3.csv\` | DB · rseth_hourly_snapshots | Hourly aggregates of rsETH-collateral users on Aave V3 (bad debt formation) |

## Definitions

- **Event window**: 2026-04-18 00:00 UTC → 2026-04-25 23:59 UTC (the 7 days following the rsETH depeg)
- **Bad debt** (USD): \`max(0, total_debt_usd − total_collateral_usd)\` summed over underwater positions
- **Active users**: addresses with non-zero collateral or debt on Aave V3 at the snapshot block
- **Underwater users**: subset of active users with debt > collateral
- **Aave V3 base unit**: divided by 1e8 to get USD

## How the hourly curve is computed

For every hour in the analysis window (2026-04-17 12:00 → 2026-04-26 00:00 UTC),
the script \`scripts/snapshot-rseth-aave.ts\`:
1. Resolves the corresponding archive block via a single binary search anchor
   plus 300-blocks/hour estimation (Ethereum block time).
2. Calls \`Pool.getUserAccountData(user)\` on the Aave V3 mainnet Pool
   (\`0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2\`) at that block for every
   address that has ever held aRsETH (\`0x2d62109243b87c4ba3ee7ba1d91b0dd0a074d7b1\`).
3. Aggregates totalCollateralBase, totalDebtBase, and the residual bad debt.

Calls are issued via Alchemy archive RPC, batched 10 per request with a
1-second inter-batch delay to stay under the free-tier 330 CU/sec cap.
`
  )

  console.log(`\nDone. Files in ${OUT_DIR}`)
  await pool.end()
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e)
  process.exit(1)
})
