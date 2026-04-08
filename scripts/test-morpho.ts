import { createPublicClient, http, fallback, parseAbiItem, decodeEventLog } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
  ]),
})

const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const

const liquidateEvent = parseAbiItem(
  "event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)"
)

const idToMarketParamsAbi = [
  {
    type: "function",
    name: "idToMarketParams",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const

async function main() {
  console.log("=== Morpho Blue Smoke Test ===\n")

  // 1. Current block
  const currentBlock = await client.getBlockNumber()
  console.log("Current block:", currentBlock.toString())

  // 2. Search recent range for liquidations (Morpho Blue has LOW volume compared to Aave)
  console.log("\nFetching logs from block 23000000 to 23049000...")
  const logs = await client.getLogs({
    address: MORPHO_BLUE,
    event: liquidateEvent,
    fromBlock: 23_000_000n,
    toBlock: 23_049_000n,
  })
  console.log(`Found ${logs.length} liquidation events in that range`)

  if (logs.length > 0) {
    const sample = logs[0]
    console.log("\n--- Sample liquidation ---")
    console.log("Tx hash:", sample.transactionHash)
    console.log("Block:", sample.blockNumber?.toString())
    console.log("Log index:", sample.logIndex)
    console.log("Args:", {
      id: sample.args.id,
      caller: sample.args.caller,
      borrower: sample.args.borrower,
      repaidAssets: sample.args.repaidAssets?.toString(),
      seizedAssets: sample.args.seizedAssets?.toString(),
      badDebtAssets: sample.args.badDebtAssets?.toString(),
    })

    // 3. Resolve market ID to params
    console.log("\n--- Resolving market ID ---")
    const params = await client.readContract({
      address: MORPHO_BLUE,
      abi: idToMarketParamsAbi,
      functionName: "idToMarketParams",
      args: [sample.args.id as `0x${string}`],
    })
    console.log("Market params:", {
      loanToken: params[0],
      collateralToken: params[1],
      oracle: params[2],
      irm: params[3],
      lltv: params[4].toString(),
    })
  }

  // 4. Also try an earlier range
  console.log("\n\nSearching 19000000-19049000 (earlier data)...")
  const logs2 = await client.getLogs({
    address: MORPHO_BLUE,
    event: liquidateEvent,
    fromBlock: 19_000_000n,
    toBlock: 19_049_000n,
  })
  console.log(`Found ${logs2.length} events`)

  // 5. Test historical block with sample event
  if (logs.length > 0) {
    const sample = logs[0]
    console.log("\n\n--- Historical readContract test ---")
    const paramsAtBlock = await client.readContract({
      address: MORPHO_BLUE,
      abi: idToMarketParamsAbi,
      functionName: "idToMarketParams",
      args: [sample.args.id as `0x${string}`],
      blockNumber: sample.blockNumber,
    })
    console.log("Market params at block", sample.blockNumber?.toString(), ":", {
      loanToken: paramsAtBlock[0],
      collateralToken: paramsAtBlock[1],
    })
  }
}

main().catch(e => {
  console.error("ERROR:", e.message?.slice(0, 300))
  process.exit(1)
})
