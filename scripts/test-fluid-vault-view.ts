/**
 * Call constantsView() on a known Fluid vault to figure out the struct layout.
 * We'll try a few candidate ABIs and see which one decodes cleanly.
 */
import { createPublicClient, http, fallback } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://ethereum-rpc.publicnode.com", { timeout: 20000, retryCount: 2, retryDelay: 2000 }),
    http("https://1rpc.io/eth", { timeout: 20000, retryCount: 2, retryDelay: 2000 }),
    http("https://eth.drpc.org", { timeout: 20000, retryCount: 2, retryDelay: 2000 }),
  ]),
})

// A vault we know is active (from test-fluid-2 output)
const SAMPLE_VAULT = "0x1c6068eC051f0Ac1688cA1FE76810FA9c8644278"

// Candidate 1: Vault T1 — simple struct with direct token addresses
const abi_v1 = [{
  type: "function",
  name: "constantsView",
  inputs: [],
  outputs: [
    {
      type: "tuple",
      components: [
        { name: "liquidity", type: "address" },
        { name: "factory", type: "address" },
        { name: "operateImplementation", type: "address" },
        { name: "adminImplementation", type: "address" },
        { name: "secondaryImplementation", type: "address" },
        { name: "deployer", type: "address" },
        { name: "supply", type: "address" },        // collateral token
        { name: "borrow", type: "address" },        // debt token
        { name: "supplyExchangePriceSlot", type: "bytes32" },
        { name: "borrowExchangePriceSlot", type: "bytes32" },
        { name: "userSupplySlot", type: "bytes32" },
        { name: "userBorrowSlot", type: "bytes32" },
      ],
    },
  ],
  stateMutability: "view",
}] as const

async function main() {
  console.log(`Testing constantsView() on ${SAMPLE_VAULT}\n`)

  try {
    const result = await client.readContract({
      address: SAMPLE_VAULT as `0x${string}`,
      abi: abi_v1,
      functionName: "constantsView",
    })
    console.log("SUCCESS with T1 ABI:")
    console.log(JSON.stringify(result, (_, v) => typeof v === "bigint" ? v.toString() : v, 2))
  } catch (e: any) {
    console.log("T1 ABI failed:", e?.message?.slice(0, 200))

    // Try calling low-level with just the function selector to see the raw return
    try {
      const { encodeFunctionData, decodeAbiParameters } = await import("viem")
      const selector = "0x47006e05" // keccak("constantsView()")[0:4]
      const raw = await client.request({
        method: "eth_call",
        params: [
          {
            to: SAMPLE_VAULT as `0x${string}`,
            data: selector,
          },
          "latest",
        ],
      })
      console.log(`Raw return (${(raw.length - 2) / 2} bytes):`)
      console.log(raw)
    } catch (e2: any) {
      console.log("Raw call also failed:", e2?.message?.slice(0, 200))
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
