/**
 * Hourly bad-debt formation curve for rsETH on Aave V3.
 *
 * Pipeline:
 *   1. discover — scan aRsETH Transfer events to find every address that has
 *      ever held rsETH as collateral on Aave V3
 *   2. snapshot — for each hourly block in the analysis window, query each
 *      candidate's getUserAccountData via batched JSON-RPC and aggregate
 *      total collateral, total debt, and bad-debt exposure (where debt > collateral)
 *   3. update — write hourly aggregates to rseth_hourly_snapshots
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/snapshot-rseth-aave.ts schema
 *   npx tsx -r tsconfig-paths/register scripts/snapshot-rseth-aave.ts discover
 *   npx tsx -r tsconfig-paths/register scripts/snapshot-rseth-aave.ts snapshot
 */
import { Pool, neon } from "@neondatabase/serverless"
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
const RPC = process.env.ALCHEMY_RPC_URL
if (!RPC) {
  console.error("ALCHEMY_RPC_URL is required for archive queries.")
  process.exit(1)
}

// ─── Aave V3 + rsETH addresses ──────────────────────────────────────────────
const AAVE_POOL = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2"
const RSETH = "0xa1290d69c65a6fe4df752f95823fae25cb99e5a7"
const ARSETH = "0x2d62109243b87c4ba3ee7ba1d91b0dd0a074d7b1"

// Function selectors (first 4 bytes of keccak256 of canonical signatures).
// getUserAccountData(address)(uint256,uint256,uint256,uint256,uint256,uint256)
const GET_USER_ACCOUNT_DATA = "0xbf92857c"
// getReserveData(address) — just for sanity / reuse
const GET_RESERVE_DATA = "0x35ea6a75"

// Transfer(address,address,uint256) event topic
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

// Analysis window — trimmed to a tight band around the rsETH depeg
// (Apr 18-25, 2026): 12h pre-event baseline + the event window + 12h after.
const WINDOW_START = Math.floor(new Date("2026-04-17T12:00:00Z").getTime() / 1000)
const WINDOW_END = Math.floor(new Date("2026-04-26T00:00:00Z").getTime() / 1000)

// Snapshot cadence (seconds). 3600 = hourly.
const SNAPSHOT_INTERVAL = 3600

const SCRATCH_FILE = path.resolve(__dirname, "../.rseth-snapshot-scratch.json")

interface Scratch {
  users?: string[]
  /** Map of "block_number" → snapshot result so we can resume on crashes. */
  snapshots?: Record<
    string,
    {
      blockNumber: number
      blockTimestamp: number
      totalCollateralUsd: number
      totalDebtUsd: number
      badDebtUsd: number
      underwaterUsers: number
      activeUsers: number
    }
  >
}

function readScratch(): Scratch {
  if (!fs.existsSync(SCRATCH_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(SCRATCH_FILE, "utf8"))
  } catch {
    return {}
  }
}
function writeScratch(s: Scratch) {
  fs.writeFileSync(SCRATCH_FILE, JSON.stringify(s, null, 2))
}

async function rpc<T = any>(method: string, params: any[]): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(RPC!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(20000),
      })
      const j = (await r.json()) as any
      if (j.error) {
        if (attempt < 4) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
          continue
        }
        throw new Error(j.error.message || JSON.stringify(j.error))
      }
      return j.result as T
    } catch (e) {
      if (attempt === 4) throw e
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw new Error("rpc unreachable")
}

async function rpcBatch<T = any>(
  calls: { method: string; params: any[] }[]
): Promise<T[]> {
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    method: c.method,
    params: c.params,
    id: i,
  }))
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(RPC!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      })
      const arr = (await r.json()) as any[]
      const sorted = arr.sort((a, b) => a.id - b.id)
      const results: T[] = sorted.map((j) => {
        if (j.error)
          throw new Error("Batch item " + j.id + ": " + (j.error.message || "rpc err"))
        return j.result
      })
      return results
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  throw new Error("rpc batch unreachable")
}

function padAddr(a: string): string {
  return "0x" + "0".repeat(24) + a.toLowerCase().replace(/^0x/, "")
}

function hexToBigInt(h: string): bigint {
  return BigInt(h)
}

/** Convert Aave's "base" units to USD (Aave V3 base price unit is 1e8). */
function baseToUsd(b: bigint): number {
  return Number(b) / 1e8
}

// ─── Step 1: discover rsETH suppliers ───────────────────────────────────────
async function discover() {
  console.log("=== Discover rsETH suppliers (alchemy_getAssetTransfers) ===")

  // Alchemy's free tier caps eth_getLogs at 10-block ranges, so we use the
  // enhanced alchemy_getAssetTransfers endpoint which supports unlimited
  // block ranges and is purpose-built for this kind of scan.

  const users = new Set<string>()
  const fromAddrs = new Set<string>()

  // We scan the ENTIRE history of aRsETH transfers. The list is small enough
  // (rsETH was listed on Aave in 2024) that one paginated scan is fast.
  let pageKey: string | undefined = undefined
  let pages = 0
  while (true) {
    const params: any = {
      fromBlock: "0x0",
      toBlock: "latest",
      contractAddresses: [ARSETH],
      category: ["erc20"],
      maxCount: "0x3e8", // 1000
      order: "asc",
      withMetadata: false,
    }
    if (pageKey) params.pageKey = pageKey

    const res = await rpc<{ transfers: any[]; pageKey?: string }>(
      "alchemy_getAssetTransfers",
      [params]
    )

    for (const t of res.transfers || []) {
      const to = (t.to || "").toLowerCase()
      const from = (t.from || "").toLowerCase()
      // Track recipients (suppliers) and senders (in case of withdrawals or
      // transfers between users — we want everyone who has touched aRsETH).
      if (to && to !== "0x0000000000000000000000000000000000000000") {
        users.add(to)
      }
      if (from && from !== "0x0000000000000000000000000000000000000000") {
        fromAddrs.add(from)
      }
    }
    pages++
    console.log(
      `  page ${pages}: +${res.transfers?.length || 0} transfers · cumulative users=${users.size}`
    )
    if (!res.pageKey) break
    pageKey = res.pageKey
    await new Promise((r) => setTimeout(r, 250))
  }

  // Union of all addresses that have ever held aRsETH (suppliers) or sent it
  // (withdrawers / transferers).
  for (const a of fromAddrs) users.add(a)
  // Filter out the aRsETH contract itself if it appears
  users.delete(ARSETH.toLowerCase())

  const arr = Array.from(users).sort()
  console.log(`  Discovered ${arr.length} unique candidate users`)
  const scratch = readScratch()
  scratch.users = arr
  writeScratch(scratch)
}

/** Binary search for the first block at or after a given timestamp. */
async function blockAtTimestamp(ts: number, latestBlock: number): Promise<number> {
  let lo = 1
  let hi = latestBlock
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const block = await rpc<any>("eth_getBlockByNumber", [
      "0x" + mid.toString(16),
      false,
    ])
    const blockTs = Number(BigInt(block.timestamp))
    if (blockTs < ts) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ─── Step 2: hourly snapshots ───────────────────────────────────────────────
async function snapshot() {
  console.log("=== Hourly snapshots of rsETH bad-debt formation ===")
  const scratch = readScratch()
  const users = scratch.users
  if (!users || users.length === 0) {
    console.error("No users discovered. Run 'discover' first.")
    process.exit(1)
  }
  console.log(`  ${users.length} candidate users`)

  // Build hourly timestamps within the window
  const hours: number[] = []
  for (let t = WINDOW_START; t <= WINDOW_END; t += SNAPSHOT_INTERVAL) hours.push(t)
  console.log(
    `  ${hours.length} hourly snapshots from ${new Date(WINDOW_START * 1000).toISOString()} to ${new Date(WINDOW_END * 1000).toISOString()}`
  )

  // Latest block for bounds
  const latestHex = await rpc<string>("eth_blockNumber", [])
  const latestBlock = Number(BigInt(latestHex))
  console.log(`  Latest block: ${latestBlock}`)

  // Single binary search to anchor WINDOW_START → block, then estimate every
  // subsequent hour at +300 blocks (Ethereum produces a block ~every 12s).
  // This avoids 312 binary searches that would otherwise dominate runtime.
  console.log("  Anchoring window-start block via binary search…")
  const anchorBlock = await blockAtTimestamp(WINDOW_START, latestBlock)
  console.log(`  Anchor block at ${new Date(WINDOW_START * 1000).toISOString()}: ${anchorBlock}`)
  const BLOCKS_PER_HOUR = 300
  const blockForHour = (ts: number): number => {
    const hoursFromAnchor = Math.round((ts - WINDOW_START) / 3600)
    return anchorBlock + hoursFromAnchor * BLOCKS_PER_HOUR
  }

  scratch.snapshots = scratch.snapshots || {}

  // Filter to hours we haven't already snapshot
  const remaining = hours.filter((t) => !scratch.snapshots![String(t)])
  console.log(`  ${remaining.length} hours remaining to snapshot`)

  for (const ts of remaining) {
    const blockNum = blockForHour(ts)
    const blockHex = "0x" + blockNum.toString(16)

    // Build batched calls: getUserAccountData(user) for each candidate.
    // Batch size + inter-batch delay tuned to stay under Alchemy's free-tier
    // 300 CU/sec cap (each eth_call ≈ 26 CU). 10 calls per batch × 26 CU =
    // 260 CU per batch; 350 ms between batches → ~3 batches/sec → ~780 CU/sec
    // peak with retries spreading the load. The retry logic in rpcBatch
    // covers transient bursts.
    const BATCH = 10
    let totalCollateralBase = 0n
    let totalDebtBase = 0n
    let badDebtBase = 0n
    let underwater = 0
    let active = 0
    let batchFailures = 0

    for (let i = 0; i < users.length; i += BATCH) {
      const chunk = users.slice(i, i + BATCH)
      const calls = chunk.map((u) => ({
        method: "eth_call",
        params: [
          {
            to: AAVE_POOL,
            data: GET_USER_ACCOUNT_DATA + padAddr(u).slice(2),
          },
          blockHex,
        ],
      }))
      let results: string[] = []
      try {
        results = await rpcBatch<string>(calls)
      } catch (e: any) {
        // After exhausting retries inside rpcBatch, give up on this batch but
        // back off significantly before the next batch — usually it's a CU
        // rate limit and a longer pause is what fixes it.
        batchFailures++
        await new Promise((r) => setTimeout(r, 5000))
        continue
      }
      for (let k = 0; k < results.length; k++) {
        const r = results[k]
        if (!r || r === "0x") continue
        const collateral = hexToBigInt("0x" + r.slice(2 + 0, 2 + 64))
        const debt = hexToBigInt("0x" + r.slice(2 + 64, 2 + 128))
        if (collateral === 0n && debt === 0n) continue
        active++
        totalCollateralBase += collateral
        totalDebtBase += debt
        if (debt > collateral) {
          badDebtBase += debt - collateral
          underwater++
        }
      }
      // 1 sec inter-batch ≈ 260 CU/sec which sits comfortably under
      // Alchemy free-tier's 330 CU/sec cap.
      await new Promise((r) => setTimeout(r, 1000))
    }

    // Don't drop hours over partial failures — record what we got and tag the
    // snapshot with active_users count so the chart can flag low-coverage rows.
    // If failures were CATASTROPHIC (>50%) we still skip and retry later.
    const totalBatches = Math.ceil(users.length / BATCH)
    if (batchFailures / totalBatches > 0.5) {
      const dt = new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ")
      console.log(
        `  ${dt}Z block ${blockNum} | SKIPPED — ${batchFailures}/${totalBatches} batches failed (>50%)`
      )
      continue
    }

    const totalCollateralUsd = baseToUsd(totalCollateralBase)
    const totalDebtUsd = baseToUsd(totalDebtBase)
    const badDebtUsd = baseToUsd(badDebtBase)

    scratch.snapshots[String(ts)] = {
      blockNumber: blockNum,
      blockTimestamp: ts,
      totalCollateralUsd,
      totalDebtUsd,
      badDebtUsd,
      underwaterUsers: underwater,
      activeUsers: active,
    }
    writeScratch(scratch)

    const dt = new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ")
    console.log(
      `  ${dt}Z block ${blockNum} | collateral=$${totalCollateralUsd.toFixed(0)} debt=$${totalDebtUsd.toFixed(0)} bad=$${badDebtUsd.toFixed(0)} underwater=${underwater}/${active}`
    )
  }
}

// ─── Step 3: update DB ──────────────────────────────────────────────────────
async function schema() {
  console.log("=== Schema migration ===")
  const pool = new Pool({ connectionString: dbUrl })
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rseth_hourly_snapshots (
      block_timestamp BIGINT PRIMARY KEY,
      block_number BIGINT NOT NULL,
      total_collateral_usd DOUBLE PRECISION NOT NULL,
      total_debt_usd DOUBLE PRECISION NOT NULL,
      bad_debt_usd DOUBLE PRECISION NOT NULL,
      underwater_users INTEGER NOT NULL,
      active_users INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_rseth_snap_block ON rseth_hourly_snapshots(block_number)`
  )
  console.log("  rseth_hourly_snapshots table ready")
  await pool.end()
}

async function update() {
  console.log("=== Apply snapshots to DB ===")
  const scratch = readScratch()
  const snaps = Object.values(scratch.snapshots || {})
  if (snaps.length === 0) {
    console.error("No snapshots to apply.")
    process.exit(1)
  }
  console.log(`  ${snaps.length} snapshots to upsert`)

  // Use Neon's HTTP-over-fetch mode — works even when WebSocket pooler is
  // unreachable, and these are one-shot bulk upserts (no need for a pool).
  const sqlHttp = neon(dbUrl)
  const exec = async (text: string, params: any[] = []) =>
    (sqlHttp as any).query(text, params)

  const BATCH = 100
  let upserted = 0
  for (let i = 0; i < snaps.length; i += BATCH) {
    const chunk = snaps.slice(i, i + BATCH)
    const values = chunk
      .map(
        (_, idx) =>
          `($${idx * 7 + 1}::bigint, $${idx * 7 + 2}::bigint, $${idx * 7 + 3}, $${idx * 7 + 4}, $${idx * 7 + 5}, $${idx * 7 + 6}, $${idx * 7 + 7})`
      )
      .join(",")
    const params: any[] = []
    for (const s of chunk) {
      params.push(
        s.blockTimestamp,
        s.blockNumber,
        s.totalCollateralUsd,
        s.totalDebtUsd,
        s.badDebtUsd,
        s.underwaterUsers,
        s.activeUsers
      )
    }
    const rows = await exec(
      `INSERT INTO rseth_hourly_snapshots
         (block_timestamp, block_number, total_collateral_usd, total_debt_usd,
          bad_debt_usd, underwater_users, active_users)
       VALUES ${values}
       ON CONFLICT (block_timestamp) DO UPDATE SET
         block_number = EXCLUDED.block_number,
         total_collateral_usd = EXCLUDED.total_collateral_usd,
         total_debt_usd = EXCLUDED.total_debt_usd,
         bad_debt_usd = EXCLUDED.bad_debt_usd,
         underwater_users = EXCLUDED.underwater_users,
         active_users = EXCLUDED.active_users
       RETURNING block_timestamp`,
      params
    )
    upserted += Array.isArray(rows) ? rows.length : 0
  }
  console.log(`  Upserted ${upserted} rows`)

  const stats = await exec(`
    SELECT MIN(block_timestamp) as t0, MAX(block_timestamp) as t1,
           MAX(bad_debt_usd) as peak_bad_debt,
           MAX(underwater_users) as peak_underwater,
           SUM(bad_debt_usd) as auc_bad_debt
    FROM rseth_hourly_snapshots`)
  const s = stats[0]
  console.log(
    `\nSnapshot range: ${new Date(Number(s.t0) * 1000).toISOString()} → ${new Date(Number(s.t1) * 1000).toISOString()}`
  )
  console.log(`Peak bad debt: $${Number(s.peak_bad_debt).toFixed(0)}`)
  console.log(`Peak underwater users: ${s.peak_underwater}`)
}

async function main() {
  const arg = process.argv[2]
  if (arg === "schema") await schema()
  else if (arg === "discover") await discover()
  else if (arg === "snapshot") await snapshot()
  else if (arg === "update") await update()
  else {
    console.log("Usage: snapshot-rseth-aave.ts [schema|discover|snapshot|update]")
    console.log("  schema   — create rseth_hourly_snapshots table")
    console.log("  discover — find all rsETH-collateralized users (aRsETH Transfers)")
    console.log("  snapshot — for each hour in window, query each user's account data")
    console.log("  update   — write hourly aggregates to DB")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e)
  process.exit(1)
})
