/**
 * Full historical backfill script.
 * Runs the scanner in a loop until fully caught up.
 * Run with: npm run backfill
 */
import { Pool } from "@neondatabase/serverless"
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

async function main() {
  // Dynamic import after env is loaded
  const { scanLiquidations } = await import("@/lib/scanner")

  const protocol = process.argv[2] || "all"
  console.log(`=== Backfill: ${protocol} ===\n`)

  let iteration = 0
  let totalEvents = 0

  while (true) {
    iteration++
    console.log(`\n--- Iteration ${iteration} ---`)

    const result = await scanLiquidations(protocol)

    let anyNewEvents = false
    for (const [proto, stats] of Object.entries(result)) {
      console.log(
        `  ${proto}: ${stats.newEvents} events, ${stats.blocksScanned} blocks scanned, last block ${stats.lastBlock}`
      )
      totalEvents += stats.newEvents
      if (stats.blocksScanned > 0) anyNewEvents = true
    }

    if (!anyNewEvents) {
      console.log(`\nBackfill complete! Total events: ${totalEvents}`)
      break
    }

    // Brief pause between iterations to avoid hammering RPCs
    await new Promise((r) => setTimeout(r, 1000))
  }

  process.exit(0)
}

main().catch((e) => {
  console.error("Fatal:", e)
  process.exit(1)
})
