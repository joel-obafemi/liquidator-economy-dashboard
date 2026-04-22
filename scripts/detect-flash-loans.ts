/**
 * Detect flash loans in liquidation transactions.
 * Uses file-based approach to avoid Neon connection drops during long loops.
 *
 * Run with: npx tsx -r tsconfig-paths/register scripts/detect-flash-loans.ts
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
const TX_FILE = path.resolve(__dirname, "../.flash-tx-hashes.json")
const RESULT_FILE = path.resolve(__dirname, "../.flash-results.json")

const FLASH_TOPICS: Record<string, string> = {
  "0x631042c832b07452973831137f2d73e395028b44b250dedc5abb0ee766e168ac": "aave_v2",
  "0xefefaba5e921573100900a3ad9cf29f222d995fb3b6045797eaea7521b874571": "aave_v3",
  "0x0d7d75e01ab95780d3cd1c8ec0dd6c2ce19e3a20427eec8bf53283b6fb8e95f0": "balancer",
  "0xbdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633": "uniswap_v3",
}

const RPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://rpc.ankr.com/eth"]
let ri = 0

async function checkTx(tx: string): Promise<string | null> {
  for (let a = 0; a < 3; a++) {
    const url = RPCS[ri++ % RPCS.length]
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getTransactionReceipt", params: [tx], id: 1 }),
        signal: AbortSignal.timeout(10000),
      })
      const text = await r.text()
      if (text.startsWith("Too") || text.startsWith("<")) { await new Promise(r => setTimeout(r, 2000)); continue }
      // String-based topic search for very large receipts (avoids JSON.parse memory issues)
      for (const topic of Object.keys(FLASH_TOPICS)) {
        if (text.includes(topic.slice(2))) return FLASH_TOPICS[topic]
      }
      return null
    } catch { await new Promise(r => setTimeout(r, 1000)) }
  }
  return null
}

async function step1_exportTxHashes() {
  console.log("Step 1: Exporting tx hashes from DB...")
  const pool = new Pool({ connectionString: dbUrl })
  const r = await pool.query("SELECT DISTINCT tx_hash FROM liquidation_events ORDER BY tx_hash")
  const hashes = r.rows.map((r: any) => r.tx_hash)
  fs.writeFileSync(TX_FILE, JSON.stringify(hashes))
  await pool.end()
  console.log(`  Exported ${hashes.length} tx hashes to ${TX_FILE}`)
  return hashes.length
}

async function step2_scanReceipts() {
  console.log("Step 2: Scanning receipts for flash loans...")
  const hashes: string[] = JSON.parse(fs.readFileSync(TX_FILE, "utf8"))

  // Load previous progress if exists
  let flashMap: Record<string, string> = {}
  let startIdx = 0
  if (fs.existsSync(RESULT_FILE)) {
    const prev = JSON.parse(fs.readFileSync(RESULT_FILE, "utf8"))
    flashMap = prev.flashMap || {}
    startIdx = prev.lastIndex || 0
    console.log(`  Resuming from index ${startIdx} (${Object.keys(flashMap).length} flash found so far)`)
  }

  let checked = 0
  let errors = 0

  for (let i = startIdx; i < hashes.length; i++) {
    try {
      const source = await checkTx(hashes[i])
      if (source) flashMap[hashes[i]] = source
      checked++
    } catch {
      errors++
    }
    await new Promise(r => setTimeout(r, 650))

    // Save progress every 100 txs
    if ((i + 1) % 100 === 0) {
      fs.writeFileSync(RESULT_FILE, JSON.stringify({ flashMap, lastIndex: i + 1, checked, errors }))
      console.log(`  [${i + 1}/${hashes.length}] checked:${checked} flash:${Object.keys(flashMap).length} err:${errors}`)
    }
  }

  // Final save
  fs.writeFileSync(RESULT_FILE, JSON.stringify({ flashMap, lastIndex: hashes.length, checked, errors }))
  console.log(`  Done: ${Object.keys(flashMap).length} flash txs out of ${checked} checked`)
}

async function step3_updateDb() {
  console.log("Step 3: Updating database...")
  const { flashMap }: { flashMap: Record<string, string> } = JSON.parse(fs.readFileSync(RESULT_FILE, "utf8"))
  const entries = Object.entries(flashMap)
  console.log(`  ${entries.length} flash loan txs to mark`)

  const pool = new Pool({ connectionString: dbUrl })
  await pool.query("UPDATE liquidation_events SET is_flash_loan = false, flash_loan_source = NULL")

  if (entries.length > 0) {
    let updated = 0
    const src: Record<string, number> = {}
    for (const [tx, source] of entries) {
      const r = await pool.query(
        "UPDATE liquidation_events SET is_flash_loan = true, flash_loan_source = $1 WHERE tx_hash = $2",
        [source, tx]
      )
      updated += r.rowCount || 0
      src[source] = (src[source] || 0) + 1
    }
    console.log(`  Updated ${updated} events`)
    for (const [s, c] of Object.entries(src).sort((a, b) => b[1] - a[1])) console.log(`    ${s}: ${c}`)
  }

  const s = (await pool.query(`
    SELECT COUNT(*) as t, COUNT(*) FILTER (WHERE is_flash_loan) as f,
           COUNT(DISTINCT liquidator) FILTER (WHERE is_flash_loan) as fl,
           COALESCE(SUM(collateral_amount_usd) FILTER (WHERE is_flash_loan), 0) as fv,
           COALESCE(SUM(gross_profit_usd) FILTER (WHERE is_flash_loan), 0) as fp
    FROM liquidation_events
  `)).rows[0]
  console.log(`\n=== RESULTS ===`)
  console.log(`Flash: ${s.f}/${s.t} (${((s.f / s.t) * 100).toFixed(1)}%), ${s.fl} liquidators`)
  console.log(`Vol: $${Number(s.fv).toFixed(0)}, Profit: $${Number(s.fp).toFixed(0)}`)

  await pool.end()

  // Cleanup temp files
  try { fs.unlinkSync(TX_FILE) } catch {}
  try { fs.unlinkSync(RESULT_FILE) } catch {}
}

async function main() {
  console.log("=== Flash Loan Detection ===\n")

  const arg = process.argv[2]

  if (arg === "scan") {
    await step2_scanReceipts()
  } else if (arg === "update") {
    await step3_updateDb()
  } else {
    // Full run
    await step1_exportTxHashes()
    await step2_scanReceipts()
    await step3_updateDb()
  }
}

main().catch((e) => { console.error("Fatal:", e?.message || e); process.exit(1) })
