/**
 * Dump the rseth snapshot scratch file as a single .sql file ready to paste
 * into Neon's web SQL editor. Workaround for when local Node fetch can't
 * reach Neon but the browser can.
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/dump-rseth-snapshots-sql.ts
 *
 * Output: data/rseth-incident/rseth_hourly_snapshots.sql
 */
import * as fs from "fs"
import * as path from "path"

const SCRATCH = path.resolve(__dirname, "../.rseth-snapshot-scratch.json")
const OUT = path.resolve(__dirname, "../data/rseth-incident/rseth_hourly_snapshots.sql")

const scratch = JSON.parse(fs.readFileSync(SCRATCH, "utf8"))
const snaps = Object.values(scratch.snapshots || {}) as Array<{
  blockNumber: number
  blockTimestamp: number
  totalCollateralUsd: number
  totalDebtUsd: number
  badDebtUsd: number
  underwaterUsers: number
  activeUsers: number
}>

const lines: string[] = []
lines.push("-- Bulk-upsert hourly Aave V3 rsETH snapshots.")
lines.push(`-- Generated ${new Date().toISOString()}`)
lines.push(`-- Total rows: ${snaps.length}`)
lines.push("")
lines.push(
  "INSERT INTO rseth_hourly_snapshots (block_timestamp, block_number, total_collateral_usd, total_debt_usd, bad_debt_usd, underwater_users, active_users) VALUES"
)

const valueLines: string[] = []
for (const s of snaps) {
  valueLines.push(
    `  (${s.blockTimestamp}::bigint, ${s.blockNumber}::bigint, ${s.totalCollateralUsd}, ${s.totalDebtUsd}, ${s.badDebtUsd}, ${s.underwaterUsers}, ${s.activeUsers})`
  )
}
lines.push(valueLines.join(",\n"))
lines.push(
  "ON CONFLICT (block_timestamp) DO UPDATE SET\n" +
    "  block_number = EXCLUDED.block_number,\n" +
    "  total_collateral_usd = EXCLUDED.total_collateral_usd,\n" +
    "  total_debt_usd = EXCLUDED.total_debt_usd,\n" +
    "  bad_debt_usd = EXCLUDED.bad_debt_usd,\n" +
    "  underwater_users = EXCLUDED.underwater_users,\n" +
    "  active_users = EXCLUDED.active_users;"
)

fs.writeFileSync(OUT, lines.join("\n") + "\n")
console.log(`Wrote ${snaps.length} rows to ${OUT}`)
console.log(`File size: ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`)
