import { createPublicClient, http, fallback, parseAbiItem } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 15000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 15000 }),
  ]),
})

const event = parseAbiItem(
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)"
)

async function main() {
  console.log("1. Getting current block...")
  const block = await client.getBlockNumber()
  console.log("   Current block:", block.toString())

  // Try a range known to have Aave V3 liquidations (Nov 2023 crash)
  console.log("\n2. Fetching logs from block 18,400,000 - 18,402,000...")
  const logs = await client.getLogs({
    address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    event,
    fromBlock: 18400000n,
    toBlock: 18402000n,
  })
  console.log("   Logs found:", logs.length)

  if (logs.length > 0) {
    const l = logs[0]
    console.log("   First tx:", l.transactionHash)
    console.log("   Block:", l.blockNumber?.toString())
    console.log("   Collateral:", l.args.collateralAsset)
    console.log("   Debt:", l.args.debtAsset)
    console.log("   Liquidator:", l.args.liquidator)
  }

  // Try much wider ranges to find liquidations
  const ranges = [
    [19000000n, 19050000n],  // Feb 2024
    [19500000n, 19550000n],  // Mar 2024
    [20000000n, 20050000n],  // May 2024
    [20500000n, 20550000n],  // Jul 2024
    [21000000n, 21050000n],  // Sep 2024
    [21500000n, 21550000n],  // Nov 2024
  ]

  for (const [from, to] of ranges) {
    console.log(`\n3. Range ${from}-${to}...`)
    const logs2 = await client.getLogs({
      address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      event,
      fromBlock: from,
      toBlock: to,
    })
    console.log(`   Logs found: ${logs2.length}`)
    if (logs2.length > 0) {
      console.log("   First tx:", logs2[0].transactionHash)
      console.log("   Block:", logs2[0].blockNumber?.toString())
      break
    }
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message?.slice(0, 300))
  process.exit(1)
})
