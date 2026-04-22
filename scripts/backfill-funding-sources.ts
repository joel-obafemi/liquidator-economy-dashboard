/**
 * Backfill funding source cache for all liquidators.
 *
 * Fetches the first incoming ETH transfer (or deployer) for each liquidator
 * that isn't already cached. Uses Etherscan (if API key set) and Blockscout
 * as fallback. Rate-limited to ~3 req/sec.
 *
 * Run with: npx tsx -r tsconfig-paths/register scripts/backfill-funding-sources.ts
 */
import { Pool } from "@neondatabase/serverless"
import * as fs from "fs"
import * as path from "path"

const envPath = path.resolve(__dirname, "../.env.local")
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!process.env[key]) process.env[key] = val
  }
}

const dbUrl = process.env.DATABASE_URL!.replace(/&?channel_binding=[^&]*/g, "")
const pool = new Pool({ connectionString: dbUrl })

const KNOWN_LABELS: Record<string, string> = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance 14",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance 15",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance 16",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance 17",
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance 18",
  "0x4976a4a02f38326660d17bf34b431dc6e2eb2327": "Binance 19",
  "0x46340b20830761efd32832a74d7169b29feb9758": "Binance 20",
  "0xd24400ae8bfebb18ca49be86258a3c749cf46853": "Gemini 1",
  "0x07ee55aa48bb72dcc6e9d78256648910de513eca": "OKX",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX 2",
  "0xa910f92acdaf488fa6ef02174fb86208ad7722ba": "OKX 3",
  "0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5": "Binance Hot Wallet",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance 8",
  "0x5a52e96bacdabb82fd05763e25335261b270efcb": "Binance 19",
  "0x40b38765696e3d5d8d9d834d8aad4bb6e418e489": "Robinhood",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchFundingSource(liquidator: string): Promise<{
  fromAddress: string
  txHash: string
  blockNumber: number
  timestamp: number
  valueEth: number
  fromLabel: string | null
  kind: "deployer" | "funding"
} | null> {
  const apiKey = process.env.ETHERSCAN_API_KEY || ""
  const endpoints = apiKey
    ? [
        `https://api.etherscan.io/api?module=account&action=txlist&address=${liquidator}&startblock=0&endblock=99999999&page=1&offset=100&sort=asc&apikey=${apiKey}`,
        `https://eth.blockscout.com/api?module=account&action=txlist&address=${liquidator}&startblock=0&endblock=99999999&page=1&offset=100&sort=asc`,
      ]
    : [
        `https://eth.blockscout.com/api?module=account&action=txlist&address=${liquidator}&startblock=0&endblock=99999999&page=1&offset=100&sort=asc`,
      ]

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) continue
      const json = await res.json()
      if (json.status !== "1" || !Array.isArray(json.result) || json.result.length === 0) continue

      const firstTx = json.result[0]
      const isContractCreation =
        firstTx && (!firstTx.to || firstTx.to === "") &&
        firstTx.from?.toLowerCase() !== liquidator.toLowerCase()

      if (isContractCreation) {
        const addr = firstTx.from.toLowerCase()
        return {
          fromAddress: addr,
          txHash: firstTx.hash,
          blockNumber: Number(firstTx.blockNumber),
          timestamp: Number(firstTx.timeStamp),
          valueEth: Number(firstTx.value || 0) / 1e18,
          fromLabel: KNOWN_LABELS[addr] || null,
          kind: "deployer",
        }
      }

      // EOA — find first incoming ETH transfer
      const incoming = json.result.find(
        (tx: any) =>
          tx.to?.toLowerCase() === liquidator.toLowerCase() &&
          tx.value && tx.value !== "0" &&
          tx.from?.toLowerCase() !== liquidator.toLowerCase()
      )

      if (incoming) {
        const addr = incoming.from.toLowerCase()
        return {
          fromAddress: addr,
          txHash: incoming.hash,
          blockNumber: Number(incoming.blockNumber),
          timestamp: Number(incoming.timeStamp),
          valueEth: Number(incoming.value) / 1e18,
          fromLabel: KNOWN_LABELS[addr] || null,
          kind: "funding",
        }
      }

      // API returned data but no funding source found (e.g. self-funded or internal tx only)
      return null
    } catch {
      continue
    }
  }
  return null
}

async function main() {
  console.log("=== Backfilling Funding Source Cache ===\n")

  // Get all distinct liquidators
  const allLiqs = await pool.query(
    "SELECT DISTINCT liquidator FROM liquidation_events ORDER BY liquidator"
  )
  console.log(`  Total distinct liquidators: ${allLiqs.rows.length}`)

  // Get already cached
  const cached = await pool.query(
    "SELECT liquidator FROM funding_source_cache WHERE from_address IS NOT NULL"
  )
  const cachedSet = new Set(cached.rows.map((r: any) => r.liquidator.toLowerCase()))
  console.log(`  Already cached: ${cachedSet.size}`)

  const toDo = allLiqs.rows
    .map((r: any) => r.liquidator.toLowerCase())
    .filter((a: string) => !cachedSet.has(a))
  console.log(`  Need to fetch: ${toDo.length}\n`)

  if (toDo.length === 0) {
    console.log("  Nothing to do!")
    await pool.end()
    return
  }

  let success = 0
  let failed = 0
  let noSource = 0

  for (let i = 0; i < toDo.length; i++) {
    const liq = toDo[i]
    process.stdout.write(`  [${i + 1}/${toDo.length}] ${liq.slice(0, 10)}... `)

    try {
      const result = await fetchFundingSource(liq)

      if (result) {
        await pool.query(
          `INSERT INTO funding_source_cache
            (liquidator, from_address, tx_hash, block_number, timestamp, value_eth, from_label, kind)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (liquidator) DO UPDATE SET
             from_address = EXCLUDED.from_address,
             tx_hash = EXCLUDED.tx_hash,
             block_number = EXCLUDED.block_number,
             timestamp = EXCLUDED.timestamp,
             value_eth = EXCLUDED.value_eth,
             from_label = EXCLUDED.from_label,
             kind = EXCLUDED.kind`,
          [
            liq,
            result.fromAddress,
            result.txHash,
            result.blockNumber,
            result.timestamp,
            result.valueEth,
            result.fromLabel,
            result.kind,
          ]
        )
        console.log(`✓ ${result.kind} from ${result.fromAddress.slice(0, 10)}...${result.fromLabel ? ` (${result.fromLabel})` : ""}`)
        success++
      } else {
        // Cache as "no source found" so we don't re-fetch
        await pool.query(
          `INSERT INTO funding_source_cache (liquidator) VALUES ($1) ON CONFLICT DO NOTHING`,
          [liq]
        )
        console.log("— no funding source found")
        noSource++
      }
    } catch (e: any) {
      console.log(`✗ error: ${e?.message?.slice(0, 80)}`)
      failed++
    }

    // Rate limit: ~3 req/sec for Blockscout, ~5 for Etherscan
    await sleep(350)
  }

  console.log(`\n=== Backfill Complete ===`)
  console.log(`  Success: ${success}`)
  console.log(`  No source: ${noSource}`)
  console.log(`  Failed: ${failed}`)

  // Show total cached
  const finalCount = await pool.query(
    "SELECT COUNT(*) as cnt FROM funding_source_cache WHERE from_address IS NOT NULL"
  )
  console.log(`  Total cached (with source): ${finalCount.rows[0].cnt}`)

  await pool.end()
}

main().catch((e) => {
  console.error("Fatal:", e)
  pool.end().finally(() => process.exit(1))
})
