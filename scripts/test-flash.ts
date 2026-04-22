import { Pool } from "@neondatabase/serverless"
import * as fs from "fs"
import * as path from "path"

process.on("uncaughtException", (e) => { console.error("UNCAUGHT:", e); process.exit(1) })
process.on("unhandledRejection", (e: any) => { console.error("UNHANDLED:", e); process.exit(1) })

const envPath = path.resolve(__dirname, "../.env.local")
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

const dbUrl = process.env.DATABASE_URL!.replace(/&?channel_binding=[^&]*/g, "")
const pool = new Pool({ connectionString: dbUrl })

const FLASH_TOPICS: Record<string, string> = {
  "0x631042c832b07452973831137f2d73e395028b44b250dedc5abb0ee766e168ac": "aave_v2",
  "0xefefaba5e921573100900a3ad9cf29f222d995fb3b6045797eaea7521b874571": "aave_v3",
  "0x0d7d75e01ab95780d3cd1c8ec0dd6c2ce19e3a20427eec8bf53283b6fb8e95f0": "balancer",
  "0xbdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633": "uniswap_v3",
}

async function main() {
  // Load ALL tx hashes
  console.log("Loading tx hashes...")
  const allR = await pool.query("SELECT DISTINCT tx_hash FROM liquidation_events LIMIT 100")
  const allTx = allR.rows.map((r: any) => r.tx_hash)
  console.log(`Loaded ${allTx.length} txs. Starting receipt scan...`)

  let flash = 0
  let checked = 0
  let errors = 0
  const flashMap = new Map<string, string>()

  for (let i = 0; i < allTx.length; i++) {
    try {
      const rpcUrl = i % 3 === 0 ? "https://ethereum-rpc.publicnode.com" : i % 3 === 1 ? "https://eth.llamarpc.com" : "https://rpc.ankr.com/eth"
      const r = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getTransactionReceipt", params: [allTx[i]], id: 1 }),
        signal: AbortSignal.timeout(10000),
      })
      const text = await r.text()
      if (text.startsWith("Too") || text.startsWith("<")) {
        errors++
        await new Promise(r => setTimeout(r, 2000))
        continue
      }
      const receipt = JSON.parse(text).result
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          const t0 = log.topics?.[0]?.toLowerCase()
          if (t0 && FLASH_TOPICS[t0]) {
            flashMap.set(allTx[i], FLASH_TOPICS[t0])
            flash++
            break
          }
        }
      }
      checked++
    } catch {
      errors++
    }

    if ((i + 1) % 200 === 0) {
      console.log(`[${i + 1}/${allTx.length}] checked:${checked} flash:${flash} err:${errors}`)
    }

    await new Promise(r => setTimeout(r, 650))
  }

  console.log(`\nScan complete: ${flash} flash txs out of ${checked} checked (${errors} errors)`)

  // Update DB
  console.log("Updating DB...")
  await pool.query("UPDATE liquidation_events SET is_flash_loan = false, flash_loan_source = NULL")
  let updated = 0
  for (const [tx, source] of flashMap) {
    const r = await pool.query("UPDATE liquidation_events SET is_flash_loan = true, flash_loan_source = $1 WHERE tx_hash = $2", [source, tx])
    updated += r.rowCount || 0
  }
  console.log(`Updated ${updated} events`)

  const s = (await pool.query(`
    SELECT COUNT(*) as t, COUNT(*) FILTER (WHERE is_flash_loan) as f,
           COUNT(DISTINCT liquidator) FILTER (WHERE is_flash_loan) as fl,
           COALESCE(SUM(collateral_amount_usd) FILTER (WHERE is_flash_loan), 0) as fv,
           COALESCE(SUM(gross_profit_usd) FILTER (WHERE is_flash_loan), 0) as fp
    FROM liquidation_events
  `)).rows[0]
  console.log(`Flash: ${s.f}/${s.t} (${((s.f / s.t) * 100).toFixed(1)}%), ${s.fl} liquidators, $${Number(s.fv).toFixed(0)} vol, $${Number(s.fp).toFixed(0)} profit`)

  await pool.end()
}

main()
