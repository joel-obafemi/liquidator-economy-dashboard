import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"

const abi = [
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const

const WUSDL = "0x7751e2f4b8ae93ef6b79d86419d42fe3295a4559"

const rpcs = [
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.ankr.com/eth",
  "https://eth.llamarpc.com",
  "https://1rpc.io/eth",
  "https://eth.drpc.org",
]

async function main() {
  for (const url of rpcs) {
    console.log(`\n--- ${url} ---`)
    const client = createPublicClient({ chain: mainnet, transport: http(url, { timeout: 15000 }) })
    try {
      const [dec, name, sym, supply] = await Promise.all([
        client.readContract({ address: WUSDL as `0x${string}`, abi, functionName: "decimals" }),
        client.readContract({ address: WUSDL as `0x${string}`, abi, functionName: "name" }),
        client.readContract({ address: WUSDL as `0x${string}`, abi, functionName: "symbol" }),
        client.readContract({ address: WUSDL as `0x${string}`, abi, functionName: "totalSupply" }),
      ])
      console.log(`  name=${name}`)
      console.log(`  symbol=${sym}`)
      console.log(`  decimals=${dec}`)
      console.log(`  totalSupply=${supply.toString()}`)
      console.log(`    if 6 decimals: ${(Number(supply) / 1e6).toLocaleString()} tokens`)
      console.log(`    if 18 decimals: ${(Number(supply) / 1e18).toLocaleString()} tokens`)
    } catch (e: any) {
      console.log(`  ERROR: ${e?.message?.slice(0, 100)}`)
    }
    await new Promise(r => setTimeout(r, 1500))
  }
}

main().catch(e => console.error(e))
