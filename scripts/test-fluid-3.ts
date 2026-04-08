import { createPublicClient, http, fallback, parseAbiItem, keccak256, toBytes } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
  ]),
})

// A few known vault addresses from the previous test
const SAMPLE_VAULTS = [
  "0x1c6068eC051f0Ac1688cA1FE76810FA9c8644278",
  "0x1982cc7b1570c2503282d0a0b41f69b3b28fdcc3",
  "0x238207734adbd22037af0437ef65f13babbd1917",
  "0x4e564a29c1fc18ed9b66e5754a37fca0c8a980ff",
  "0x75305a6a8977e998573076fa3293a235e23c32ad",
]

// Try several possible signatures
const candidates = [
  "LogLiquidate(address,uint256,uint256,address)",          // msg.sender, colAmt, debtAmt, to
  "LogLiquidate(address,int256,int256,address)",
  "LogLiquidate(address,uint256,uint256,uint256,address)",
  "LogLiquidate(uint256,uint256,address)",
  "Liquidate(address,address,uint256,uint256)",
]

async function main() {
  const topicMap = new Map<string, string>()
  for (const sig of candidates) {
    topicMap.set(keccak256(toBytes(sig)), sig)
  }
  console.log("Candidate LogLiquidate topics:")
  for (const [hash, sig] of topicMap) console.log(`  ${hash} <- ${sig}`)

  // Scan each sample vault for ALL logs in a recent window and look for Liquidate-ish topics
  for (const vault of SAMPLE_VAULTS) {
    console.log(`\n--- Vault ${vault} ---`)
    try {
      const logs = await client.getLogs({
        address: vault as `0x${string}`,
        fromBlock: 22_600_000n,
        toBlock: 22_649_000n,
      })
      console.log(`  Total logs in 22.6M–22.649M: ${logs.length}`)
      const topicCounts = new Map<string, number>()
      for (const l of logs) {
        const t0 = l.topics[0]
        if (t0) topicCounts.set(t0, (topicCounts.get(t0) || 0) + 1)
      }
      for (const [topic, count] of topicCounts) {
        const matched = topicMap.get(topic) ?? "unknown"
        console.log(`    ${topic} x${count}  [${matched}]`)
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e?.message?.slice(0, 80)}`)
    }
  }

  // Also scan ALL vaults at once for LogLiquidate(address,uint256,uint256,address)
  console.log("\n--- Multi-vault scan for LogLiquidate(address,uint256,uint256,address) ---")
  const sig = "LogLiquidate(address,uint256,uint256,address)"
  const topic = keccak256(toBytes(sig))
  console.log(`Topic: ${topic}`)
  try {
    const logs = await client.getLogs({
      address: SAMPLE_VAULTS as `0x${string}`[],
      topics: [topic],
      fromBlock: 22_600_000n,
      toBlock: 22_649_000n,
    })
    console.log(`Found ${logs.length} liquidations across 5 vaults in 49k blocks`)
  } catch (e: any) {
    console.log(`ERROR: ${e?.message?.slice(0, 200)}`)
  }
}

main().catch(e => {
  console.error("ERROR:", e.message?.slice(0, 300))
  process.exit(1)
})
