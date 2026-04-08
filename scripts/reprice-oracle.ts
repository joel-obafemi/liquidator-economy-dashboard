/**
 * Re-price all existing liquidation events using on-chain oracle prices.
 * Replaces DeFiLlama prices with exact Aave/Spark oracle prices at each block.
 *
 * Run with: npx tsx -r tsconfig-paths/register scripts/reprice-oracle.ts
 */
import { Pool } from "@neondatabase/serverless"
import { createPublicClient, http, fallback } from "viem"
import { mainnet } from "viem/chains"
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

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
    http("https://rpc.ankr.com/eth", { timeout: 30000 }),
    http("https://1rpc.io/eth", { timeout: 30000 }),
  ]),
  batch: { multicall: true },
})

const AAVE_ORACLE = "0x54586bE62E3c3580375aE3723C145253060Ca0C2"
const SPARK_ORACLE = "0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9"
const ORACLE_DECIMALS = 8

const ORACLE_ABI = [
  {
    type: "function" as const,
    name: "getAssetsPrices" as const,
    inputs: [{ name: "assets", type: "address[]" as const }],
    outputs: [{ type: "uint256[]" as const }],
    stateMutability: "view" as const,
  },
  {
    type: "function" as const,
    name: "getAssetPrice" as const,
    inputs: [{ name: "asset", type: "address" as const }],
    outputs: [{ type: "uint256" as const }],
    stateMutability: "view" as const,
  },
]

// Token decimals cache
const decimalsCache = new Map<string, number>()

async function loadDecimals() {
  const rows = await pool.query("SELECT address, decimals FROM token_metadata")
  for (const r of rows.rows) {
    decimalsCache.set(r.address, Number(r.decimals))
  }
  console.log(`Loaded ${decimalsCache.size} token decimals`)
}

async function getOraclePrices(
  oracleAddr: string,
  assets: string[],
  blockNumber: bigint
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const unique = [...new Set(assets.map(a => a.toLowerCase()))]

  try {
    const prices = await client.readContract({
      address: oracleAddr as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "getAssetsPrices",
      args: [unique as `0x${string}`[]],
      blockNumber,
    }) as bigint[]

    for (let i = 0; i < unique.length; i++) {
      if (prices[i] && prices[i] > 0n) {
        result.set(unique[i], Number(prices[i]) / (10 ** ORACLE_DECIMALS))
      }
    }
  } catch {
    // Fallback: individual calls
    for (const asset of unique) {
      try {
        const price = await client.readContract({
          address: oracleAddr as `0x${string}`,
          abi: ORACLE_ABI,
          functionName: "getAssetPrice",
          args: [asset as `0x${string}`],
          blockNumber,
        }) as bigint
        if (price && price > 0n) {
          result.set(asset, Number(price) / (10 ** ORACLE_DECIMALS))
        }
      } catch {}
    }
  }

  return result
}

async function main() {
  console.log("=== Re-pricing All Events Using On-Chain Oracle ===\n")

  await loadDecimals()

  const BATCH_SIZE = 200
  let offset = 0
  let totalUpdated = 0
  let totalErrors = 0
  let totalProcessed = 0

  while (true) {
    const rows = await pool.query(`
      SELECT id, protocol, block_number, collateral_asset, debt_asset,
             liquidated_collateral_amount::text as raw_coll,
             debt_to_cover::text as raw_debt,
             gas_cost_usd
      FROM liquidation_events
      ORDER BY block_number ASC
      LIMIT $1 OFFSET $2
    `, [BATCH_SIZE, offset])

    if (rows.rows.length === 0) break

    // Group by (protocol, block_number) for efficient oracle calls
    const byBlock = new Map<string, typeof rows.rows>()
    for (const r of rows.rows) {
      const key = `${r.protocol}:${r.block_number}`
      if (!byBlock.has(key)) byBlock.set(key, [])
      byBlock.get(key)!.push(r)
    }

    // Process 3 blocks in parallel
    const blockEntries = [...byBlock.entries()]
    const PARALLEL = 3

    for (let bi = 0; bi < blockEntries.length; bi += PARALLEL) {
      const blockBatch = blockEntries.slice(bi, bi + PARALLEL)

      await Promise.allSettled(
        blockBatch.map(async ([key, blockEvents]) => {
          const [protocol, blockNumStr] = key.split(":")
          const blockNum = BigInt(blockNumStr)
          const oracleAddr = protocol === "spark" ? SPARK_ORACLE : AAVE_ORACLE

          // Collect unique assets for this block
          const assets = new Set<string>()
          for (const e of blockEvents) {
            assets.add(e.collateral_asset)
            assets.add(e.debt_asset)
          }

          try {
            const prices = await getOraclePrices(oracleAddr, [...assets], blockNum)

            const updates: string[] = []
            for (const e of blockEvents) {
              const collDecimals = decimalsCache.get(e.collateral_asset) ?? 18
              const debtDecimals = decimalsCache.get(e.debt_asset) ?? 18
              const collPrice = prices.get(e.collateral_asset) ?? 0
              const debtPrice = prices.get(e.debt_asset) ?? 0

              if (collPrice === 0 && debtPrice === 0) {
                totalErrors++
                continue
              }

              const collAmount = Number(BigInt(e.raw_coll)) / (10 ** collDecimals)
              const debtAmount = Number(BigInt(e.raw_debt)) / (10 ** debtDecimals)
              const collUsd = collAmount * collPrice
              const debtUsd = debtAmount * debtPrice
              const grossProfit = collUsd - debtUsd
              const gasCost = Number(e.gas_cost_usd || 0)
              const netProfit = grossProfit - gasCost

              updates.push(`(${e.id}, ${debtUsd}, ${collUsd}, ${grossProfit}, ${netProfit})`)
              totalUpdated++
            }

            if (updates.length > 0) {
              await pool.query(`
                UPDATE liquidation_events AS le
                SET debt_amount_usd = u.debt_usd,
                    collateral_amount_usd = u.coll_usd,
                    gross_profit_usd = u.profit,
                    net_profit_usd = u.net_profit
                FROM (VALUES ${updates.join(",")}) AS u(id, debt_usd, coll_usd, profit, net_profit)
                WHERE le.id = u.id::int
              `)
            }
          } catch (err: any) {
            totalErrors += blockEvents.length
          }
        })
      )
    }

    totalProcessed += rows.rows.length
    offset += rows.rows.length

    if (totalProcessed % 1000 === 0 || rows.rows.length < BATCH_SIZE) {
      console.log(`  Processed: ${totalProcessed}, Updated: ${totalUpdated}, Errors: ${totalErrors}`)
    }

    if (rows.rows.length < BATCH_SIZE) break
  }

  console.log(`\n=== Re-pricing Complete ===`)
  console.log(`Processed: ${totalProcessed}`)
  console.log(`Updated: ${totalUpdated}`)
  console.log(`Errors: ${totalErrors}`)

  // Verify against Sentora
  const top = await pool.query(`
    SELECT liquidator, COUNT(*) as cnt, SUM(gross_profit_usd) as profit
    FROM liquidation_events WHERE protocol = 'aave_v3'
    GROUP BY liquidator ORDER BY profit DESC LIMIT 5
  `)
  console.log(`\nTop 5 Aave V3 liquidators (oracle prices):`)
  for (const r of top.rows) {
    console.log(`  ${r.liquidator}: ${r.cnt} events, $${Number(r.profit).toFixed(2)}`)
  }

  // Specific checks
  const check1 = await pool.query(`
    SELECT COUNT(*) as cnt, SUM(gross_profit_usd) as profit
    FROM liquidation_events WHERE liquidator = '0xf0570ec48d03171a80ff796dceadf0d385a00004' AND protocol = 'aave_v3'
  `)
  console.log(`\n0xf0...0004: ${check1.rows[0].cnt} events, $${Number(check1.rows[0].profit).toFixed(2)} (Sentora: $23,645,534.51)`)

  const check2 = await pool.query(`
    SELECT COUNT(*) as cnt, SUM(gross_profit_usd) as profit
    FROM liquidation_events WHERE liquidator = '0x00000000009e50a7ddb7a7b0e2ee6604fd120e49' AND protocol = 'aave_v3'
  `)
  console.log(`0x00...0e49: ${check2.rows[0].cnt} events, $${Number(check2.rows[0].profit).toFixed(2)} (Sentora: $7,089,523.67)`)

  // Total stats
  const totals = await pool.query(`
    SELECT protocol, COUNT(*) as cnt, SUM(gross_profit_usd) as profit,
           SUM(collateral_amount_usd) as volume,
           COUNT(*) FILTER (WHERE collateral_amount_usd = 0) as zero_price
    FROM liquidation_events GROUP BY protocol
  `)
  console.log(`\nTotals:`)
  for (const r of totals.rows) {
    console.log(`  ${r.protocol}: ${r.cnt} events, $${Number(r.profit).toFixed(2)} profit, $${Number(r.volume).toFixed(2)} volume, ${r.zero_price} zero-price`)
  }

  await pool.end()
}

main().catch(e => {
  console.error("Fatal:", e)
  pool.end().finally(() => process.exit(1))
})
