import { createPublicClient, http, fallback, parseAbiItem, decodeEventLog } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
  ]),
})

const VAULT_FACTORY = "0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d"

const newPositionMintedEvent = parseAbiItem(
  "event NewPositionMinted(address indexed minter, address indexed user, uint256 indexed tokenId)"
)

async function main() {
  // Grab some NewPositionMinted events and inspect
  const logs = await client.getLogs({
    address: VAULT_FACTORY as `0x${string}`,
    event: newPositionMintedEvent,
    fromBlock: 22_800_000n,
    toBlock: 22_810_000n,
  })

  console.log(`NewPositionMinted events: ${logs.length}`)
  if (logs.length > 0) {
    const first = logs[0]
    console.log(`\nFirst event:`)
    console.log(`  tx: ${first.transactionHash}`)
    console.log(`  minter (vault?): ${first.args.minter}`)
    console.log(`  user: ${first.args.user}`)
    console.log(`  tokenId: ${first.args.tokenId?.toString()}`)

    // Get the transaction receipt to see all logs in this tx
    const receipt = await client.getTransactionReceipt({ hash: first.transactionHash as `0x${string}` })
    console.log(`\n  Transaction has ${receipt.logs.length} total logs`)
    const uniqueAddrs = new Set<string>()
    for (const l of receipt.logs) {
      uniqueAddrs.add(l.address.toLowerCase())
    }
    console.log(`  Unique contract addresses involved: ${uniqueAddrs.size}`)
    for (const a of uniqueAddrs) {
      console.log(`    ${a}`)
    }
  }

  // Now collect all unique "minters" (likely vault addresses) from a larger range
  console.log("\n--- Discovering all vaults from NewPositionMinted minter fields ---")
  const wideLogs = await client.getLogs({
    address: VAULT_FACTORY as `0x${string}`,
    event: newPositionMintedEvent,
    fromBlock: 22_750_000n,
    toBlock: 22_799_000n,
  })
  console.log(`Found ${wideLogs.length} NewPositionMinted events in that window`)
  const vaultAddrs = new Set<string>()
  for (const l of wideLogs) {
    if (l.args.minter) vaultAddrs.add(l.args.minter.toLowerCase())
  }
  console.log(`Unique minters (likely vaults): ${vaultAddrs.size}`)
  for (const v of [...vaultAddrs].slice(0, 15)) {
    console.log(`  ${v}`)
  }
}

main().catch(e => {
  console.error("ERROR:", e.message?.slice(0, 300))
  process.exit(1)
})
