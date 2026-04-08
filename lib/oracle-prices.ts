/**
 * On-chain oracle price fetching for Aave V3 and SparkLend.
 * Uses getAssetsPrices() at historical block numbers for exact prices.
 * Oracle returns USD prices with 8 decimal places.
 */
import { ethClient } from "@/lib/rpc"
import { ORACLE_ABI, AAVE_CONFIG, SPARK_CONFIG } from "@/lib/contracts"

const ORACLE_DECIMALS = 8
const ORACLE_DIVISOR = 10 ** ORACLE_DECIMALS

/**
 * Fetch on-chain oracle prices for multiple assets at a specific block.
 * Returns a Map of lowercase address -> USD price.
 */
export async function getOraclePricesAtBlock(
  oracleAddress: `0x${string}`,
  assets: string[],
  blockNumber: bigint,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (assets.length === 0) return result

  const uniqueAssets = [...new Set(assets.map((a) => a.toLowerCase()))]

  try {
    // Use batch getAssetsPrices for efficiency
    const prices = await ethClient.readContract({
      address: oracleAddress,
      abi: ORACLE_ABI,
      functionName: "getAssetsPrices",
      args: [uniqueAssets as `0x${string}`[]],
      blockNumber,
    }) as bigint[]

    for (let i = 0; i < uniqueAssets.length; i++) {
      const priceRaw = prices[i]
      if (priceRaw && priceRaw > 0n) {
        result.set(uniqueAssets[i], Number(priceRaw) / ORACLE_DIVISOR)
      }
    }
  } catch (e: any) {
    // Fallback: try individual getAssetPrice calls if batch fails
    // This can happen if one asset isn't registered in the oracle
    for (const asset of uniqueAssets) {
      try {
        const price = await ethClient.readContract({
          address: oracleAddress,
          abi: ORACLE_ABI,
          functionName: "getAssetPrice",
          args: [asset as `0x${string}`],
          blockNumber,
        }) as bigint

        if (price && price > 0n) {
          result.set(asset, Number(price) / ORACLE_DIVISOR)
        }
      } catch {
        // Asset not registered in oracle — skip
      }
    }
  }

  return result
}

/**
 * Get the oracle address for a given protocol.
 */
export function getOracleForProtocol(protocol: string): `0x${string}` {
  if (protocol === "spark") return SPARK_CONFIG.oracleAddress
  return AAVE_CONFIG.oracleAddress
}

/**
 * Calculate USD values for a liquidation event using oracle prices.
 */
export function calculateUsdValues(
  collateralPrice: number,
  debtPrice: number,
  collateralAmount: bigint,
  debtAmount: bigint,
  collateralDecimals: number,
  debtDecimals: number,
): { collateralAmountUsd: number; debtAmountUsd: number; grossProfitUsd: number } {
  const collateralAmountUsd =
    (Number(collateralAmount) / 10 ** collateralDecimals) * collateralPrice
  const debtAmountUsd =
    (Number(debtAmount) / 10 ** debtDecimals) * debtPrice
  const grossProfitUsd = collateralAmountUsd - debtAmountUsd

  return { collateralAmountUsd, debtAmountUsd, grossProfitUsd }
}
