import { createPublicClient, http, fallback, keccak256, toBytes } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
  ]),
})

// The FluidVaultFactory is an ERC-721 (Fluid Vault tokens for positions)
const VAULT_FACTORY = "0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d"

// Candidate event signatures — we'll compute hashes and search for any that appear
const candidates = [
  // Factory events (vault creation)
  "LogNewVault(uint256,address,address)",
  "LogVaultCreated(uint256,address,address)",
  "NewVault(uint256,address,address)",
  "VaultDeployed(uint256,address,address)",
  "LogDeployVault(uint256,address,address)",
  // Simpler single-arg vault creation
  "LogNewVault(address)",
  "NewVault(address)",
  "VaultDeployed(address)",
  // Position NFT events
  "NewPositionMinted(address,address,uint256)",
  "NewPositionMinted(uint256)",
  // Vault liquidation events — will be emitted by the vaults themselves, not the factory
  "LogLiquidate(address,uint256,uint256,address)",
  "LogLiquidate(uint256,uint256,address)",
  "Liquidate(address,address,uint256,uint256)",
]

async function main() {
  console.log("=== Fluid Smoke Test ===\n")

  const currentBlock = await client.getBlockNumber()
  console.log("Current block:", currentBlock.toString())

  // Compute keccak hashes for each candidate
  console.log("\nCandidate event topics:")
  const topicMap = new Map<string, string>()
  for (const sig of candidates) {
    const hash = keccak256(toBytes(sig))
    topicMap.set(hash, sig)
    console.log(`  ${hash} <- ${sig}`)
  }

  // Scan the factory contract for ALL logs in a recent window to see what it emits
  console.log("\n--- All topics emitted by factory in 22.8M–22.849M ---")
  try {
    const logs = await client.getLogs({
      address: VAULT_FACTORY as `0x${string}`,
      fromBlock: 22_800_000n,
      toBlock: 22_849_000n,
    })
    console.log(`  Total logs: ${logs.length}`)
    const topicCounts = new Map<string, number>()
    for (const l of logs) {
      const t0 = l.topics[0]
      if (t0) topicCounts.set(t0, (topicCounts.get(t0) || 0) + 1)
    }
    for (const [topic, count] of topicCounts) {
      const matched = topicMap.get(topic) ?? "unknown"
      console.log(`    ${topic} x${count}  [${matched}]`)
    }
    if (logs.length > 0) {
      const first = logs[0]
      console.log(`  First log: tx=${first.transactionHash?.slice(0, 12)} topics=${first.topics.length} data=${first.data?.slice(0, 20)}...`)
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e?.message?.slice(0, 120)}`)
  }

  // Now check factory for very old activity (find earliest)
  console.log("\n--- Factory deploy exploration ---")
  for (const start of [19_000_000n, 19_500_000n, 20_000_000n, 20_500_000n, 21_000_000n]) {
    try {
      const logs = await client.getLogs({
        address: VAULT_FACTORY as `0x${string}`,
        fromBlock: start,
        toBlock: start + 49_000n,
      })
      console.log(`  ${start}-${start + 49_000n}: ${logs.length} factory logs`)
    } catch (e: any) {
      console.log(`  ${start}: error ${e?.message?.slice(0, 60)}`)
    }
  }
}

main().catch(e => {
  console.error("ERROR:", e.message?.slice(0, 300))
  process.exit(1)
})
