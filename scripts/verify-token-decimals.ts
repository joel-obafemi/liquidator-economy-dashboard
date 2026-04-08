import { createPublicClient, http, fallback } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://ethereum-rpc.publicnode.com", { timeout: 20000, retryCount: 3, retryDelay: 2000 }),
    http("https://rpc.ankr.com/eth", { timeout: 20000, retryCount: 3, retryDelay: 2000 }),
    http("https://eth.llamarpc.com", { timeout: 20000, retryCount: 3, retryDelay: 2000 }),
    http("https://1rpc.io/eth", { timeout: 20000, retryCount: 3, retryDelay: 2000 }),
  ]),
})

const abi = [
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
] as const

const tokens: Record<string, string> = {
  wUSDL: "0x7751e2f4b8ae93ef6b79d86419d42fe3295a4559",
  pufETH: "0xd9a442856c234a39a81a089c06451ebaa4306a72",
  USDL: "0xbdC7c08592Ee4aa51D06C27Ee23D5087D65aDbcD",
  "PT-USD0++-27MAR2025": "0x5bae9a5d67d1ca5b09b14c91935f635cfbf3b685",
}

async function main() {
  for (const [name, addr] of Object.entries(tokens)) {
    try {
      const dec = await client.readContract({ address: addr as `0x${string}`, abi, functionName: "decimals" })
      await new Promise(r => setTimeout(r, 500))
      const sym = await client.readContract({ address: addr as `0x${string}`, abi, functionName: "symbol" })
      console.log(`${name.padEnd(24)} ${addr}  symbol=${sym} decimals=${dec}`)
      await new Promise(r => setTimeout(r, 1000))
    } catch (e: any) {
      console.log(`${name.padEnd(24)} ${addr}  ERROR ${e?.message?.slice(0, 80)}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
