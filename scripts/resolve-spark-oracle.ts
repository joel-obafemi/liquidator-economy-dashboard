import { createPublicClient, http, fallback } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com", { timeout: 15000 }),
    http("https://ethereum-rpc.publicnode.com", { timeout: 15000 }),
  ]),
})

async function main() {
  // Resolve Spark oracle from AddressesProvider
  const oracleAddr = await client.readContract({
    address: "0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE",
    abi: [{
      type: "function",
      name: "getPriceOracle",
      inputs: [],
      outputs: [{ type: "address" }],
      stateMutability: "view",
    }],
    functionName: "getPriceOracle",
  })
  console.log("Spark Oracle address:", oracleAddr)

  // Test: get WETH price from Aave oracle
  const aavePrice = await client.readContract({
    address: "0x54586bE62E3c3580375aE3723C145253060Ca0C2",
    abi: [{
      type: "function",
      name: "getAssetPrice",
      inputs: [{ name: "asset", type: "address" }],
      outputs: [{ type: "uint256" }],
      stateMutability: "view",
    }],
    functionName: "getAssetPrice",
    args: ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"], // WETH
  })
  console.log("Aave WETH price (8 decimals):", aavePrice.toString(), "= $" + (Number(aavePrice) / 1e8).toFixed(2))

  // Test: get WETH price from Spark oracle
  const sparkPrice = await client.readContract({
    address: oracleAddr,
    abi: [{
      type: "function",
      name: "getAssetPrice",
      inputs: [{ name: "asset", type: "address" }],
      outputs: [{ type: "uint256" }],
      stateMutability: "view",
    }],
    functionName: "getAssetPrice",
    args: ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"], // WETH
  })
  console.log("Spark WETH price (8 decimals):", sparkPrice.toString(), "= $" + (Number(sparkPrice) / 1e8).toFixed(2))

  // Test batch: getAssetsPrices
  const assets = [
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
  ]
  const batchPrices = await client.readContract({
    address: "0x54586bE62E3c3580375aE3723C145253060Ca0C2",
    abi: [{
      type: "function",
      name: "getAssetsPrices",
      inputs: [{ name: "assets", type: "address[]" }],
      outputs: [{ type: "uint256[]" }],
      stateMutability: "view",
    }],
    functionName: "getAssetsPrices",
    args: [assets as `0x${string}`[]],
  })
  console.log("\nBatch prices (current):")
  console.log("  WETH: $" + (Number(batchPrices[0]) / 1e8).toFixed(2))
  console.log("  USDC: $" + (Number(batchPrices[1]) / 1e8).toFixed(6))
  console.log("  WBTC: $" + (Number(batchPrices[2]) / 1e8).toFixed(2))

  // Test historical: read at a specific block
  const historicalPrice = await client.readContract({
    address: "0x54586bE62E3c3580375aE3723C145253060Ca0C2",
    abi: [{
      type: "function",
      name: "getAssetPrice",
      inputs: [{ name: "asset", type: "address" }],
      outputs: [{ type: "uint256" }],
      stateMutability: "view",
    }],
    functionName: "getAssetPrice",
    args: ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"],
    blockNumber: 20000000n, // ~June 2024
  })
  console.log("\nHistorical WETH price at block 20M: $" + (Number(historicalPrice) / 1e8).toFixed(2))
}

main().catch(e => console.error(e))
