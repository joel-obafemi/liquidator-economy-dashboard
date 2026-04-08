import { parseAbiItem } from "viem"
import { logsClient } from "@/lib/rpc"
import { sql, rawSql } from "@/lib/db"
import {
  type ProtocolConfig,
  AAVE_CONFIG,
  SPARK_CONFIG,
  MORPHO_CONFIG,
  FLUID_CONFIG,
  FLUID_VAULT_FACTORY,
} from "@/lib/contracts"
import { resolveTokenMetadata } from "@/lib/tokens"
import { getOraclePricesAtBlock, getOracleForProtocol, calculateUsdValues } from "@/lib/oracle-prices"
import { getPricesWithFallback } from "@/lib/price-router"
import { resolveMarkets } from "@/lib/morpho-markets"
import {
  discoverVaults,
  resolveManyVaults,
  loadResolvedVaults,
  type FluidVault,
} from "@/lib/fluid-vaults"
import type { RawLiquidationEvent, EnrichedLiquidationEvent } from "@/lib/types"

const LIQUIDATION_CALL_EVENT = parseAbiItem(
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)"
)

const MORPHO_LIQUIDATE_EVENT = parseAbiItem(
  "event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)"
)

const FLUID_LIQUIDATE_EVENT = parseAbiItem(
  "event LogLiquidate(address liquidator_, uint256 actualColAmt_, uint256 actualDebtAmt_, address to_)"
)

const FLUSH_EVERY = 25
const MORPHO_FLUSH_EVERY = 5 // Morpho enrichment is slower (per-block resolution), flush sooner
const FLUID_FLUSH_EVERY = 5 // Similar reasoning: per-block price fetch + multi-vault scanning
// Multi-address getLogs is rejected by public RPCs above ~5 addresses for Fluid
const FLUID_VAULT_BATCH_SIZE = 4

const blockTimestampCache = new Map<number, number>()

async function resolveTimestamps(blockNumbers: number[]): Promise<void> {
  const needed = blockNumbers.filter((b) => !blockTimestampCache.has(b))
  if (needed.length === 0) return

  const unique = [...new Set(needed)]
  const BATCH = 50
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map((bn) => logsClient.getBlock({ blockNumber: BigInt(bn) }))
    )
    results.forEach((res, idx) => {
      if (res.status === "fulfilled") {
        blockTimestampCache.set(batch[idx], Number(res.value.timestamp))
      }
    })
  }
}

async function enrichAndInsert(
  events: RawLiquidationEvent[],
  protocolName: string
): Promise<number> {
  if (events.length === 0) return 0

  // Resolve token metadata
  const allTokenAddrs = new Set<string>()
  for (const e of events) {
    allTokenAddrs.add(e.collateralAsset)
    allTokenAddrs.add(e.debtAsset)
  }
  const tokenMeta = await resolveTokenMetadata([...allTokenAddrs])

  // Fill in symbols
  for (const event of events) {
    if (!event.collateralSymbol || event.collateralSymbol === "") {
      event.collateralSymbol = tokenMeta.get(event.collateralAsset)?.symbol || "UNKNOWN"
    }
    if (!event.debtSymbol || event.debtSymbol === "") {
      event.debtSymbol = tokenMeta.get(event.debtAsset)?.symbol || "UNKNOWN"
    }
  }

  // Group events by block number for efficient oracle price fetching
  const oracleAddress = getOracleForProtocol(protocolName)
  const byBlock = new Map<number, RawLiquidationEvent[]>()
  for (const e of events) {
    if (!byBlock.has(e.blockNumber)) byBlock.set(e.blockNumber, [])
    byBlock.get(e.blockNumber)!.push(e)
  }

  const enriched: EnrichedLiquidationEvent[] = []

  // Fetch oracle prices per block
  for (const [blockNum, blockEvents] of byBlock) {
    const assetsNeeded = new Set<string>()
    for (const e of blockEvents) {
      assetsNeeded.add(e.collateralAsset)
      assetsNeeded.add(e.debtAsset)
    }

    let prices: Map<string, number>
    try {
      prices = await getOraclePricesAtBlock(oracleAddress, [...assetsNeeded], BigInt(blockNum))
    } catch (e: any) {
      console.warn(`Oracle price error at block ${blockNum}: ${e?.message?.slice(0, 100)}`)
      prices = new Map()
    }

    for (const e of blockEvents) {
      const collMeta = tokenMeta.get(e.collateralAsset.toLowerCase())
      const debtMeta = tokenMeta.get(e.debtAsset.toLowerCase())
      const collDecimals = collMeta?.decimals ?? 18
      const debtDecimals = debtMeta?.decimals ?? 18

      const collPrice = prices.get(e.collateralAsset.toLowerCase()) ?? 0
      const debtPrice = prices.get(e.debtAsset.toLowerCase()) ?? 0

      const { collateralAmountUsd, debtAmountUsd, grossProfitUsd } = calculateUsdValues(
        collPrice, debtPrice,
        e.liquidatedCollateralAmount, e.debtToCover,
        collDecimals, debtDecimals
      )

      enriched.push({ ...e, debtAmountUsd, collateralAmountUsd, grossProfitUsd })
    }
  }

  return insertEnriched(enriched, protocolName)
}

/**
 * Shared insert path — handles both Aave/Spark and Morpho events,
 * including the optional market_id and bad_debt columns.
 */
async function insertEnriched(
  enriched: EnrichedLiquidationEvent[],
  protocolName: string
): Promise<number> {
  if (enriched.length === 0) return 0

  const sqlValue = (v: string | null | undefined) => (v === null || v === undefined ? "NULL" : `'${v.replace(/'/g, "''")}'`)
  const sqlNum = (v: bigint | number | null | undefined) => (v === null || v === undefined ? "NULL" : `'${v.toString()}'`)

  const BATCH = 100
  let inserted = 0
  for (let i = 0; i < enriched.length; i += BATCH) {
    const batch = enriched.slice(i, i + BATCH)
    const values = batch
      .map((e) => {
        const badDebtRaw = e.badDebtAssets !== null && e.badDebtAssets !== undefined ? sqlNum(e.badDebtAssets) : "NULL"
        const badDebtUsd = e.badDebtUsd ?? 0
        return `('${e.protocol}','${e.txHash}',${e.logIndex},${e.blockNumber},${e.blockTimestamp},'${e.liquidator}','${e.borrower}','${e.collateralAsset}','${e.debtAsset}','${e.collateralSymbol.replace(/'/g, "''")}','${e.debtSymbol.replace(/'/g, "''")}','${e.debtToCover.toString()}','${e.liquidatedCollateralAmount.toString()}',${e.receiveAToken},${e.debtAmountUsd},${e.collateralAmountUsd},${e.grossProfitUsd},${sqlValue(e.marketId)},${badDebtRaw},${badDebtUsd})`
      })
      .join(",")

    try {
      await rawSql(`
        INSERT INTO liquidation_events
          (protocol, tx_hash, log_index, block_number, block_timestamp, liquidator, borrower,
           collateral_asset, debt_asset, collateral_symbol, debt_symbol,
           debt_to_cover, liquidated_collateral_amount, receive_a_token,
           debt_amount_usd, collateral_amount_usd, gross_profit_usd,
           market_id, bad_debt_assets, bad_debt_usd)
        VALUES ${values}
        ON CONFLICT (tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover) DO NOTHING
      `)
      inserted += batch.length
    } catch (e: any) {
      console.warn(`Insert batch error (${protocolName}):`, e?.message?.slice(0, 100))
      for (const ev of batch) {
        try {
          await rawSql(
            `INSERT INTO liquidation_events
              (protocol, tx_hash, log_index, block_number, block_timestamp, liquidator, borrower,
               collateral_asset, debt_asset, collateral_symbol, debt_symbol,
               debt_to_cover, liquidated_collateral_amount, receive_a_token,
               debt_amount_usd, collateral_amount_usd, gross_profit_usd,
               market_id, bad_debt_assets, bad_debt_usd)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            ON CONFLICT (tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover) DO NOTHING`,
            [ev.protocol, ev.txHash, ev.logIndex, ev.blockNumber, ev.blockTimestamp,
             ev.liquidator, ev.borrower, ev.collateralAsset, ev.debtAsset,
             ev.collateralSymbol, ev.debtSymbol,
             ev.debtToCover.toString(), ev.liquidatedCollateralAmount.toString(),
             ev.receiveAToken, ev.debtAmountUsd, ev.collateralAmountUsd, ev.grossProfitUsd,
             ev.marketId ?? null,
             ev.badDebtAssets !== null && ev.badDebtAssets !== undefined ? ev.badDebtAssets.toString() : null,
             ev.badDebtUsd ?? 0]
          )
          inserted++
        } catch (e2: any) {
          console.warn(`  Single insert fail: tx=${ev.txHash.slice(0,10)} err=${e2?.message?.slice(0, 80)}`)
        }
      }
    }
  }

  return inserted
}

async function scanProtocol(
  config: ProtocolConfig
): Promise<{ blocksScanned: number; newEvents: number; lastBlock: number }> {
  const currentBlock = await logsClient.getBlockNumber()

  const stateRows = await sql`SELECT last_scanned_block FROM scan_state WHERE scanner_name = ${config.scannerName}`
  let lastScannedBlock = stateRows.length > 0 ? BigInt(stateRows[0].last_scanned_block) : 0n

  let fromBlock = lastScannedBlock > 0n ? lastScannedBlock + 1n : config.deployBlock
  let chunksScanned = 0
  let totalEvents = 0
  let pendingEvents: RawLiquidationEvent[] = []

  while (fromBlock <= currentBlock && chunksScanned < config.maxChunksPerCall) {
    const toBlock =
      fromBlock + config.scanChunk > currentBlock
        ? currentBlock
        : fromBlock + config.scanChunk

    try {
      const logs = await logsClient.getLogs({
        address: config.poolAddress,
        event: LIQUIDATION_CALL_EVENT,
        fromBlock,
        toBlock,
      })

      if (logs.length > 0) {
        const blockNums = [...new Set(logs.map((l) => Number(l.blockNumber)))]
        await resolveTimestamps(blockNums)

        for (const log of logs) {
          try {
            const args = log.args
            pendingEvents.push({
              txHash: log.transactionHash!,
              logIndex: Number(log.logIndex),
              blockNumber: Number(log.blockNumber),
              blockTimestamp: blockTimestampCache.get(Number(log.blockNumber)) || 0,
              protocol: config.name,
              liquidator: (args.liquidator as string).toLowerCase(),
              borrower: (args.user as string).toLowerCase(),
              collateralAsset: (args.collateralAsset as string).toLowerCase(),
              debtAsset: (args.debtAsset as string).toLowerCase(),
              collateralSymbol: "",
              debtSymbol: "",
              debtToCover: args.debtToCover as bigint,
              liquidatedCollateralAmount: args.liquidatedCollateralAmount as bigint,
              receiveAToken: args.receiveAToken as boolean,
            })
          } catch (decodeErr: any) {
            console.warn(`Decode error at tx ${log.transactionHash}:`, decodeErr?.message?.slice(0, 100))
          }
        }
      }
    } catch (e: any) {
      console.error(`Scan error [${config.name} ${fromBlock}-${toBlock}]:`, e?.message?.slice(0, 200))
    }

    chunksScanned++

    if (chunksScanned % FLUSH_EVERY === 0 || fromBlock + config.scanChunk > currentBlock) {
      if (pendingEvents.length > 0) {
        const inserted = await enrichAndInsert(pendingEvents, config.name)
        totalEvents += inserted
        console.log(`  [${config.name}] FLUSH: inserted ${inserted} events (total: ${totalEvents})`)
        pendingEvents = []
      }

      const progressBlock = toBlock > currentBlock ? currentBlock : toBlock
      await rawSql(`
        INSERT INTO scan_state (scanner_name, last_scanned_block, updated_at)
        VALUES ('${config.scannerName}', ${Number(progressBlock)}, now())
        ON CONFLICT (scanner_name) DO UPDATE SET
          last_scanned_block = EXCLUDED.last_scanned_block,
          updated_at = now()
      `)
    }

    const pct = ((Number(toBlock - config.deployBlock) / Number(currentBlock - config.deployBlock)) * 100).toFixed(1)
    if (chunksScanned % 5 === 0) {
      console.log(`  [${config.name}] chunk ${chunksScanned}: block ${toBlock} (${pct}%), pending: ${pendingEvents.length}, total inserted: ${totalEvents}`)
    }

    fromBlock = toBlock + 1n
  }

  if (pendingEvents.length > 0) {
    const inserted = await enrichAndInsert(pendingEvents, config.name)
    totalEvents += inserted
    console.log(`  [${config.name}] FINAL FLUSH: inserted ${inserted} events (total: ${totalEvents})`)
  }

  lastScannedBlock = fromBlock > currentBlock ? currentBlock : fromBlock - 1n

  await rawSql(`
    INSERT INTO scan_state (scanner_name, last_scanned_block, updated_at)
    VALUES ('${config.scannerName}', ${Number(lastScannedBlock)}, now())
    ON CONFLICT (scanner_name) DO UPDATE SET
      last_scanned_block = EXCLUDED.last_scanned_block,
      updated_at = now()
  `)

  return {
    blocksScanned: chunksScanned * Number(config.scanChunk),
    newEvents: totalEvents,
    lastBlock: Number(lastScannedBlock),
  }
}

// ═══════════════════════════════════════════════════════════════
// Morpho Blue scanner
// ═══════════════════════════════════════════════════════════════

interface MorphoRawEvent {
  txHash: string
  logIndex: number
  blockNumber: number
  blockTimestamp: number
  marketId: string
  liquidator: string
  borrower: string
  repaidAssets: bigint
  seizedAssets: bigint
  badDebtAssets: bigint
}

/**
 * Morpho Blue uses a single pool contract with per-market liquidations.
 * Events only carry a bytes32 market id, so for each unique market we
 * call idToMarketParams() to get loan/collateral token addresses.
 * Prices fall back from Aave oracle -> DeFiLlama.
 */
async function enrichAndInsertMorpho(events: MorphoRawEvent[]): Promise<number> {
  if (events.length === 0) return 0

  // 1. Resolve all unique market IDs to loan/collateral tokens
  const uniqueMarketIds = [...new Set(events.map(e => e.marketId))]
  const markets = await resolveMarkets(uniqueMarketIds)

  // 2. Collect unique tokens across all resolved markets + resolve metadata
  const allTokenAddrs = new Set<string>()
  for (const m of markets.values()) {
    allTokenAddrs.add(m.loanToken)
    allTokenAddrs.add(m.collateralToken)
  }
  const tokenMeta = await resolveTokenMetadata([...allTokenAddrs])

  // 3. Group events by block for efficient price fetching
  const byBlock = new Map<number, MorphoRawEvent[]>()
  for (const e of events) {
    if (!byBlock.has(e.blockNumber)) byBlock.set(e.blockNumber, [])
    byBlock.get(e.blockNumber)!.push(e)
  }

  const enriched: EnrichedLiquidationEvent[] = []

  // Process blocks with a concurrency limit so we don't sit idle on
  // sequential RPC/DeFiLlama calls. 5 is a good balance for free RPCs.
  const blockEntries = [...byBlock.entries()]
  const PARALLEL = 5

  const blockPriceMaps = new Map<number, Map<string, number>>()

  for (let i = 0; i < blockEntries.length; i += PARALLEL) {
    const batch = blockEntries.slice(i, i + PARALLEL)

    await Promise.allSettled(
      batch.map(async ([blockNum, blockEvents]) => {
        const assets = new Set<string>()
        for (const e of blockEvents) {
          const m = markets.get(e.marketId)
          if (m) {
            assets.add(m.loanToken)
            assets.add(m.collateralToken)
          }
        }
        try {
          const prices = await getPricesWithFallback([...assets], BigInt(blockNum), blockEvents[0].blockTimestamp)
          blockPriceMaps.set(blockNum, prices)
        } catch (e: any) {
          console.warn(`Morpho price fetch error at block ${blockNum}: ${e?.message?.slice(0, 80)}`)
          blockPriceMaps.set(blockNum, new Map())
        }
      })
    )
  }

  // Now build the enriched events using the collected price maps
  for (const [blockNum, blockEvents] of byBlock) {
    const prices = blockPriceMaps.get(blockNum) ?? new Map()

    for (const e of blockEvents) {
      const m = markets.get(e.marketId)
      if (!m) continue

      const collMeta = tokenMeta.get(m.collateralToken)
      const loanMeta = tokenMeta.get(m.loanToken)
      const collDecimals = collMeta?.decimals ?? 18
      const loanDecimals = loanMeta?.decimals ?? 18
      const collSymbol = collMeta?.symbol ?? "UNKNOWN"
      const loanSymbol = loanMeta?.symbol ?? "UNKNOWN"

      const collPrice = prices.get(m.collateralToken) ?? 0
      const loanPrice = prices.get(m.loanToken) ?? 0

      // Guard: if EITHER price is missing, we can't compute a meaningful profit.
      // Store zero values instead of a garbage delta, and flag for downstream.
      const hasPrices = collPrice > 0 && loanPrice > 0
      const collateralAmountUsd = hasPrices ? (Number(e.seizedAssets) / 10 ** collDecimals) * collPrice : 0
      const debtAmountUsd = hasPrices ? (Number(e.repaidAssets) / 10 ** loanDecimals) * loanPrice : 0
      const grossProfitUsd = hasPrices ? collateralAmountUsd - debtAmountUsd : 0
      const badDebtUsd = hasPrices ? (Number(e.badDebtAssets) / 10 ** loanDecimals) * loanPrice : 0

      enriched.push({
        txHash: e.txHash,
        logIndex: e.logIndex,
        blockNumber: e.blockNumber,
        blockTimestamp: e.blockTimestamp,
        protocol: "morpho_blue",
        liquidator: e.liquidator,
        borrower: e.borrower,
        collateralAsset: m.collateralToken,
        debtAsset: m.loanToken,
        collateralSymbol: collSymbol,
        debtSymbol: loanSymbol,
        debtToCover: e.repaidAssets,
        liquidatedCollateralAmount: e.seizedAssets,
        receiveAToken: false,
        marketId: e.marketId,
        badDebtAssets: e.badDebtAssets,
        collateralAmountUsd,
        debtAmountUsd,
        grossProfitUsd,
        badDebtUsd,
      })
    }
  }

  return insertEnriched(enriched, "morpho_blue")
}

async function scanMorphoProtocol(
  config: ProtocolConfig
): Promise<{ blocksScanned: number; newEvents: number; lastBlock: number }> {
  const currentBlock = await logsClient.getBlockNumber()

  const stateRows = await sql`SELECT last_scanned_block FROM scan_state WHERE scanner_name = ${config.scannerName}`
  let lastScannedBlock = stateRows.length > 0 ? BigInt(stateRows[0].last_scanned_block) : 0n

  let fromBlock = lastScannedBlock > 0n ? lastScannedBlock + 1n : config.deployBlock
  let chunksScanned = 0
  let totalEvents = 0
  let pendingEvents: MorphoRawEvent[] = []

  while (fromBlock <= currentBlock && chunksScanned < config.maxChunksPerCall) {
    const toBlock =
      fromBlock + config.scanChunk > currentBlock
        ? currentBlock
        : fromBlock + config.scanChunk

    try {
      const logs = await logsClient.getLogs({
        address: config.poolAddress,
        event: MORPHO_LIQUIDATE_EVENT,
        fromBlock,
        toBlock,
      })

      if (logs.length > 0) {
        const blockNums = [...new Set(logs.map((l) => Number(l.blockNumber)))]
        await resolveTimestamps(blockNums)

        for (const log of logs) {
          try {
            const args = log.args
            pendingEvents.push({
              txHash: log.transactionHash!,
              logIndex: Number(log.logIndex),
              blockNumber: Number(log.blockNumber),
              blockTimestamp: blockTimestampCache.get(Number(log.blockNumber)) || 0,
              marketId: (args.id as string).toLowerCase(),
              liquidator: (args.caller as string).toLowerCase(),
              borrower: (args.borrower as string).toLowerCase(),
              repaidAssets: args.repaidAssets as bigint,
              seizedAssets: args.seizedAssets as bigint,
              badDebtAssets: (args.badDebtAssets as bigint) ?? 0n,
            })
          } catch (decodeErr: any) {
            console.warn(`Decode error at tx ${log.transactionHash}:`, decodeErr?.message?.slice(0, 100))
          }
        }
      }
    } catch (e: any) {
      console.error(`Morpho scan error [${fromBlock}-${toBlock}]:`, e?.message?.slice(0, 200))
    }

    chunksScanned++

    if (chunksScanned % MORPHO_FLUSH_EVERY === 0 || fromBlock + config.scanChunk > currentBlock) {
      if (pendingEvents.length > 0) {
        const inserted = await enrichAndInsertMorpho(pendingEvents)
        totalEvents += inserted
        console.log(`  [morpho_blue] FLUSH: inserted ${inserted} events (total: ${totalEvents})`)
        pendingEvents = []
      }

      const progressBlock = toBlock > currentBlock ? currentBlock : toBlock
      await rawSql(`
        INSERT INTO scan_state (scanner_name, last_scanned_block, updated_at)
        VALUES ('${config.scannerName}', ${Number(progressBlock)}, now())
        ON CONFLICT (scanner_name) DO UPDATE SET
          last_scanned_block = EXCLUDED.last_scanned_block,
          updated_at = now()
      `)
    }

    const pct = ((Number(toBlock - config.deployBlock) / Number(currentBlock - config.deployBlock)) * 100).toFixed(1)
    if (chunksScanned % 5 === 0) {
      console.log(`  [morpho_blue] chunk ${chunksScanned}: block ${toBlock} (${pct}%), pending: ${pendingEvents.length}, total inserted: ${totalEvents}`)
    }

    fromBlock = toBlock + 1n
  }

  if (pendingEvents.length > 0) {
    const inserted = await enrichAndInsertMorpho(pendingEvents)
    totalEvents += inserted
    console.log(`  [morpho_blue] FINAL FLUSH: inserted ${inserted} events (total: ${totalEvents})`)
  }

  lastScannedBlock = fromBlock > currentBlock ? currentBlock : fromBlock - 1n

  await rawSql(`
    INSERT INTO scan_state (scanner_name, last_scanned_block, updated_at)
    VALUES ('${config.scannerName}', ${Number(lastScannedBlock)}, now())
    ON CONFLICT (scanner_name) DO UPDATE SET
      last_scanned_block = EXCLUDED.last_scanned_block,
      updated_at = now()
  `)

  return {
    blocksScanned: chunksScanned * Number(config.scanChunk),
    newEvents: totalEvents,
    lastBlock: Number(lastScannedBlock),
  }
}

// ═══════════════════════════════════════════════════════════════
// Fluid scanner
// ═══════════════════════════════════════════════════════════════

interface FluidRawEvent {
  txHash: string
  logIndex: number
  blockNumber: number
  blockTimestamp: number
  vaultAddress: string
  liquidator: string
  to: string
  actualColAmt: bigint
  actualDebtAmt: bigint
}

async function enrichAndInsertFluid(
  events: FluidRawEvent[],
  vaultLookup: Map<string, FluidVault>
): Promise<number> {
  if (events.length === 0) return 0

  // Group by block for batched price fetching
  const byBlock = new Map<number, FluidRawEvent[]>()
  for (const e of events) {
    if (!byBlock.has(e.blockNumber)) byBlock.set(e.blockNumber, [])
    byBlock.get(e.blockNumber)!.push(e)
  }

  // Parallel price fetching with concurrency limit
  const blockPriceMaps = new Map<number, Map<string, number>>()
  const blockEntries = [...byBlock.entries()]
  const PARALLEL = 5

  for (let i = 0; i < blockEntries.length; i += PARALLEL) {
    const batch = blockEntries.slice(i, i + PARALLEL)
    await Promise.allSettled(
      batch.map(async ([blockNum, blockEvents]) => {
        const assets = new Set<string>()
        for (const e of blockEvents) {
          const v = vaultLookup.get(e.vaultAddress)
          if (v && v.resolved) {
            assets.add(v.supplyToken)
            assets.add(v.borrowToken)
          }
        }
        if (assets.size === 0) {
          blockPriceMaps.set(blockNum, new Map())
          return
        }
        try {
          const prices = await getPricesWithFallback([...assets], BigInt(blockNum), blockEvents[0].blockTimestamp)
          blockPriceMaps.set(blockNum, prices)
        } catch (e: any) {
          console.warn(`Fluid price fetch error at block ${blockNum}: ${e?.message?.slice(0, 80)}`)
          blockPriceMaps.set(blockNum, new Map())
        }
      })
    )
  }

  const enriched: EnrichedLiquidationEvent[] = []
  for (const [blockNum, blockEvents] of byBlock) {
    const prices = blockPriceMaps.get(blockNum) ?? new Map()

    for (const e of blockEvents) {
      const v = vaultLookup.get(e.vaultAddress)
      if (!v || !v.resolved) continue

      const collPrice = prices.get(v.supplyToken) ?? 0
      const debtPrice = prices.get(v.borrowToken) ?? 0
      const hasPrices = collPrice > 0 && debtPrice > 0

      const collateralAmountUsd = hasPrices ? (Number(e.actualColAmt) / 10 ** v.supplyDecimals) * collPrice : 0
      const debtAmountUsd = hasPrices ? (Number(e.actualDebtAmt) / 10 ** v.borrowDecimals) * debtPrice : 0
      const grossProfitUsd = hasPrices ? collateralAmountUsd - debtAmountUsd : 0

      enriched.push({
        txHash: e.txHash,
        logIndex: e.logIndex,
        blockNumber: e.blockNumber,
        blockTimestamp: e.blockTimestamp,
        protocol: "fluid",
        liquidator: e.liquidator,
        borrower: e.to, // Fluid doesn't emit the original borrower — `to` receives proceeds
        collateralAsset: v.supplyToken,
        debtAsset: v.borrowToken,
        collateralSymbol: v.supplySymbol ?? "UNKNOWN",
        debtSymbol: v.borrowSymbol ?? "UNKNOWN",
        debtToCover: e.actualDebtAmt,
        liquidatedCollateralAmount: e.actualColAmt,
        receiveAToken: false,
        marketId: e.vaultAddress, // use vault address as market id for Fluid
        badDebtAssets: null,
        collateralAmountUsd,
        debtAmountUsd,
        grossProfitUsd,
      })
    }
  }

  return insertEnriched(enriched, "fluid")
}

async function scanFluidProtocol(
  config: ProtocolConfig
): Promise<{ blocksScanned: number; newEvents: number; lastBlock: number }> {
  const currentBlock = await logsClient.getBlockNumber()

  // ── Phase 1: Discovery ─────────────────────────────────────
  // Catch up on factory events to find any new vault addresses.
  console.log(`  [fluid] discovery phase...`)
  const discoveryStateRows = await sql`SELECT last_scanned_block FROM scan_state WHERE scanner_name = 'fluid_discovery'`
  let discoveryFrom = discoveryStateRows.length > 0 && Number(discoveryStateRows[0].last_scanned_block) > 0
    ? BigInt(discoveryStateRows[0].last_scanned_block) + 1n
    : config.deployBlock

  // Limit discovery to the same window we plan to liquidation-scan so we
  // don't stall for hours on a cold run
  const discoveryTo =
    discoveryFrom + config.scanChunk * BigInt(config.maxChunksPerCall) > currentBlock
      ? currentBlock
      : discoveryFrom + config.scanChunk * BigInt(config.maxChunksPerCall)

  if (discoveryTo > discoveryFrom) {
    const newVaults = await discoverVaults(discoveryFrom, discoveryTo, config.scanChunk)
    if (newVaults.length > 0) {
      console.log(`  [fluid] discovered ${newVaults.length} new vaults, resolving metadata...`)
      await resolveManyVaults(newVaults, 3)
    }
    await rawSql(`
      INSERT INTO scan_state (scanner_name, last_scanned_block, updated_at)
      VALUES ('fluid_discovery', ${Number(discoveryTo)}, now())
      ON CONFLICT (scanner_name) DO UPDATE SET
        last_scanned_block = EXCLUDED.last_scanned_block,
        updated_at = now()
    `)
  }

  // ── Phase 2: Liquidation scanning ──────────────────────────
  const allVaults = await loadResolvedVaults()
  const resolvedVaults = allVaults.filter(v => v.resolved)
  const vaultLookup = new Map<string, FluidVault>()
  for (const v of allVaults) vaultLookup.set(v.address, v)

  if (resolvedVaults.length === 0) {
    console.log(`  [fluid] no resolved vaults yet — skipping liquidation scan`)
    return { blocksScanned: 0, newEvents: 0, lastBlock: 0 }
  }
  console.log(`  [fluid] scanning ${resolvedVaults.length} resolved vaults for liquidations...`)

  const stateRows = await sql`SELECT last_scanned_block FROM scan_state WHERE scanner_name = ${config.scannerName}`
  let lastScannedBlock = stateRows.length > 0 ? BigInt(stateRows[0].last_scanned_block) : 0n
  let fromBlock = lastScannedBlock > 0n ? lastScannedBlock + 1n : config.deployBlock
  let chunksScanned = 0
  let totalEvents = 0
  let pendingEvents: FluidRawEvent[] = []

  while (fromBlock <= currentBlock && chunksScanned < config.maxChunksPerCall) {
    const toBlock =
      fromBlock + config.scanChunk > currentBlock
        ? currentBlock
        : fromBlock + config.scanChunk

    // Fluid requires splitting the resolved vault list into smaller batches
    // because public RPCs reject multi-address getLogs with too many entries.
    const allLogs: Array<any> = []
    for (let i = 0; i < resolvedVaults.length; i += FLUID_VAULT_BATCH_SIZE) {
      const batchVaults = resolvedVaults
        .slice(i, i + FLUID_VAULT_BATCH_SIZE)
        .map(v => v.address) as `0x${string}`[]
      try {
        const logs = await logsClient.getLogs({
          address: batchVaults,
          event: FLUID_LIQUIDATE_EVENT,
          fromBlock,
          toBlock,
        })
        allLogs.push(...logs)
      } catch (e: any) {
        console.warn(`Fluid getLogs error [${fromBlock}-${toBlock}] batch ${i}: ${e?.message?.slice(0, 100)}`)
      }
    }

    if (allLogs.length > 0) {
      const blockNums = [...new Set(allLogs.map(l => Number(l.blockNumber)))]
      await resolveTimestamps(blockNums)

      for (const log of allLogs) {
        try {
          const args = log.args
          pendingEvents.push({
            txHash: log.transactionHash!,
            logIndex: Number(log.logIndex),
            blockNumber: Number(log.blockNumber),
            blockTimestamp: blockTimestampCache.get(Number(log.blockNumber)) || 0,
            vaultAddress: log.address.toLowerCase(),
            liquidator: (args.liquidator_ as string).toLowerCase(),
            to: (args.to_ as string).toLowerCase(),
            actualColAmt: args.actualColAmt_ as bigint,
            actualDebtAmt: args.actualDebtAmt_ as bigint,
          })
        } catch (decodeErr: any) {
          console.warn(`Fluid decode error at tx ${log.transactionHash}:`, decodeErr?.message?.slice(0, 100))
        }
      }
    }

    chunksScanned++

    if (chunksScanned % FLUID_FLUSH_EVERY === 0 || fromBlock + config.scanChunk > currentBlock) {
      if (pendingEvents.length > 0) {
        const inserted = await enrichAndInsertFluid(pendingEvents, vaultLookup)
        totalEvents += inserted
        console.log(`  [fluid] FLUSH: inserted ${inserted} events (total: ${totalEvents})`)
        pendingEvents = []
      }

      const progressBlock = toBlock > currentBlock ? currentBlock : toBlock
      await rawSql(`
        INSERT INTO scan_state (scanner_name, last_scanned_block, updated_at)
        VALUES ('${config.scannerName}', ${Number(progressBlock)}, now())
        ON CONFLICT (scanner_name) DO UPDATE SET
          last_scanned_block = EXCLUDED.last_scanned_block,
          updated_at = now()
      `)
    }

    const pct = ((Number(toBlock - config.deployBlock) / Number(currentBlock - config.deployBlock)) * 100).toFixed(1)
    if (chunksScanned % 5 === 0) {
      console.log(`  [fluid] chunk ${chunksScanned}: block ${toBlock} (${pct}%), pending: ${pendingEvents.length}, total inserted: ${totalEvents}`)
    }

    fromBlock = toBlock + 1n
  }

  if (pendingEvents.length > 0) {
    const inserted = await enrichAndInsertFluid(pendingEvents, vaultLookup)
    totalEvents += inserted
    console.log(`  [fluid] FINAL FLUSH: inserted ${inserted} events (total: ${totalEvents})`)
  }

  lastScannedBlock = fromBlock > currentBlock ? currentBlock : fromBlock - 1n

  await rawSql(`
    INSERT INTO scan_state (scanner_name, last_scanned_block, updated_at)
    VALUES ('${config.scannerName}', ${Number(lastScannedBlock)}, now())
    ON CONFLICT (scanner_name) DO UPDATE SET
      last_scanned_block = EXCLUDED.last_scanned_block,
      updated_at = now()
  `)

  return {
    blocksScanned: chunksScanned * Number(config.scanChunk),
    newEvents: totalEvents,
    lastBlock: Number(lastScannedBlock),
  }
}

export async function scanLiquidations(
  protocol: string = "all"
): Promise<
  Record<string, { blocksScanned: number; newEvents: number; lastBlock: number }>
> {
  const result: Record<
    string,
    { blocksScanned: number; newEvents: number; lastBlock: number }
  > = {}

  if (protocol === "all" || protocol === "aave_v3") {
    result.aave_v3 = await scanProtocol(AAVE_CONFIG)
    console.log(
      `Scan Aave V3: ${result.aave_v3.newEvents} events, block ${result.aave_v3.lastBlock}`
    )
  }

  if (protocol === "all" || protocol === "spark") {
    result.spark = await scanProtocol(SPARK_CONFIG)
    console.log(
      `Scan Spark: ${result.spark.newEvents} events, block ${result.spark.lastBlock}`
    )
  }

  if (protocol === "all" || protocol === "morpho_blue") {
    result.morpho_blue = await scanMorphoProtocol(MORPHO_CONFIG)
    console.log(
      `Scan Morpho Blue: ${result.morpho_blue.newEvents} events, block ${result.morpho_blue.lastBlock}`
    )
  }

  if (protocol === "all" || protocol === "fluid") {
    result.fluid = await scanFluidProtocol(FLUID_CONFIG)
    console.log(
      `Scan Fluid: ${result.fluid.newEvents} events, block ${result.fluid.lastBlock}`
    )
  }

  return result
}
