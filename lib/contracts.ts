export const AAVE_V3_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as const
export const SPARK_POOL = "0xC13e21B648A5Ee794902342038FF3aDAB66BE987" as const
export const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const

// Fluid uses a factory contract that mints ERC-721 position tokens.
// Individual vault contracts emit LogLiquidate when a position is liquidated.
// Each vault exposes `constantsView()` which returns the supply/borrow tokens.
export const FLUID_VAULT_FACTORY = "0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d" as const
// Rough deploy block — first factory activity observed at ~19,500,000 (April 2024)
export const FLUID_DEPLOY_BLOCK = 19_500_000n

// Oracle addresses (both use AaveOracle interface with USD 8-decimal prices)
export const AAVE_V3_ORACLE = "0x54586bE62E3c3580375aE3723C145253060Ca0C2" as const
export const SPARK_ADDRESSES_PROVIDER = "0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE" as const

// Aave V3 mainnet launch: Jan 27 2023
export const AAVE_V3_DEPLOY_BLOCK = 16_291_127n
// SparkLend mainnet launch: May 2023
export const SPARK_DEPLOY_BLOCK = 17_185_580n
// Morpho Blue deployment: Dec 27 2023 (first event observed ~18,919,623)
export const MORPHO_DEPLOY_BLOCK = 18_883_124n

export const LIQUIDATION_CALL_TOPIC =
  "0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286" as const

export const LIQUIDATION_CALL_ABI = [
  {
    type: "event",
    name: "LiquidationCall",
    inputs: [
      { indexed: true, name: "collateralAsset", type: "address" },
      { indexed: true, name: "debtAsset", type: "address" },
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "debtToCover", type: "uint256" },
      { indexed: false, name: "liquidatedCollateralAmount", type: "uint256" },
      { indexed: false, name: "liquidator", type: "address" },
      { indexed: false, name: "receiveAToken", type: "bool" },
    ],
  },
] as const

// Morpho Blue Liquidate event
export const MORPHO_LIQUIDATE_ABI = [
  {
    type: "event",
    name: "Liquidate",
    inputs: [
      { indexed: true, name: "id", type: "bytes32" },
      { indexed: true, name: "caller", type: "address" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: false, name: "repaidAssets", type: "uint256" },
      { indexed: false, name: "repaidShares", type: "uint256" },
      { indexed: false, name: "seizedAssets", type: "uint256" },
      { indexed: false, name: "badDebtAssets", type: "uint256" },
      { indexed: false, name: "badDebtShares", type: "uint256" },
    ],
  },
] as const

// Morpho Blue idToMarketParams reader
export const MORPHO_MARKET_PARAMS_ABI = [
  {
    type: "function",
    name: "idToMarketParams",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const

// Fluid VaultFactory event — emitted when a user mints a new position NFT in a vault.
// The `minter` field is the vault contract address, which lets us harvest the
// full set of deployed vault addresses without needing a factory event for
// vault creation itself (Fluid's factory doesn't emit one we can use).
export const FLUID_NEW_POSITION_MINTED_ABI = [
  {
    type: "event",
    name: "NewPositionMinted",
    inputs: [
      { indexed: true, name: "minter", type: "address" },
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
  },
] as const

// Fluid LogLiquidate event emitted by each vault contract
export const FLUID_LOG_LIQUIDATE_ABI = [
  {
    type: "event",
    name: "LogLiquidate",
    inputs: [
      { indexed: false, name: "liquidator_", type: "address" },
      { indexed: false, name: "actualColAmt_", type: "uint256" },
      { indexed: false, name: "actualDebtAmt_", type: "uint256" },
      { indexed: false, name: "to_", type: "address" },
    ],
  },
] as const

// Fluid Vault constantsView() - the T1 vault shape
// For T2/T3/T4 vaults with smart col/debt, supplyToken or borrowToken may
// point to a non-ERC20 contract and we skip those in the first iteration.
export const FLUID_VAULT_CONSTANTS_ABI = [
  {
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
  },
] as const

// Canonical "native ETH" sentinel used by Fluid (and other protocols)
export const NATIVE_ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const
export const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const

export const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
] as const

// Aave V3 Oracle ABI (same interface for both Aave and Spark)
export const ORACLE_ABI = [
  {
    type: "function",
    name: "getAssetPrice",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAssetsPrices",
    inputs: [{ name: "assets", type: "address[]" }],
    outputs: [{ type: "uint256[]" }],
    stateMutability: "view",
  },
] as const

// PoolAddressesProvider ABI (to resolve Spark oracle address)
export const ADDRESSES_PROVIDER_ABI = [
  {
    type: "function",
    name: "getPriceOracle",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const

export interface ProtocolConfig {
  name: string
  scannerName: string
  poolAddress: `0x${string}`
  oracleAddress: `0x${string}`
  deployBlock: bigint
  scanChunk: bigint
  maxChunksPerCall: number
}

export const AAVE_CONFIG: ProtocolConfig = {
  name: "aave_v3",
  scannerName: "aave_v3",
  poolAddress: AAVE_V3_POOL as `0x${string}`,
  oracleAddress: AAVE_V3_ORACLE as `0x${string}`,
  deployBlock: AAVE_V3_DEPLOY_BLOCK,
  scanChunk: 49_000n,
  maxChunksPerCall: 500,
}

// Spark oracle address will be resolved dynamically via PoolAddressesProvider
// but we set a known default here
export const SPARK_CONFIG: ProtocolConfig = {
  name: "spark",
  scannerName: "spark",
  poolAddress: SPARK_POOL as `0x${string}`,
  oracleAddress: "0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9" as `0x${string}`, // resolved from SparkLend AddressesProvider
  deployBlock: SPARK_DEPLOY_BLOCK,
  scanChunk: 49_000n,
  maxChunksPerCall: 500,
}

// Morpho Blue uses a different event shape (indexed bytes32 market id),
// so scanning goes through a dedicated code path. Pricing falls back to
// the Aave oracle for tokens it supports, then DeFiLlama for the rest.
export const MORPHO_CONFIG: ProtocolConfig = {
  name: "morpho_blue",
  scannerName: "morpho_blue",
  poolAddress: MORPHO_BLUE as `0x${string}`,
  oracleAddress: AAVE_V3_ORACLE as `0x${string}`, // used for price lookups only
  deployBlock: MORPHO_DEPLOY_BLOCK,
  scanChunk: 49_000n,
  maxChunksPerCall: 500,
}

// Fluid is architecturally different: there are many vault contracts, each
// emitting LogLiquidate. We discover vault addresses via NewPositionMinted
// on the factory, then scan each vault separately for LogLiquidate events.
// The poolAddress here is the factory, used only for discovery.
export const FLUID_CONFIG: ProtocolConfig = {
  name: "fluid",
  scannerName: "fluid",
  poolAddress: FLUID_VAULT_FACTORY as `0x${string}`,
  oracleAddress: AAVE_V3_ORACLE as `0x${string}`, // used for price lookups
  deployBlock: FLUID_DEPLOY_BLOCK,
  scanChunk: 49_000n,
  maxChunksPerCall: 500,
}
