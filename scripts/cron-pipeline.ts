/**
 * Full incremental pipeline: scan new liquidations + enrich with gas, flash
 * loan, and funding source classifications. Designed to run on GitHub Actions
 * cron (hourly) so Vercel compute stays free.
 *
 * Handles only NEW events since the last run. Each stage is idempotent and
 * operates only on events missing the relevant data.
 *
 * Environment variables required:
 *   DATABASE_URL  — Neon Postgres connection string
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/cron-pipeline.ts
 */
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import * as fs from "fs"
import * as path from "path"
import { scanLiquidations } from "@/lib/scanner"

// Wire an explicit WebSocket implementation so this works on any Node version.
// Node 22.4+ has a global WebSocket, but older runners — and certain runtimes —
// do not. The Neon driver picks this up before the first Pool is opened.
;(neonConfig as any).webSocketConstructor = ws

// Load .env.local if present (for local dev); GitHub Actions sets envs directly
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

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required")
  process.exit(1)
}
const dbUrl = process.env.DATABASE_URL.replace(/&?channel_binding=[^&]*/g, "")

// Prepend Alchemy when configured — we use this for receipt fetches, which
// work on any RPC, but Alchemy gives us better throughput and uptime.
const RPCS: string[] = [
  ...(process.env.ALCHEMY_RPC_URL ? [process.env.ALCHEMY_RPC_URL] : []),
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
]
let ri = 0

// ─── Flash loan signatures (lowercase hex, no 0x) ───────────────────────────
const FLASH_TOPICS: Record<string, string> = {
  "631042c832b07452973831137f2d73e395028b44b250dedc5abb0ee766e168ac": "aave_v2",
  "efefaba5e921573100900a3ad9cf29f222d995fb3b6045797eaea7521b874571": "aave_v3",
  "bdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633": "uniswap_v3",
}
const ERC3156_TOPIC = "0d7d75e01ab95780d3cd1c8ec0dd6c2ce19e3a20427eec8bf53283b6fb8e95f0"
const MAKER_DSS_FLASH = "60744434d6339a6b27d73d9eda62b6f66a0a04fa"
const DYDX_SOLO = "1e0447b19bb6ecfdae1e4ae1694b0c3659614e4e"
const BALANCER_VAULT = "ba12222222228d8ba445958a75a0704d566bf2c8"

// ─── DEX swap signatures for funding classification ─────────────────────────
const SWAP_TOPICS: Record<string, string> = {
  uniswap_v2: "d78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",
  uniswap_v3: "c42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  curve_v1: "8b3e96f2b889fa771c53c981b40daf005f63f637f1869f707052d15a3dd97140",
  balancer_v2_swap: "2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b",
}

const AGGREGATORS: Record<string, string> = {
  oneinch_v5: "1111111254eeb25477b68fb85ed929f73a960582",
  oneinch_v4: "1111111254fb6c44bac0bed2854e76f90643097d",
  zerox: "def1c0ded9bec7f1a1670819833240f027b25eff",
  cowswap: "9008d19f58aabd9ed0d60971565aa8510560ab41",
  paraswap: "def171fe48cf0115b1d80b88dc8eab59176fee57",
}

interface Receipt {
  text: string
  gasUsed: string | null
  effectiveGasPrice: string | null
  blockNumber: string | null
}

async function fetchReceipt(tx: string): Promise<Receipt | null> {
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
      // Best-effort JSON parse for gas fields; if it fails we still return the
      // raw text for topic/address substring scanning.
      let gasUsed: string | null = null
      let effectiveGasPrice: string | null = null
      let blockNumber: string | null = null
      try {
        const j = JSON.parse(text)
        if (j.result) {
          gasUsed = j.result.gasUsed || null
          effectiveGasPrice = j.result.effectiveGasPrice || null
          blockNumber = j.result.blockNumber || null
        }
      } catch {
        /* large-receipt edge case — rely on substring scanning only */
      }
      return { text, gasUsed, effectiveGasPrice, blockNumber }
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return null
}

function classifyFlashLoan(text: string): string | null {
  for (const [topic, tag] of Object.entries(FLASH_TOPICS)) {
    if (text.includes(topic)) return tag
  }
  if (text.includes(ERC3156_TOPIC)) {
    if (text.includes(MAKER_DSS_FLASH)) return "maker_dai"
    if (text.includes(BALANCER_VAULT)) return "balancer"
    return "erc3156_other"
  }
  if (text.includes(DYDX_SOLO)) return "dydx"
  return null
}

function classifyFunding(text: string): { category: string; detail: string | null } {
  const foundSwaps: string[] = []
  for (const [name, topic] of Object.entries(SWAP_TOPICS)) {
    if (text.includes(topic)) foundSwaps.push(name)
  }
  if (foundSwaps.length > 0) return { category: "dex_swap", detail: foundSwaps.join(",") }
  for (const [name, addr] of Object.entries(AGGREGATORS)) {
    if (text.includes(addr)) return { category: "aggregator", detail: name }
  }
  return { category: "unknown", detail: null }
}

async function fetchEthPrice(timestamp: number): Promise<number | null> {
  // Reuse cached prices in DB — scanner already stores ETH prices for every
  // block timestamp during the enrichment pass.
  const pool = new Pool({ connectionString: dbUrl })
  try {
    const r = await pool.query(
      `SELECT price_usd FROM price_cache
       WHERE LOWER(token_address) = LOWER('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
         AND timestamp <= $1
       ORDER BY timestamp DESC LIMIT 1`,
      [timestamp]
    )
    return r.rows[0] ? Number(r.rows[0].price_usd) : null
  } finally {
    await pool.end()
  }
}

async function stage1_scan(): Promise<number> {
  console.log("── Stage 1: Scan new liquidations ──")
  const result = (await scanLiquidations("all")) as Record<
    string,
    { blocksScanned: number; newEvents: number; lastBlock: number } | undefined
  >
  let totalNew = 0
  for (const r of Object.values(result)) {
    totalNew += r?.newEvents ?? 0
  }
  console.log(`  Total new events: ${totalNew}`)
  return totalNew
}

async function stage2_enrichReceipts(): Promise<void> {
  console.log("── Stage 2: Enrich new events (gas + flash + funding) ──")
  const pool = new Pool({ connectionString: dbUrl })

  // Pick events that are missing ANY of the enrichment fields. One receipt
  // fetch gives us everything — far cheaper than three separate scans.
  const r = await pool.query(`
    SELECT DISTINCT tx_hash, block_timestamp
    FROM liquidation_events
    WHERE gas_used IS NULL
       OR is_flash_loan IS NULL
       OR funding_category IS NULL
    ORDER BY block_timestamp ASC
    LIMIT 500
  `)
  const txs = r.rows as { tx_hash: string; block_timestamp: string }[]
  console.log(`  ${txs.length} tx hashes need enrichment`)

  let enriched = 0
  let errors = 0

  for (const { tx_hash, block_timestamp } of txs) {
    const receipt = await fetchReceipt(tx_hash)
    if (!receipt) {
      errors++
      continue
    }

    // ── Flash loan classification ────────────────────────────────────────
    const flashSource = classifyFlashLoan(receipt.text)
    const isFlash = flashSource !== null

    // ── Funding classification ───────────────────────────────────────────
    let funding: { category: string; detail: string | null }
    if (isFlash) {
      funding = { category: "flash_loan", detail: flashSource }
    } else {
      funding = classifyFunding(receipt.text)
    }

    // ── Gas fields ───────────────────────────────────────────────────────
    let gasUsed: bigint | null = null
    let gasPriceGwei: number | null = null
    let gasCostEth: number | null = null
    let gasCostUsd: number | null = null
    if (receipt.gasUsed && receipt.effectiveGasPrice) {
      gasUsed = BigInt(receipt.gasUsed)
      const gasPriceWei = BigInt(receipt.effectiveGasPrice)
      gasPriceGwei = Number(gasPriceWei) / 1e9
      const gasCostWei = gasUsed * gasPriceWei
      gasCostEth = Number(gasCostWei) / 1e18
      const ethPrice = await fetchEthPrice(Number(block_timestamp))
      if (ethPrice) gasCostUsd = gasCostEth * ethPrice
    }

    // Single UPDATE per tx, covering all enrichment fields at once
    await pool.query(
      `UPDATE liquidation_events
       SET is_flash_loan = $1,
           flash_loan_source = $2,
           funding_category = $3,
           funding_detail = $4,
           gas_used = COALESCE($5, gas_used),
           gas_price_gwei = COALESCE($6, gas_price_gwei),
           gas_cost_eth = COALESCE($7, gas_cost_eth),
           gas_cost_usd = COALESCE($8, gas_cost_usd)
       WHERE tx_hash = $9`,
      [
        isFlash,
        flashSource,
        funding.category,
        funding.detail,
        gasUsed !== null ? gasUsed.toString() : null,
        gasPriceGwei,
        gasCostEth,
        gasCostUsd,
        tx_hash,
      ]
    )
    enriched++

    // Small throttle — GitHub-hosted runners have plenty of time but we want
    // to stay friendly to the public RPCs.
    await new Promise((r) => setTimeout(r, 300))
  }

  console.log(`  Enriched ${enriched} txs (${errors} errors)`)
  await pool.end()
}

async function stage3_recomputeNetProfit(): Promise<void> {
  console.log("── Stage 3: Recompute net profit for newly enriched events ──")
  const pool = new Pool({ connectionString: dbUrl })
  const r = await pool.query(`
    UPDATE liquidation_events
    SET net_profit_usd = COALESCE(gross_profit_usd, 0) - COALESCE(gas_cost_usd, 0)
    WHERE gas_cost_usd IS NOT NULL
      AND (net_profit_usd IS NULL
           OR net_profit_usd <> COALESCE(gross_profit_usd, 0) - COALESCE(gas_cost_usd, 0))
  `)
  console.log(`  Updated ${r.rowCount} net_profit_usd values`)
  await pool.end()
}

async function main() {
  const start = Date.now()
  console.log(`=== Cron Pipeline · ${new Date().toISOString()} ===\n`)

  const newEvents = await stage1_scan()
  if (newEvents > 0 || process.argv.includes("--force-enrich")) {
    await stage2_enrichReceipts()
    await stage3_recomputeNetProfit()
  } else {
    console.log("No new events — skipping enrichment stages.")
  }

  const elapsed = Math.round((Date.now() - start) / 1000)
  console.log(`\n=== Pipeline complete in ${elapsed}s ===`)
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e)
  process.exit(1)
})
