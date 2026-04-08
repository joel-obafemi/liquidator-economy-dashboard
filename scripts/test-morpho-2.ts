import { createPublicClient, http, fallback } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 30000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 30000 }),
  ]),
})

const erc20Abi = [
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const

async function main() {
  // Resolve that collateral token
  const token = "0x07D1718fF05a8C53C8F05aDAEd57C0d672945f9a"
  const symbol = await client.readContract({
    address: token as `0x${string}`,
    abi: erc20Abi,
    functionName: "symbol",
  })
  const decimals = await client.readContract({
    address: token as `0x${string}`,
    abi: erc20Abi,
    functionName: "decimals",
  })
  console.log(`Token ${token}: ${symbol} (${decimals} decimals)`)

  // Check Morpho Blue deploy block - look for first Liquidate event ever
  // Morpho Blue was deployed Dec 27 2023
  // Let's scan from ~18880000 onwards in a few chunks
  const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
  const LIQUIDATE_TOPIC = "0xa4946ede45d0c6f06a0f5ce92c9ad3b4751452d2fe0e25010783bcab57a67e41"

  for (const start of [18_900_000n, 19_500_000n, 20_000_000n, 20_500_000n, 21_000_000n]) {
    try {
      const logs = await client.getLogs({
        address: MORPHO as `0x${string}`,
        topics: [LIQUIDATE_TOPIC as `0x${string}`],
        fromBlock: start,
        toBlock: start + 49_000n,
      })
      console.log(`${start}-${start + 49_000n}: ${logs.length} events`)
      if (logs.length > 0 && logs[0].blockNumber) {
        console.log(`  first: block ${logs[0].blockNumber}`)
      }
    } catch (e: any) {
      console.log(`${start}: error ${e.message?.slice(0, 60)}`)
    }
  }
}

main().catch(e => console.error(e.message))
