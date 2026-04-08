import { createPublicClient, http, fallback } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://ethereum-rpc.publicnode.com", { timeout: 20000 }),
    http("https://1rpc.io/eth", { timeout: 20000 }),
    http("https://eth.drpc.org", { timeout: 20000 }),
  ]),
})

// Correct ConstantViews struct from fluid-contracts-public source
const vaultAbi = [{
  type: "function",
  name: "constantsView",
  inputs: [],
  outputs: [{
    type: "tuple",
    components: [
      { name: "liquidity", type: "address" },
      { name: "factory", type: "address" },
      { name: "adminImplementation", type: "address" },
      { name: "secondaryImplementation", type: "address" },
      { name: "supplyToken", type: "address" },
      { name: "borrowToken", type: "address" },
      { name: "supplyDecimals", type: "uint8" },
      { name: "borrowDecimals", type: "uint8" },
      { name: "vaultId", type: "uint256" },
      { name: "liquiditySupplyExchangePriceSlot", type: "bytes32" },
      { name: "liquidityBorrowExchangePriceSlot", type: "bytes32" },
      { name: "liquidityUserSupplySlot", type: "bytes32" },
      { name: "liquidityUserBorrowSlot", type: "bytes32" },
    ],
  }],
  stateMutability: "view",
}] as const

const erc20Abi = [
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const

const SAMPLE_VAULTS = [
  "0x1c6068eC051f0Ac1688cA1FE76810FA9c8644278",
  "0x1982cc7b1570c2503282d0a0b41f69b3b28fdcc3",
  "0x238207734adbd22037af0437ef65f13babbd1917",
  "0x4e564a29c1fc18ed9b66e5754a37fca0c8a980ff",
  "0x75305a6a8977e998573076fa3293a235e23c32ad",
]

async function main() {
  for (const vault of SAMPLE_VAULTS) {
    console.log(`\n=== Vault ${vault} ===`)
    try {
      const result = await client.readContract({
        address: vault as `0x${string}`,
        abi: vaultAbi,
        functionName: "constantsView",
      })
      console.log(`  supplyToken: ${result.supplyToken}`)
      console.log(`  borrowToken: ${result.borrowToken}`)
      console.log(`  supplyDecimals: ${result.supplyDecimals}`)
      console.log(`  borrowDecimals: ${result.borrowDecimals}`)
      console.log(`  vaultId: ${result.vaultId}`)

      // Try to resolve symbols
      for (const [label, addr] of [["supply", result.supplyToken], ["borrow", result.borrowToken]] as const) {
        try {
          const sym = await client.readContract({
            address: addr as `0x${string}`,
            abi: erc20Abi,
            functionName: "symbol",
          })
          console.log(`    ${label} symbol: ${sym}`)
        } catch {
          console.log(`    ${label}: NOT a standard ERC20 (likely smart col/debt)`)
        }
      }
      await new Promise(r => setTimeout(r, 800))
    } catch (e: any) {
      console.log(`  ERROR: ${e?.message?.slice(0, 150)}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
