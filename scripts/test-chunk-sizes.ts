import { createPublicClient, http, fallback, parseAbiItem } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
    http("https://rpc.ankr.com/eth", { timeout: 30000 }),
  ]),
})

const event = parseAbiItem(
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)"
)

const POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as const

async function testRange(from: bigint, size: bigint) {
  const start = Date.now()
  try {
    const logs = await client.getLogs({
      address: POOL,
      event,
      fromBlock: from,
      toBlock: from + size,
    })
    const ms = Date.now() - start
    console.log(`  ${size.toString().padStart(10)} blocks: ${logs.length} events in ${ms}ms`)
    return true
  } catch (e: any) {
    const ms = Date.now() - start
    console.log(`  ${size.toString().padStart(10)} blocks: FAILED (${ms}ms) - ${e.message?.slice(0, 80)}`)
    return false
  }
}

async function main() {
  console.log("Testing chunk sizes from block 16,291,127 (empty range):")
  await testRange(16291127n, 10_000n)
  await testRange(16291127n, 50_000n)
  await testRange(16291127n, 100_000n)
  await testRange(16291127n, 500_000n)
  await testRange(16291127n, 1_000_000n)
  await testRange(16291127n, 2_000_000n)

  console.log("\nTesting from block 19,000,000 (has events):")
  await testRange(19000000n, 100_000n)
  await testRange(19000000n, 500_000n)
  await testRange(19000000n, 1_000_000n)
}

main().catch(e => console.error(e))
