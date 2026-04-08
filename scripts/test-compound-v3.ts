import { createPublicClient, http, fallback, parseAbiItem } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
  ]),
})

// Compound V3 Comet instances on Ethereum mainnet
const COMETS = {
  cUSDCv3: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
  cWETHv3: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
  cUSDTv3: "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840",
  cUSDSv3: "0x5D409e56D886231aDAf00c8775665AD0f9897b56",
}

// AbsorbCollateral event — emitted when a liquidator absorbs an underwater position
const absorbCollateralEvent = parseAbiItem(
  "event AbsorbCollateral(address indexed absorber, address indexed borrower, address indexed asset, uint256 collateralAbsorbed, uint256 usdValue)"
)

// AbsorbDebt event — emitted alongside AbsorbCollateral with the total debt wiped
const absorbDebtEvent = parseAbiItem(
  "event AbsorbDebt(address indexed absorber, address indexed borrower, uint256 basePaidOut, uint256 usdValue)"
)

async function main() {
  console.log("=== Compound V3 Smoke Test ===\n")

  const currentBlock = await client.getBlockNumber()
  console.log("Current block:", currentBlock.toString())

  // Test each Comet
  for (const [name, addr] of Object.entries(COMETS)) {
    console.log(`\n--- ${name} (${addr}) ---`)
    try {
      // Search a recent 49k range
      const logs = await client.getLogs({
        address: addr as `0x${string}`,
        event: absorbCollateralEvent,
        fromBlock: 22_000_000n,
        toBlock: 22_049_000n,
      })
      console.log(`  AbsorbCollateral events in 22M-22.049M: ${logs.length}`)

      if (logs.length > 0) {
        const l = logs[0]
        console.log(`  First: tx=${l.transactionHash?.slice(0, 12)}...`)
        console.log(`    block=${l.blockNumber} logIndex=${l.logIndex}`)
        console.log(`    absorber=${l.args.absorber}`)
        console.log(`    borrower=${l.args.borrower}`)
        console.log(`    asset=${l.args.asset}`)
        console.log(`    collateralAbsorbed=${l.args.collateralAbsorbed?.toString()}`)
        console.log(`    usdValue=${l.args.usdValue?.toString()}`)
      }

      // Also check AbsorbDebt from the same range
      const debtLogs = await client.getLogs({
        address: addr as `0x${string}`,
        event: absorbDebtEvent,
        fromBlock: 22_000_000n,
        toBlock: 22_049_000n,
      })
      console.log(`  AbsorbDebt events: ${debtLogs.length}`)
      if (debtLogs.length > 0) {
        const d = debtLogs[0]
        console.log(`    basePaidOut=${d.args.basePaidOut?.toString()}, usdValue=${d.args.usdValue?.toString()}`)
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e?.message?.slice(0, 100)}`)
    }
  }

  // Scan earlier ranges for cUSDCv3 to find deploy block
  console.log("\n\n--- Finding cUSDCv3 earliest activity ---")
  for (const start of [15_000_000n, 15_500_000n, 16_000_000n, 16_500_000n, 17_000_000n]) {
    try {
      const logs = await client.getLogs({
        address: COMETS.cUSDCv3 as `0x${string}`,
        event: absorbCollateralEvent,
        fromBlock: start,
        toBlock: start + 49_000n,
      })
      console.log(`  ${start}-${start + 49_000n}: ${logs.length} events`)
      if (logs.length > 0) {
        console.log(`    first block: ${logs[0].blockNumber}`)
        break
      }
    } catch (e: any) {
      console.log(`  ${start}: error ${e?.message?.slice(0, 60)}`)
    }
  }
}

main().catch(e => {
  console.error("ERROR:", e.message?.slice(0, 300))
  process.exit(1)
})
