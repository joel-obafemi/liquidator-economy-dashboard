/**
 * Failed-liquidation count for rsETH on Aave V3 during the depeg window.
 *
 * Uses Etherscan's txlist endpoint to fetch every transaction sent to the
 * Aave V3 Pool address during the event window, filters for failed status
 * (isError=1) AND for the liquidationCall function selector, then decodes
 * each call to check whether the collateral or debt asset is rsETH.
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/fetch-failed-rseth-liquidations.ts schema
 *   npx tsx -r tsconfig-paths/register scripts/fetch-failed-rseth-liquidations.ts fetch
 *   npx tsx -r tsconfig-paths/register scripts/fetch-failed-rseth-liquidations.ts update
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

const AAVE_V3_POOL = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2"
const RSETH = "0xa1290d69c65a6fe4df752f95823fae25cb99e5a7"
// liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)
const LIQUIDATION_CALL_SELECTOR = "0x00a718a9"

// Event window
const WINDOW_START = Math.floor(new Date("2026-04-18T00:00:00Z").getTime() / 1000)
const WINDOW_END = Math.floor(new Date("2026-04-25T23:59:59Z").getTime() / 1000)

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || ""
const ETHERSCAN_BASE = "https://api.etherscan.io/api"

const SCRATCH_FILE = path.resolve(__dirname, "../.failed-rseth-scratch.json")

interface FailedTx {
  hash: string
  blockNumber: number
  timestamp: number
  from: string
  to: string
  input: string
  collateralAsset: string
  debtAsset: string
  user: string
  debtToCover: string
  involvesRseth: boolean
  gasUsed: number
  gasPrice: string
  gasCostEth: number
}

function decodeLiqCall(input: string): {
  collateralAsset: string
  debtAsset: string
  user: string
  debtToCover: string
} | null {
  if (!input.toLowerCase().startsWith(LIQUIDATION_CALL_SELECTOR)) return null
  // 5 args, all uint256 / address; ABI-encoded
  const data = input.slice(10) // strip selector
  if (data.length < 64 * 4) return null
  const collateralAsset = "0x" + data.slice(64 - 40, 64).toLowerCase()
  const debtAsset = "0x" + data.slice(128 - 40, 128).toLowerCase()
  const user = "0x" + data.slice(192 - 40, 192).toLowerCase()
  const debtToCover = BigInt("0x" + data.slice(192, 256)).toString()
  return { collateralAsset, debtAsset, user, debtToCover }
}

async function getBlockForTimestamp(ts: number): Promise<number> {
  const url = `${ETHERSCAN_BASE}?module=block&action=getblocknobytime&timestamp=${ts}&closest=before${ETHERSCAN_KEY ? `&apikey=${ETHERSCAN_KEY}` : ""}`
  const r = await fetch(url)
  const j = (await r.json()) as any
  if (j.status !== "1") {
    throw new Error("Etherscan block lookup: " + j.message + " — " + j.result)
  }
  return Number(j.result)
}

async function fetchTxList(
  startBlock: number,
  endBlock: number,
  page: number,
  offset: number
): Promise<any[]> {
  const url = `${ETHERSCAN_BASE}?module=account&action=txlist&address=${AAVE_V3_POOL}&startblock=${startBlock}&endblock=${endBlock}&page=${page}&offset=${offset}&sort=asc${ETHERSCAN_KEY ? `&apikey=${ETHERSCAN_KEY}` : ""}`
  const r = await fetch(url)
  const j = (await r.json()) as any
  if (j.status === "0" && j.message === "No transactions found") return []
  if (j.status !== "1") {
    throw new Error("Etherscan txlist: " + j.message + " — " + JSON.stringify(j.result).slice(0, 200))
  }
  return j.result || []
}

async function fetch_() {
  console.log("=== Fetch failed liquidationCall txs to Aave V3 Pool ===")
  if (!ETHERSCAN_KEY) {
    console.warn(
      "  WARN: no ETHERSCAN_API_KEY set — using public rate-limited endpoint (~1 req / 5s)"
    )
  }

  console.log(`  Window: ${new Date(WINDOW_START * 1000).toISOString()} → ${new Date(WINDOW_END * 1000).toISOString()}`)
  const startBlock = await getBlockForTimestamp(WINDOW_START)
  await new Promise((r) => setTimeout(r, ETHERSCAN_KEY ? 250 : 5000))
  const endBlock = await getBlockForTimestamp(WINDOW_END)
  console.log(`  Block range: ${startBlock} → ${endBlock}`)

  const failedRsethTxs: FailedTx[] = []
  const allTxStats = {
    total: 0,
    failed: 0,
    failedLiquidationCall: 0,
    failedRseth: 0,
  }

  // Etherscan returns up to 10000 per page; paginate
  const PAGE_SIZE = 10000
  let page = 1
  while (true) {
    const txs = await fetchTxList(startBlock, endBlock, page, PAGE_SIZE)
    if (txs.length === 0) break
    allTxStats.total += txs.length
    for (const tx of txs) {
      if (tx.isError !== "1") continue
      allTxStats.failed++
      const decoded = decodeLiqCall(tx.input || "0x")
      if (!decoded) continue
      allTxStats.failedLiquidationCall++
      const involvesRseth =
        decoded.collateralAsset === RSETH || decoded.debtAsset === RSETH
      if (involvesRseth) allTxStats.failedRseth++
      // Keep ALL failed liquidationCall attempts (so we can show systemwide
      // context too) — flag rsETH-specific ones.
      const gasUsed = Number(tx.gasUsed)
      const gasPrice = String(tx.gasPrice)
      const gasCostEth = (gasUsed * Number(gasPrice)) / 1e18
      failedRsethTxs.push({
        hash: tx.hash,
        blockNumber: Number(tx.blockNumber),
        timestamp: Number(tx.timeStamp),
        from: tx.from.toLowerCase(),
        to: tx.to.toLowerCase(),
        input: tx.input,
        collateralAsset: decoded.collateralAsset,
        debtAsset: decoded.debtAsset,
        user: decoded.user,
        debtToCover: decoded.debtToCover,
        involvesRseth,
        gasUsed,
        gasPrice,
        gasCostEth,
      })
    }
    console.log(
      `  page ${page}: ${txs.length} txs · cumulative: total=${allTxStats.total} failed=${allTxStats.failed} failed_liqCall=${allTxStats.failedLiquidationCall} failed_rseth=${allTxStats.failedRseth}`
    )
    if (txs.length < PAGE_SIZE) break
    page++
    await new Promise((r) => setTimeout(r, ETHERSCAN_KEY ? 220 : 5000))
  }

  fs.writeFileSync(
    SCRATCH_FILE,
    JSON.stringify({ stats: allTxStats, txs: failedRsethTxs }, null, 2)
  )
  console.log(`\n  Wrote ${failedRsethTxs.length} failed liquidationCall txs to scratch`)
  console.log(`  Of those: ${allTxStats.failedRseth} involve rsETH`)
}

async function schema() {
  console.log("=== Schema migration ===")
  const pool = new Pool({ connectionString: dbUrl })
  await pool.query(`
    CREATE TABLE IF NOT EXISTS failed_liquidation_attempts (
      tx_hash TEXT PRIMARY KEY,
      block_number BIGINT NOT NULL,
      block_timestamp BIGINT NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      collateral_asset TEXT NOT NULL,
      debt_asset TEXT NOT NULL,
      borrower TEXT NOT NULL,
      debt_to_cover NUMERIC,
      involves_rseth BOOLEAN NOT NULL,
      gas_used BIGINT,
      gas_price NUMERIC,
      gas_cost_eth DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_failed_liq_rseth ON failed_liquidation_attempts(involves_rseth) WHERE involves_rseth = true`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_failed_liq_ts ON failed_liquidation_attempts(block_timestamp)`
  )
  console.log("  failed_liquidation_attempts table ready")
  await pool.end()
}

async function update() {
  console.log("=== Apply failed-liq results to DB ===")
  if (!fs.existsSync(SCRATCH_FILE)) {
    console.error("No scratch file. Run 'fetch' first.")
    process.exit(1)
  }
  const data = JSON.parse(fs.readFileSync(SCRATCH_FILE, "utf8"))
  const txs: FailedTx[] = data.txs || []
  console.log(`  ${txs.length} failed liquidationCall txs to upsert`)

  const pool = new Pool({ connectionString: dbUrl })
  const BATCH = 100
  let upserted = 0
  for (let i = 0; i < txs.length; i += BATCH) {
    const chunk = txs.slice(i, i + BATCH)
    const values = chunk
      .map(
        (_, idx) =>
          `($${idx * 12 + 1}, $${idx * 12 + 2}::bigint, $${idx * 12 + 3}::bigint, $${idx * 12 + 4}, $${idx * 12 + 5}, $${idx * 12 + 6}, $${idx * 12 + 7}, $${idx * 12 + 8}, $${idx * 12 + 9}::numeric, $${idx * 12 + 10}, $${idx * 12 + 11}::bigint, $${idx * 12 + 12}::numeric)`
      )
      .join(",")
    const params: any[] = []
    for (const t of chunk) {
      params.push(
        t.hash.toLowerCase(),
        t.blockNumber,
        t.timestamp,
        t.from,
        t.to,
        t.collateralAsset,
        t.debtAsset,
        t.user,
        t.debtToCover,
        t.involvesRseth,
        t.gasUsed,
        t.gasPrice
      )
    }
    const r = await pool.query(
      `INSERT INTO failed_liquidation_attempts (
         tx_hash, block_number, block_timestamp, from_address, to_address,
         collateral_asset, debt_asset, borrower, debt_to_cover, involves_rseth,
         gas_used, gas_price
       ) VALUES ${values}
       ON CONFLICT (tx_hash) DO UPDATE SET
         block_number = EXCLUDED.block_number,
         block_timestamp = EXCLUDED.block_timestamp,
         involves_rseth = EXCLUDED.involves_rseth,
         gas_used = EXCLUDED.gas_used`,
      params
    )
    upserted += r.rowCount || 0
  }
  // Compute gas_cost_eth in a follow-up update for clarity
  await pool.query(
    `UPDATE failed_liquidation_attempts
     SET gas_cost_eth = (gas_used::double precision * gas_price::double precision) / 1e18
     WHERE gas_cost_eth IS NULL AND gas_used IS NOT NULL AND gas_price IS NOT NULL`
  )
  console.log(`  Upserted ${upserted} rows`)

  const r1 = (
    await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE involves_rseth)::int as rseth_count,
      COUNT(*)::int as total,
      COALESCE(SUM(gas_cost_eth) FILTER (WHERE involves_rseth), 0) as rseth_gas_eth,
      COUNT(DISTINCT from_address) FILTER (WHERE involves_rseth)::int as rseth_distinct_from,
      MIN(block_timestamp) FILTER (WHERE involves_rseth) as rseth_first,
      MAX(block_timestamp) FILTER (WHERE involves_rseth) as rseth_last
    FROM failed_liquidation_attempts
  `)
  ).rows[0]
  console.log(`\n=== RESULTS ===`)
  console.log(`Failed liquidationCall txs total: ${r1.total}`)
  console.log(`  rsETH-related: ${r1.rseth_count} (${r1.rseth_distinct_from} distinct senders)`)
  console.log(`  Total ETH burned on rsETH attempts: ${Number(r1.rseth_gas_eth).toFixed(4)} ETH`)
  if (r1.rseth_first) {
    console.log(
      `  First rsETH attempt: ${new Date(Number(r1.rseth_first) * 1000).toISOString()}`
    )
    console.log(
      `  Last rsETH attempt: ${new Date(Number(r1.rseth_last) * 1000).toISOString()}`
    )
  }
  await pool.end()
}

async function main() {
  const arg = process.argv[2]
  if (arg === "schema") await schema()
  else if (arg === "fetch") await fetch_()
  else if (arg === "update") await update()
  else {
    console.log("Usage: fetch-failed-rseth-liquidations.ts [schema|fetch|update]")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e)
  process.exit(1)
})
