/**
 * Reconnaissance: sample unknown-funding transactions and dump unique log
 * topics + log emitters. Helps identify what flash-loan providers or DEX
 * patterns we're missing in our detection signatures.
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/recon-unknown-funding.ts [sampleSize]
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

// Topics we already detect — anything else is what we're missing.
const KNOWN_TOPICS = new Set([
  "0x631042c832b07452973831137f2d73e395028b44b250dedc5abb0ee766e168ac", // Aave V2 flash
  "0xefefaba5e921573100900a3ad9cf29f222d995fb3b6045797eaea7521b874571", // Aave V3 flash
  "0x0d7d75e01ab95780d3cd1c8ec0dd6c2ce19e3a20427eec8bf53283b6fb8e95f0", // ERC-3156 / Balancer / Maker
  "0xbdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633", // Uniswap V3 flash
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822", // Uniswap V2 swap
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67", // Uniswap V3 swap
  "0x8b3e96f2b889fa771c53c981b40daf005f63f637f1869f707052d15a3dd97140", // Curve V1 TokenExchange
  "0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b", // Balancer V2 Swap
])

// Addresses already matched — anything else is worth investigating
const KNOWN_ADDRS = new Set(
  [
    "1111111254eeb25477b68fb85ed929f73a960582", // 1inch V5
    "1111111254fb6c44bac0bed2854e76f90643097d", // 1inch V4
    "def1c0ded9bec7f1a1670819833240f027b25eff", // 0x Exchange Proxy
    "9008d19f58aabd9ed0d60971565aa8510560ab41", // Cowswap
    "def171fe48cf0115b1d80b88dc8eab59176fee57", // Paraswap
    "60744434d6339a6b27d73d9eda62b6f66a0a04fa", // Maker DssFlash
    "1e0447b19bb6ecfdae1e4ae1694b0c3659614e4e", // dYdX Solo
    "ba12222222228d8ba445958a75a0704d566bf2c8", // Balancer Vault
  ].map((a) => a.toLowerCase())
)

// Transfer event — ERC20 transfers are everywhere, we don't care about these
const BORING_TOPICS = new Set([
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", // Approval
  "0xb3d987963d01b2f68493b4bdb130988f157ea43070d4ad840fee0466ed9370d9", // Sync (UniV2)
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1", // Sync (general)
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c", // Deposit
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65", // Withdrawal
])

const RPCS: string[] = [
  ...(process.env.ALCHEMY_RPC_URL ? [process.env.ALCHEMY_RPC_URL] : []),
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
]

async function fetchReceipt(tx: string): Promise<any | null> {
  for (let a = 0; a < 3; a++) {
    const url = RPCS[a % RPCS.length]
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
      const j = await r.json()
      if (j.result) return j.result
    } catch {}
  }
  return null
}

async function main() {
  const sampleSize = Number(process.argv[2] || 50)
  console.log(`Fetching ${sampleSize} unknown-funding txs for reconnaissance...\n`)

  const pool = new Pool({ connectionString: dbUrl })
  const r = await pool.query(
    `SELECT tx_hash FROM (
       SELECT DISTINCT tx_hash FROM liquidation_events WHERE funding_category = 'unknown'
     ) t
     ORDER BY RANDOM() LIMIT $1`,
    [sampleSize]
  )
  await pool.end()
  const txs: string[] = r.rows.map((row: any) => row.tx_hash)
  console.log(`Sampled ${txs.length} txs`)

  // Collect topic0 counts and (address, topic0) pairs for emitters
  const topicCounts: Record<string, number> = {}
  const addrCounts: Record<string, number> = {}
  const addrTopicPairs: Record<string, Set<string>> = {}

  let processed = 0
  for (const tx of txs) {
    const receipt = await fetchReceipt(tx)
    if (!receipt || !receipt.logs) continue
    for (const log of receipt.logs) {
      if (!log.topics || log.topics.length === 0) continue
      const t0 = log.topics[0].toLowerCase()
      const addr = (log.address || "").toLowerCase().replace(/^0x/, "")
      if (KNOWN_TOPICS.has(t0) || BORING_TOPICS.has(t0)) continue
      if (KNOWN_ADDRS.has(addr)) continue
      topicCounts[t0] = (topicCounts[t0] || 0) + 1
      addrCounts[addr] = (addrCounts[addr] || 0) + 1
      if (!addrTopicPairs[addr]) addrTopicPairs[addr] = new Set()
      addrTopicPairs[addr].add(t0)
    }
    processed++
    if (processed % 10 === 0) console.log(`  ${processed}/${txs.length}`)
    await new Promise((r) => setTimeout(r, 300))
  }

  console.log(`\n=== Top 30 non-known topics ===`)
  const sortedTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 30)
  for (const [t, n] of sortedTopics) {
    console.log(`  ${n.toString().padStart(4)}  ${t}`)
  }

  console.log(`\n=== Top 30 non-known emitter addresses ===`)
  const sortedAddrs = Object.entries(addrCounts).sort((a, b) => b[1] - a[1]).slice(0, 30)
  for (const [a, n] of sortedAddrs) {
    const uniqueTopics = addrTopicPairs[a]?.size || 0
    console.log(`  ${n.toString().padStart(4)}  0x${a}  (${uniqueTopics} distinct topics)`)
  }

  const outFile = path.resolve(__dirname, "../.recon-unknown.json")
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        sampleSize: processed,
        topicCounts,
        addrCounts,
        addrTopicPairs: Object.fromEntries(
          Object.entries(addrTopicPairs).map(([k, v]) => [k, Array.from(v)])
        ),
      },
      null,
      2
    )
  )
  console.log(`\nFull data saved to ${outFile}`)
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e)
  process.exit(1)
})
