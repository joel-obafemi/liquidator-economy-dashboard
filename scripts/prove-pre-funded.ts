/**
 * Prove self-funding for "unknown" liquidations.
 *
 * For each (liquidator, debt_asset, block_number) triplet tagged as
 * funding_category='unknown', call balanceOf(liquidator) on the debt_asset ERC20
 * at block_number - 1. If the balance >= debt amount repaid in that tx, the
 * liquidator was definitively self-funded.
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/prove-pre-funded.ts scan
 *   npx tsx -r tsconfig-paths/register scripts/prove-pre-funded.ts update
 */
import { Pool } from "@neondatabase/serverless"
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
const RESULT_FILE = path.resolve(__dirname, "../.pre-funded-results.json")

// Archive-capable RPCs. Alchemy is the only public option that reliably
// returns state for blocks more than ~128 blocks old — prepend it when
// configured so we don't waste calls on archive-less endpoints.
const RPCS: string[] = [
  ...(process.env.ALCHEMY_RPC_URL ? [process.env.ALCHEMY_RPC_URL] : []),
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://eth.meowrpc.com",
  "https://rpc.ankr.com/eth",
]
let ri = 0

// balanceOf(address) — 4-byte selector
const BALANCE_OF_SELECTOR = "0x70a08231"

function padAddress(addr: string): string {
  return "000000000000000000000000" + addr.toLowerCase().replace(/^0x/, "")
}

function toHexBlock(n: number): string {
  return "0x" + n.toString(16)
}

/** Returns balance as bigint, or null on failure.
 *
 * When ALCHEMY_RPC_URL is configured, Alchemy is always tried first on every
 * call — public RPCs can't serve archive queries, so round-robin over them
 * only burns time. Non-Alchemy RPCs remain as fallbacks for transient
 * Alchemy failures. */
async function balanceOf(
  token: string,
  owner: string,
  blockNumber: number
): Promise<bigint | null> {
  const data = BALANCE_OF_SELECTOR + padAddress(owner)
  // Per-call candidate list: always start with Alchemy if set.
  const candidates = process.env.ALCHEMY_RPC_URL
    ? [process.env.ALCHEMY_RPC_URL, ...RPCS.filter((u) => u !== process.env.ALCHEMY_RPC_URL)]
    : RPCS
  for (let attempt = 0; attempt < Math.min(3, candidates.length); attempt++) {
    const url = candidates[attempt]
    ri++ // retained for API shape, no longer steers routing
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_call",
          params: [
            { to: token, data },
            toHexBlock(blockNumber),
          ],
          id: 1,
        }),
        signal: AbortSignal.timeout(10000),
      })
      const text = await r.text()
      if (text.startsWith("Too") || text.startsWith("<")) {
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      const j = JSON.parse(text)
      if (j.error) {
        // Missing trie node / archive not available on this node — try next
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
      if (!j.result || j.result === "0x") return 0n
      return BigInt(j.result)
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return null
}

interface Triplet {
  liquidator: string
  debtAsset: string
  blockNumber: number
  // Max debt amount to cover across all events at this triplet
  maxDebtRaw: string
  debtSymbol: string
}

async function scan() {
  console.log("=== Prove pre-funded via balanceOf at block N-1 ===\n")
  const pool = new Pool({ connectionString: dbUrl })

  // Collect distinct (liquidator, debt_asset, block_number) triplets from
  // events tagged as unknown. Use the MAX debt amount seen at that triplet as
  // the threshold — if balance ≥ max, it covers every event at that block.
  const r = await pool.query(`
    SELECT
      liquidator,
      debt_asset as debt_asset,
      block_number::bigint as block_number,
      MAX(debt_to_cover) as max_debt_raw,
      MAX(debt_symbol) as debt_symbol
    FROM liquidation_events
    WHERE funding_category = 'unknown'
      AND debt_asset IS NOT NULL
      AND debt_to_cover IS NOT NULL
    GROUP BY liquidator, debt_asset, block_number
    ORDER BY block_number ASC
  `)
  const triplets: Triplet[] = r.rows.map((row: any) => ({
    liquidator: row.liquidator,
    debtAsset: row.debt_asset,
    blockNumber: Number(row.block_number),
    maxDebtRaw: String(row.max_debt_raw),
    debtSymbol: row.debt_symbol,
  }))
  await pool.end()
  console.log(`  ${triplets.length} triplets to check`)

  // Resume from file if exists
  type Outcome = {
    balanceRaw: string
    debtRaw: string
    sufficient: boolean
  }
  let results: Record<string, Outcome> = {}
  let startIdx = 0
  if (fs.existsSync(RESULT_FILE)) {
    const prev = JSON.parse(fs.readFileSync(RESULT_FILE, "utf8"))
    results = prev.results || {}
    startIdx = prev.lastIndex || 0
    console.log(`  Resuming at ${startIdx}, ${Object.keys(results).length} triplets checked so far`)
  }

  let checked = 0
  let proven = 0
  let errors = 0

  const logEvery = Number(process.env.LOG_EVERY || 50)
  for (let i = startIdx; i < triplets.length; i++) {
    const t = triplets[i]
    const key = `${t.liquidator}|${t.debtAsset}|${t.blockNumber}`

    // balance at block N-1
    const bal = await balanceOf(t.debtAsset, t.liquidator, t.blockNumber - 1)
    if (bal === null) {
      errors++
    } else {
      const debt = BigInt(t.maxDebtRaw.split(".")[0]) // numeric -> bigint
      const sufficient = bal >= debt
      results[key] = {
        balanceRaw: bal.toString(),
        debtRaw: debt.toString(),
        sufficient,
      }
      if (sufficient) proven++
      checked++
    }

    // Alchemy handles ~300 rps; 150ms ≈ 6.6 rps is well under the free limit.
    await new Promise((r) => setTimeout(r, process.env.ALCHEMY_RPC_URL ? 150 : 400))

    if ((i + 1) % logEvery === 0) {
      fs.writeFileSync(
        RESULT_FILE,
        JSON.stringify({ results, lastIndex: i + 1, checked, errors, proven })
      )
      const pct = ((proven / (checked || 1)) * 100).toFixed(1)
      const erate = (
        (errors / ((checked || 0) + (errors || 0) || 1)) *
        100
      ).toFixed(1)
      console.log(
        `  [${i + 1}/${triplets.length}] checked:${checked} proven:${proven} (${pct}%) err:${errors} (${erate}% err rate)`
      )
    }
  }

  fs.writeFileSync(
    RESULT_FILE,
    JSON.stringify({ results, lastIndex: triplets.length, checked, errors, proven })
  )
  console.log(`\n  Done. ${proven}/${checked} proven self-funded (${((proven / (checked || 1)) * 100).toFixed(1)}%)`)
}

async function update() {
  console.log("=== Apply pre-funded proof to DB ===\n")
  if (!fs.existsSync(RESULT_FILE)) {
    console.error("No results file found")
    process.exit(1)
  }
  const { results } = JSON.parse(fs.readFileSync(RESULT_FILE, "utf8"))
  const entries = Object.entries(results) as [
    string,
    { balanceRaw: string; debtRaw: string; sufficient: boolean },
  ][]

  // Only apply where sufficient=true
  const proven = entries.filter(([_, v]) => v.sufficient)
  console.log(`  ${proven.length} triplets proven self-funded`)

  const pool = new Pool({ connectionString: dbUrl })

  // Bulk update via VALUES table — far fewer roundtrips than row-by-row
  const BATCH = 1000
  let updated = 0
  for (let i = 0; i < proven.length; i += BATCH) {
    const chunk = proven.slice(i, i + BATCH)
    const valuesSql = chunk
      .map(([key, _v], idx) => {
        const [liq, asset, block] = key.split("|")
        return `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3}::bigint)`
      })
      .join(",")
    const params: any[] = []
    for (const [key] of chunk) {
      const [liq, asset, block] = key.split("|")
      params.push(liq, asset, block)
    }
    const r = await pool.query(
      `
      UPDATE liquidation_events
      SET funding_category = 'pre_funded'
      FROM (VALUES ${valuesSql}) AS v(liq, asset, blk)
      WHERE liquidation_events.liquidator = v.liq
        AND liquidation_events.debt_asset = v.asset
        AND liquidation_events.block_number = v.blk
        AND liquidation_events.funding_category = 'unknown'
      `,
      params
    )
    updated += r.rowCount || 0
    console.log(`  batch ${i / BATCH + 1}: +${r.rowCount} events`)
  }

  // Final stats
  const breakdown = await pool.query(`
    SELECT funding_category as cat, COUNT(*)::int as events,
           COUNT(DISTINCT liquidator)::int as liqs,
           COALESCE(SUM(gross_profit_usd), 0) as profit
    FROM liquidation_events
    WHERE funding_category IS NOT NULL
    GROUP BY funding_category
    ORDER BY events DESC
  `)
  const total = (await pool.query("SELECT COUNT(*)::int as n FROM liquidation_events")).rows[0].n
  console.log(`\n=== RESULTS ===`)
  console.log(`Total events: ${total}`)
  for (const r of breakdown.rows) {
    const pct = ((Number(r.events) / Number(total)) * 100).toFixed(1)
    console.log(
      `  ${r.cat}: ${r.events} (${pct}%), ${r.liqs} liquidators, $${Number(r.profit).toFixed(0)} profit`
    )
  }

  await pool.end()
}

async function main() {
  const arg = process.argv[2]
  if (arg === "scan") await scan()
  else if (arg === "update") await update()
  else {
    console.log("Usage: prove-pre-funded.ts [scan|update]")
    console.log("  scan   — check balanceOf(liquidator) at block N-1 for each unknown triplet")
    console.log("  update — apply proven pre_funded status to DB")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e)
  process.exit(1)
})
