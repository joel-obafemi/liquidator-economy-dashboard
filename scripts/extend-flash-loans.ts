/**
 * Extend flash loan detection with Maker DAI flash mints and dYdX Solo flash loans.
 *
 * Phase A: re-scan the existing "balancer" txs to split out Maker DssFlash
 *          (Balancer and Maker emit the same ERC-3156 FlashLoan event; we
 *          differentiate by the emitting contract's address in the logs).
 * Phase B: scan the currently-non-flash txs for dYdX Solo Margin involvement
 *          and any missed Maker flash mints.
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/extend-flash-loans.ts phaseA
 *   npx tsx -r tsconfig-paths/register scripts/extend-flash-loans.ts phaseB
 *   npx tsx -r tsconfig-paths/register scripts/extend-flash-loans.ts update
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

const PHASE_A_FILE = path.resolve(__dirname, "../.flash-extended-phaseA.json")
const PHASE_B_FILE = path.resolve(__dirname, "../.flash-extended-phaseB.json")

// Lowercase, no-0x hex strings for substring matching against receipt JSON
const MAKER_DSS_FLASH = "60744434d6339a6b27d73d9eda62b6f66a0a04fa"
const DYDX_SOLO_MARGIN = "1e0447b19bb6ecfdae1e4ae1694b0c3659614e4e"
const BALANCER_VAULT = "ba12222222228d8ba445958a75a0704d566bf2c8"

// Existing signatures (unique per provider, already detected in first pass)
const AAVE_V2_TOPIC = "631042c832b07452973831137f2d73e395028b44b250dedc5abb0ee766e168ac"
const AAVE_V3_TOPIC = "efefaba5e921573100900a3ad9cf29f222d995fb3b6045797eaea7521b874571"
const UNI_V3_TOPIC = "bdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633"
// ERC-3156 FlashLoan event — shared by Balancer Vault AND Maker DssFlash
const ERC3156_TOPIC = "0d7d75e01ab95780d3cd1c8ec0dd6c2ce19e3a20427eec8bf53283b6fb8e95f0"

const RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
]
let ri = 0

/** Returns classification tag from receipt text, or null if no flash loan detected. */
function classifyReceipt(text: string): string | null {
  // Order matters: check unique topics first, then disambiguate ERC-3156,
  // then fall back to address-only detection for dYdX (no standard event).
  if (text.includes(AAVE_V2_TOPIC)) return "aave_v2"
  if (text.includes(AAVE_V3_TOPIC)) return "aave_v3"
  if (text.includes(UNI_V3_TOPIC)) return "uniswap_v3"

  if (text.includes(ERC3156_TOPIC)) {
    // Either Balancer Vault or Maker DssFlash emitted the event; check which.
    if (text.includes(MAKER_DSS_FLASH)) return "maker_dai"
    if (text.includes(BALANCER_VAULT)) return "balancer"
    // Some other ERC-3156 implementer
    return "erc3156_other"
  }

  // dYdX Solo doesn't emit a canonical FlashLoan event. Solo Margin is almost
  // exclusively used for margin + flash-like operate() calls, so if Solo's
  // address appears in any log of a liquidation tx, attribute to dYdX.
  if (text.includes(DYDX_SOLO_MARGIN)) return "dydx"

  return null
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

/**
 * Phase A: re-check currently-"balancer" txs for Maker DssFlash address.
 * If found, re-classify as maker_dai.
 */
async function phaseA() {
  console.log("=== Phase A: Re-check Balancer txs for Maker DssFlash ===\n")
  const pool = new Pool({ connectionString: dbUrl })

  // Load current Balancer-tagged txs
  const r = await pool.query(
    "SELECT DISTINCT tx_hash FROM liquidation_events WHERE flash_loan_source = 'balancer' ORDER BY tx_hash"
  )
  const hashes: string[] = r.rows.map((row: any) => row.tx_hash)
  await pool.end()
  console.log(`  ${hashes.length} balancer txs to re-check`)

  // Resume if we have saved state
  let reclassMap: Record<string, string> = {}
  let startIdx = 0
  if (fs.existsSync(PHASE_A_FILE)) {
    const prev = JSON.parse(fs.readFileSync(PHASE_A_FILE, "utf8"))
    reclassMap = prev.reclassMap || {}
    startIdx = prev.lastIndex || 0
    console.log(`  Resuming at ${startIdx}, ${Object.keys(reclassMap).length} re-classified so far`)
  }

  let checked = 0
  let errors = 0

  for (let i = startIdx; i < hashes.length; i++) {
    const tx = hashes[i]
    const text = await fetchReceipt(tx)
    if (text === null) {
      errors++
    } else {
      const cls = classifyReceipt(text)
      // Only write if we found a different classification than balancer
      if (cls && cls !== "balancer") {
        reclassMap[tx] = cls
      }
      checked++
    }
    await new Promise((r) => setTimeout(r, 650))

    if ((i + 1) % 50 === 0) {
      fs.writeFileSync(
        PHASE_A_FILE,
        JSON.stringify({ reclassMap, lastIndex: i + 1, checked, errors })
      )
      console.log(
        `  [${i + 1}/${hashes.length}] reclassified:${Object.keys(reclassMap).length} errors:${errors}`
      )
    }
  }

  fs.writeFileSync(
    PHASE_A_FILE,
    JSON.stringify({ reclassMap, lastIndex: hashes.length, checked, errors })
  )

  const byTag: Record<string, number> = {}
  for (const tag of Object.values(reclassMap)) byTag[tag] = (byTag[tag] || 0) + 1
  console.log(`\n  Done. ${Object.keys(reclassMap).length} balancer txs re-classified:`)
  for (const [t, c] of Object.entries(byTag).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t}: ${c}`)
  }
}

/**
 * Phase B: scan currently-non-flash txs for dYdX and Maker that we missed.
 */
async function phaseB() {
  console.log("=== Phase B: Scan non-flash txs for dYdX / Maker ===\n")
  const pool = new Pool({ connectionString: dbUrl })

  const r = await pool.query(
    "SELECT DISTINCT tx_hash FROM liquidation_events WHERE is_flash_loan = false OR is_flash_loan IS NULL ORDER BY tx_hash"
  )
  const hashes: string[] = r.rows.map((row: any) => row.tx_hash)
  await pool.end()
  console.log(`  ${hashes.length} non-flash txs to scan`)

  let newFlashMap: Record<string, string> = {}
  let startIdx = 0
  if (fs.existsSync(PHASE_B_FILE)) {
    const prev = JSON.parse(fs.readFileSync(PHASE_B_FILE, "utf8"))
    newFlashMap = prev.newFlashMap || {}
    startIdx = prev.lastIndex || 0
    console.log(`  Resuming at ${startIdx}, ${Object.keys(newFlashMap).length} new flash found so far`)
  }

  let checked = 0
  let errors = 0

  for (let i = startIdx; i < hashes.length; i++) {
    const tx = hashes[i]
    const text = await fetchReceipt(tx)
    if (text === null) {
      errors++
    } else {
      const cls = classifyReceipt(text)
      // Only interested in new tags (dydx / maker_dai / aave missed earlier)
      if (cls && cls !== "balancer") {
        newFlashMap[tx] = cls
      }
      checked++
    }
    await new Promise((r) => setTimeout(r, 650))

    if ((i + 1) % 100 === 0) {
      fs.writeFileSync(
        PHASE_B_FILE,
        JSON.stringify({ newFlashMap, lastIndex: i + 1, checked, errors })
      )
      console.log(
        `  [${i + 1}/${hashes.length}] new_flash:${Object.keys(newFlashMap).length} errors:${errors}`
      )
    }
  }

  fs.writeFileSync(
    PHASE_B_FILE,
    JSON.stringify({ newFlashMap, lastIndex: hashes.length, checked, errors })
  )

  const byTag: Record<string, number> = {}
  for (const tag of Object.values(newFlashMap)) byTag[tag] = (byTag[tag] || 0) + 1
  console.log(`\n  Done. ${Object.keys(newFlashMap).length} new flash txs found:`)
  for (const [t, c] of Object.entries(byTag).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t}: ${c}`)
  }
}

/** Apply phaseA + phaseB results to the DB. */
async function update() {
  console.log("=== Apply phase A + B results to DB ===\n")
  const pool = new Pool({ connectionString: dbUrl })

  // Phase A: re-classify existing Balancer matches
  let phaseAUpdates = 0
  if (fs.existsSync(PHASE_A_FILE)) {
    const { reclassMap } = JSON.parse(fs.readFileSync(PHASE_A_FILE, "utf8"))
    const entries = Object.entries(reclassMap as Record<string, string>)
    console.log(`  Phase A: re-classifying ${entries.length} balancer → other`)
    for (const [tx, source] of entries) {
      const r = await pool.query(
        "UPDATE liquidation_events SET flash_loan_source = $1 WHERE tx_hash = $2",
        [source, tx]
      )
      phaseAUpdates += r.rowCount || 0
    }
    console.log(`    ${phaseAUpdates} events updated`)
  } else {
    console.log("  Phase A results file not found, skipping")
  }

  // Phase B: mark new flash txs
  let phaseBUpdates = 0
  if (fs.existsSync(PHASE_B_FILE)) {
    const { newFlashMap } = JSON.parse(fs.readFileSync(PHASE_B_FILE, "utf8"))
    const entries = Object.entries(newFlashMap as Record<string, string>)
    console.log(`  Phase B: marking ${entries.length} new flash txs`)
    for (const [tx, source] of entries) {
      const r = await pool.query(
        "UPDATE liquidation_events SET is_flash_loan = true, flash_loan_source = $1 WHERE tx_hash = $2",
        [source, tx]
      )
      phaseBUpdates += r.rowCount || 0
    }
    console.log(`    ${phaseBUpdates} events updated`)
  } else {
    console.log("  Phase B results file not found, skipping")
  }

  // Final stats
  const s = (
    await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_flash_loan) as flash,
      COUNT(DISTINCT liquidator) FILTER (WHERE is_flash_loan) as flash_liqs,
      COALESCE(SUM(collateral_amount_usd) FILTER (WHERE is_flash_loan), 0) as vol,
      COALESCE(SUM(gross_profit_usd) FILTER (WHERE is_flash_loan), 0) as profit
    FROM liquidation_events
  `)
  ).rows[0]

  const breakdown = await pool.query(`
    SELECT flash_loan_source as source,
           COUNT(*)::int as n,
           COUNT(DISTINCT liquidator)::int as liqs
    FROM liquidation_events
    WHERE is_flash_loan = true
    GROUP BY flash_loan_source
    ORDER BY n DESC
  `)

  console.log(`\n=== RESULTS ===`)
  console.log(
    `Flash: ${s.flash}/${s.total} (${((Number(s.flash) / Number(s.total)) * 100).toFixed(1)}%), ${s.flash_liqs} liquidators`
  )
  console.log(`Volume: $${Number(s.vol).toFixed(0)}, Profit: $${Number(s.profit).toFixed(0)}\n`)
  console.log(`By source:`)
  for (const r of breakdown.rows) {
    console.log(`  ${r.source}: ${r.n} events, ${r.liqs} liquidators`)
  }

  await pool.end()
}

async function main() {
  const arg = process.argv[2]
  if (arg === "phaseA") await phaseA()
  else if (arg === "phaseB") await phaseB()
  else if (arg === "update") await update()
  else {
    console.log("Usage: extend-flash-loans.ts [phaseA|phaseB|update]")
    console.log("  phaseA — re-check existing balancer txs for Maker DssFlash")
    console.log("  phaseB — scan non-flash txs for dYdX and Maker")
    console.log("  update — apply saved results to DB")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e)
  process.exit(1)
})
