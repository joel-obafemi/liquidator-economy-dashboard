import { createPublicClient, http, fallback, parseAbiItem } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
  ]),
})

const VAULT_FACTORY = "0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d"

// Confirmed signature from test-fluid-3
const logLiquidateEvent = parseAbiItem(
  "event LogLiquidate(address liquidator_, uint256 actualColAmt_, uint256 actualDebtAmt_, address to_)"
)

const newPositionMintedEvent = parseAbiItem(
  "event NewPositionMinted(address indexed minter, address indexed user, uint256 indexed tokenId)"
)

async function main() {
  // 1. Harvest all vault addresses from a wide range
  console.log("Harvesting vault addresses...")
  const uniqueVaults = new Set<string>()
  const ranges: Array<[bigint, bigint]> = [
    [22_500_000n, 22_549_000n],
    [22_700_000n, 22_749_000n],
    [22_900_000n, 22_949_000n],
  ]
  for (const [from, to] of ranges) {
    try {
      const logs = await client.getLogs({
        address: VAULT_FACTORY as `0x${string}`,
        event: newPositionMintedEvent,
        fromBlock: from,
        toBlock: to,
      })
      for (const l of logs) {
        if (l.args.minter) uniqueVaults.add(l.args.minter.toLowerCase())
      }
    } catch {}
  }
  console.log(`Found ${uniqueVaults.size} unique vault addresses`)

  // 2. Test multi-address batch size limit — try 20, 10, 5
  for (const batchSize of [20, 10, 5]) {
    const vaultArray = [...uniqueVaults].slice(0, batchSize) as `0x${string}`[]
    console.log(`\nBatch size ${batchSize}: scanning ${vaultArray.length} vaults in 22.8M-22.849M...`)
    try {
      const logs = await client.getLogs({
        address: vaultArray,
        event: logLiquidateEvent,
        fromBlock: 22_800_000n,
        toBlock: 22_849_000n,
      })
      console.log(`  Found ${logs.length} LogLiquidate events`)
      if (logs.length > 0 && batchSize === 5) {
        console.log(`  Sample:`)
        for (const l of logs.slice(0, 3)) {
          console.log(`    vault=${l.address.toLowerCase()} block=${l.blockNumber}`)
          console.log(`      liquidator=${l.args.liquidator_}`)
          console.log(`      actualColAmt=${l.args.actualColAmt_?.toString()}`)
          console.log(`      actualDebtAmt=${l.args.actualDebtAmt_?.toString()}`)
        }
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e?.message?.slice(0, 120)}`)
    }
  }

  // 3. Find the earliest LogLiquidate event using single-vault scans
  console.log(`\n--- Earliest activity (single vault scans) ---`)
  const vaultArray = [...uniqueVaults].slice(0, 10) as `0x${string}`[]
  for (const start of [19_500_000n, 20_000_000n, 20_500_000n, 21_000_000n]) {
    try {
      const logs = await client.getLogs({
        address: vaultArray,
        event: logLiquidateEvent,
        fromBlock: start,
        toBlock: start + 49_000n,
      })
      console.log(`  ${start}-${start + 49_000n}: ${logs.length} liquidations (10 vaults)`)
      if (logs.length > 0) {
        console.log(`    first block: ${logs[0].blockNumber}`)
      }
    } catch (e: any) {
      console.log(`  ${start}: ${e?.message?.slice(0, 60)}`)
    }
  }
}

main().catch(e => {
  console.error("ERROR:", e.message?.slice(0, 300))
  process.exit(1)
})
