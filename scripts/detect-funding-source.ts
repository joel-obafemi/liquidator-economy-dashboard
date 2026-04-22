/**
 * Detect non-flash funding methods: DEX swaps vs aggregator vs unknown.
 *
 * For each liquidation tx that is NOT a flash loan, fetch its receipt and
 * check for:
 *   1. DEX swap events (Uniswap V2/V3, Curve, Balancer, Sushi)
 *   2. Aggregator router addresses (1inch, 0x, Cowswap, Paraswap)
 *   3. Neither ⇒ "unknown" (likely pre-funded hot wallet, but we don't prove that here)
 *
 * Writes results to a funding_category column on liquidation_events.
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/detect-funding-source.ts schema
 *   npx tsx -r tsconfig-paths/register scripts/detect-funding-source.ts scan
 *   npx tsx -r tsconfig-paths/register scripts/detect-funding-source.ts update
 */
import { Pool } from "@neondatabase/serverless"
import * as fs from "fs"
import * as path from "path"

// Load .env.local
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
const RESULT_FILE = path.resolve(__dirname, "../.funding-source-results.json")

// DEX swap event topics (lowercase hex, no 0x — for substring matching)
const SWAP_TOPICS = {
  uniswap_v2: "d78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",
  uniswap_v3: "c42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  curve_v1: "8b3e96f2b889fa771c53c981b40daf005f63f637f1869f707052d15a3dd97140",
  balancer_v2_swap: "2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b",
}

// Aggregator router addresses (lowercase, no 0x)
const AGGREGATORS: Record<string, string> = {
  oneinch_v5: "1111111254eeb25477b68fb85ed929f73a960582",
  oneinch_v4: "1111111254fb6c44bac0bed2854e76f90643097d",
  zerox: "def1c0ded9bec7f1a1670819833240f027b25eff",
  cowswap: "9008d19f58aabd9ed0d60971565aa8510560ab41",
  paraswap: "def171fe48cf0115b1d80b88dc8eab59176fee57",
}

const RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
]
let ri = 0

/** Categorize a receipt by funding source. */
function categorize(text: string): { category: string; detail: string | null } {
  // Check for swap events first
  const foundSwaps: string[] = []
  for (const [name, topic] of Object.entries(SWAP_TOPICS)) {
    if (text.includes(topic)) foundSwaps.push(name)
  }
  if (foundSwaps.length > 0) {
    return { category: "dex_swap", detail: foundSwaps.join(",") }
  }

  // Check for aggregator router addresses
  for (const [name, addr] of Object.entries(AGGREGATORS)) {
    if (text.includes(addr)) {
      return { category: "aggregator", detail: name }
    }
  }

  return { category: "unknown", detail: null }
}

async function fetchReceipt(tx: string): Promise<string | null> {
  for (let a = 0; a < 3; a++) {
    const url = RPCS[ri++ % RPCS.length]
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getTransactionReceipt",
          params: [tx],
          id: 1,
        }),
        signal: AbortSignal.timeout(10000),
      })
      const text = await r.text()
      if (text.startsWith("Too") || text.startsWith("<")) {
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      return text
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return null
}

async function schema() {
  console.log("=== Schema migration ===")
  const pool = new Pool({ connectionString: dbUrl })
  await pool.query(`
    ALTER TABLE liquidation_events
    ADD COLUMN IF NOT EXISTS funding_category TEXT,
    ADD COLUMN IF NOT EXISTS funding_detail TEXT
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_liq_funding ON liquidation_events(funding_category) WHERE funding_category IS NOT NULL`
  )
  console.log("  Added funding_category and funding_detail columns + index")

  // Backfill: all flash loan txs get category='flash_loan'
  const r = await pool.query(
    `UPDATE liquidation_events SET funding_category = 'flash_loan', funding_detail = flash_loan_source WHERE is_flash_loan = true AND funding_category IS NULL`
  )
  console.log(`  Backfilled ${r.rowCount} flash loan events`)
  await pool.end()
}

async function scan() {
  console.log("=== Scanning non-flash txs for DEX / aggregator funding ===\n")
  const pool = new Pool({ connectionString: dbUrl })

  // Only scan txs that don't already have a funding_category set
  const r = await pool.query(
    `SELECT DISTINCT tx_hash FROM liquidation_events
     WHERE (is_flash_loan = false OR is_flash_loan IS NULL)
       AND funding_category IS NULL
     ORDER BY tx_hash`
  )
  const hashes: string[] = r.rows.map((row: any) => row.tx_hash)
  await pool.end()
  console.log(`  ${hashes.length} non-flash txs to categorize`)

  let categoryMap: Record<string, { category: string; detail: string | null }> = {}
  let startIdx = 0
  if (fs.existsSync(RESULT_FILE)) {
    const prev = JSON.parse(fs.readFileSync(RESULT_FILE, "utf8"))
    categoryMap = prev.categoryMap || {}
    startIdx = prev.lastIndex || 0
    console.log(`  Resuming at ${startIdx}, ${Object.keys(categoryMap).length} categorized so far`)
  }

  let checked = 0
  let errors = 0
  const counts: Record<string, number> = {}

  for (let i = startIdx; i < hashes.length; i++) {
    const tx = hashes[i]
    const text = await fetchReceipt(tx)
    if (text === null) {
      errors++
    } else {
      const result = categorize(text)
      categoryMap[tx] = result
      counts[result.category] = (counts[result.category] || 0) + 1
      checked++
    }
    await new Promise((r) => setTimeout(r, 650))

    if ((i + 1) % 100 === 0) {
      fs.writeFileSync(
        RESULT_FILE,
        JSON.stringify({ categoryMap, lastIndex: i + 1, checked, errors })
      )
      const summary = Object.entries(counts)
        .map(([c, n]) => `${c}:${n}`)
        .join(" ")
      console.log(`  [${i + 1}/${hashes.length}] ${summary} errors:${errors}`)
    }
  }

  fs.writeFileSync(
    RESULT_FILE,
    JSON.stringify({ categoryMap, lastIndex: hashes.length, checked, errors })
  )

  console.log(`\n  Done. ${Object.keys(categoryMap).length} categorized:`)
  const tally: Record<string, number> = {}
  for (const v of Object.values(categoryMap)) tally[v.category] = (tally[v.category] || 0) + 1
  for (const [c, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c}: ${n}`)
  }
}

async function update() {
  console.log("=== Apply funding category results to DB ===\n")
  if (!fs.existsSync(RESULT_FILE)) {
    console.error("No results file found")
    process.exit(1)
  }
  const { categoryMap } = JSON.parse(fs.readFileSync(RESULT_FILE, "utf8"))
  const entries = Object.entries(categoryMap) as [string, { category: string; detail: string | null }][]
  console.log(`  ${entries.length} txs to categorize`)

  const pool = new Pool({ connectionString: dbUrl })

  let updated = 0
  for (const [tx, result] of entries) {
    const r = await pool.query(
      `UPDATE liquidation_events
       SET funding_category = $1, funding_detail = $2
       WHERE tx_hash = $3 AND funding_category IS NULL`,
      [result.category, result.detail, tx]
    )
    updated += r.rowCount || 0
  }
  console.log(`  Updated ${updated} events`)

  // Final stats
  const breakdown = await pool.query(`
    SELECT funding_category as cat,
           COUNT(*)::int as events,
           COUNT(DISTINCT liquidator)::int as liqs,
           COALESCE(SUM(collateral_amount_usd), 0) as vol,
           COALESCE(SUM(gross_profit_usd), 0) as profit
    FROM liquidation_events
    WHERE funding_category IS NOT NULL
    GROUP BY funding_category
    ORDER BY events DESC
  `)

  const total = (
    await pool.query(`SELECT COUNT(*)::int as n FROM liquidation_events`)
  ).rows[0].n

  console.log(`\n=== RESULTS ===`)
  console.log(`Total events: ${total}\n`)
  console.log(`By funding category:`)
  for (const r of breakdown.rows) {
    const pct = ((Number(r.events) / Number(total)) * 100).toFixed(1)
    console.log(
      `  ${r.cat}: ${r.events} (${pct}%), ${r.liqs} liquidators, $${Number(r.vol).toFixed(0)} vol, $${Number(r.profit).toFixed(0)} profit`
    )
  }

  await pool.end()
}

async function main() {
  const arg = process.argv[2]
  if (arg === "schema") await schema()
  else if (arg === "scan") await scan()
  else if (arg === "update") await update()
  else {
    console.log("Usage: detect-funding-source.ts [schema|scan|update]")
    console.log("  schema — add funding_category column + backfill flash_loan rows")
    console.log("  scan   — fetch receipts for non-flash txs, save categorization")
    console.log("  update — apply categorization to DB")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e)
  process.exit(1)
})
