export interface RawLiquidationEvent {
  txHash: string
  logIndex: number
  blockNumber: number
  blockTimestamp: number
  protocol: string
  liquidator: string
  borrower: string
  collateralAsset: string
  debtAsset: string
  collateralSymbol: string
  debtSymbol: string
  debtToCover: bigint
  liquidatedCollateralAmount: bigint
  receiveAToken: boolean
  // Morpho-specific (null for Aave/Spark)
  marketId?: string | null
  badDebtAssets?: bigint | null
}

export interface EnrichedLiquidationEvent extends RawLiquidationEvent {
  debtAmountUsd: number
  collateralAmountUsd: number
  grossProfitUsd: number
  badDebtUsd?: number
}

export interface LiquidationRow {
  id: number
  protocol: string
  txHash: string
  logIndex: number
  blockNumber: number
  blockTimestamp: number
  liquidator: string
  borrower: string
  collateralAsset: string
  debtAsset: string
  collateralSymbol: string
  debtSymbol: string
  debtAmountUsd: number
  collateralAmountUsd: number
  grossProfitUsd: number
}

export interface LiquidatorStats {
  liquidator: string
  liquidationCount: number
  totalDebtRepaid: number
  totalCollateralSeized: number
  totalGrossProfit: number
  lastActive: number
  protocols: string[]
}

export interface OverviewStats {
  protocol: string
  totalEvents: number
  totalVolume: number
  totalGrossProfit: number
  uniqueLiquidators: number
  uniqueBorrowers: number
}

export interface MonthlyVolume {
  month: string
  protocol: string
  volume: number
  count: number
  profit: number
}

export interface TokenMetadata {
  address: string
  symbol: string
  decimals: number
}
