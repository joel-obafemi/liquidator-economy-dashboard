/**
 * Backfill gas cost data for existing liquidation events.
 * Fetches transaction receipts to get gasUsed + effectiveGasPrice,
 * then converts to USD using ETH price at that timestamp.
 *
 * Run with: npx tsx -r tsconfig-paths/register scripts/backfill-gas.ts
 */
import { Pool } from "@neondatabase/serverless"
import { createPublicClient, http, fallback } from "viem"
import { mainnet } from "viem/chains"
import * as fs from "fs"
import * as path from "path"

// Load .env.local
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

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
    http("https://rpc.ankr.com/eth", { timeout: 30000 }),
  ]),
})

const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

function roundToHour(ts: number): number {
  return Math.floor(ts / 3600) * 3600
}

async function getEthPrice(timestamp: number): Promise<number> {
  const hourTs = roundToHour(timestamp)

  // Check DB cache first
  const cached = await pool.query(
    "SELECT price_usd FROM price_cache WHERE token_address = $1 AND timestamp = $2",
    [WETH, hourTs]
  )
  if (cached.rows.length > 0) return Number(cached.rows[0].price_usd)

  // Fetch from DeFiLlama
  try {
    const url = `https://coins.llama.fi/prices/historical/${hourTs}/ethereum:${WETH}?searchWidth=6h`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const price = data.coins?.[`ethereum:${WETH}`]?.price
      if (typeof price === "number" && price > 0) {
        await pool.query(
          "INSERT INTO price_cache (token_address, timestamp, price_usd, source) VALUES ($1, $2, $3, 'defillama') ON CONFLICT DO NOTHING",
          [WETH, hourTs, price]
        )
        return price
      }
    }
  } catch {}

  return 0
}

// Try fetching a receipt with retries across different RPCs
async function getReceiptWithRetry(txHash: `0x${string}`, retries = 3): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await client.getTransactionReceipt({ hash: txHash })
    } catch (e: any) {
      if (attempt === retries - 1) throw e
      // Wait longer between retries
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

async function main() {
  console.log("=== Backfilling Gas Costs ===\n")

  // Check how many need backfilling
  const countResult = await pool.query(
    "SELECT COUNT(*)::int as cnt FROM liquidation_events WHERE gas_used IS NULL"
  )
  const totalNeeded = countResult.rows[0].cnt
  console.log(`  Events needing gas data: ${totalNeeded}\n`)

  const BATCH_SIZE = 50
  const MAX_PASSES = 3   // retry failed events up to 3 passes
  let totalUpdated = 0
  let totalErrors = 0

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    let passUpdated = 0
    let passErrors = 0

    if (pass > 1) {
      console.log(`\n--- Retry pass ${pass}/${MAX_PASSES} ---`)
    }

    while (true) {
      // No OFFSET: successful updates remove rows from the result set,
      // so we always query from the top. Failed rows reappear naturally.
      const rows = await pool.query(
        `SELECT id, tx_hash, block_timestamp FROM liquidation_events
         WHERE gas_used IS NULL
         ORDER BY block_number ASC
         LIMIT $1`,
        [BATCH_SIZE]
      )

      if (rows.rows.length === 0) break

      const PARALLEL = 5
      let batchUpdated = 0

      for (let i = 0; i < rows.rows.length; i += PARALLEL) {
        const batch = rows.rows.slice(i, i + PARALLEL)

        await Promise.allSettled(
          batch.map(async (row: any) => {
            try {
              const receipt = await getReceiptWithRetry(row.tx_hash as `0x${string}`)

              const gasUsed = Number(receipt.gasUsed)
              const effectiveGasPrice = Number(receipt.effectiveGasPrice)
              const gasCostEth = (gasUsed * effectiveGasPrice) / 1e18
              const gasPriceGwei = effectiveGasPrice / 1e9

              const ethPrice = await getEthPrice(Number(row.block_timestamp))
              const gasCostUsd = gasCostEth * ethPrice

              await pool.query(
                `UPDATE liquidation_events
                 SET gas_used = $1, gas_price_gwei = $2, gas_cost_eth = $3, gas_cost_usd = $4,
                     net_profit_usd = gross_profit_usd - $4
                 WHERE id = $5`,
                [gasUsed, gasPriceGwei, gasCostEth, gasCostUsd, row.id]
              )
              totalUpdated++
              passUpdated++
              batchUpdated++
            } catch (e: any) {
              totalErrors++
              passErrors++
            }
          })
        )

        // Rate limit
        await new Promise((r) => setTimeout(r, 300))
      }

      console.log(`  Progress: ${totalUpdated} updated, ${totalErrors} errors (pass ${pass})`)

      // If no updates in this batch, all remaining are failing — move to next pass
      if (batchUpdated === 0) break
    }

    console.log(`  Pass ${pass} complete: +${passUpdated} updated, ${passErrors} errors`)

    // If nothing updated this pass, remaining events are truly unreachable
    if (passUpdated === 0) {
      console.log("  No new updates this pass — stopping retries.")
      break
    }
  }

  console.log(`\n=== Gas Backfill Complete ===`)
  console.log(`Updated: ${totalUpdated}, Errors: ${totalErrors}`)

  // Summary stats
  const stats = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(gas_used) as with_gas,
      AVG(gas_cost_usd) as avg_gas_usd,
      SUM(gas_cost_usd) as total_gas_usd,
      COUNT(CASE WHEN net_profit_usd < 0 THEN 1 END) as unprofitable,
      COUNT(CASE WHEN net_profit_usd >= 0 THEN 1 END) as profitable
    FROM liquidation_events
    WHERE gas_used IS NOT NULL
  `)
  const s = stats.rows[0]
  console.log(`\nWith gas data: ${s.with_gas}/${s.total}`)
  console.log(`Avg gas cost: $${Number(s.avg_gas_usd).toFixed(2)}`)
  console.log(`Total gas spent: $${Number(s.total_gas_usd).toFixed(2)}`)
  console.log(`Profitable after gas: ${s.profitable} (${((s.profitable / s.with_gas) * 100).toFixed(1)}%)`)
  console.log(`Unprofitable after gas: ${s.unprofitable} (${((s.unprofitable / s.with_gas) * 100).toFixed(1)}%)`)

  await pool.end()
}

main().catch((e) => {
  console.error("Fatal:", e)
  pool.end().finally(() => process.exit(1))
})
