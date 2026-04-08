/**
 * Fluid vault discovery and metadata resolver.
 *
 * Fluid has N vault contracts (one per collateral/debt pair), each deployed
 * via the FluidVaultFactory. The factory doesn't emit a usable vault-creation
 * event, but every new user position in a vault emits a NewPositionMinted
 * event from the factory where `minter` is the vault contract address.
 *
 * So vault discovery works by scanning NewPositionMinted and collecting the
 * unique `minter` values. For each newly-discovered vault we then call
 * constantsView() to get the supply/borrow tokens and cache in fluid_vaults.
 *
 * T2/T3/T4 vaults (smart collateral/debt) have non-ERC20 tokens in one or
 * both slots — we mark them `resolved = false` and skip liquidation tracking
 * for them in the first iteration.
 */
import { logsClient, ethClient } from "@/lib/rpc"
import { rawSql, sql } from "@/lib/db"
import {
  FLUID_VAULT_FACTORY,
  FLUID_VAULT_CONSTANTS_ABI,
  FLUID_NEW_POSITION_MINTED_ABI,
  NATIVE_ETH_SENTINEL,
  WETH_ADDRESS,
  ERC20_ABI,
} from "@/lib/contracts"
import { parseAbiItem } from "viem"

const NEW_POSITION_MINTED_EVENT = parseAbiItem(
  "event NewPositionMinted(address indexed minter, address indexed user, uint256 indexed tokenId)"
)

export interface FluidVault {
  address: string
  supplyToken: string
  borrowToken: string
  supplyDecimals: number
  borrowDecimals: number
  supplySymbol: string | null
  borrowSymbol: string | null
  vaultId: number
  resolved: boolean // true if we could decode constantsView AND both tokens are ERC20s (or native ETH)
}

const memoryCache = new Map<string, FluidVault>()

/**
 * Load all resolved vaults from the DB into memory. Called once at the
 * start of a scan run.
 */
export async function loadResolvedVaults(): Promise<FluidVault[]> {
  const rows = await rawSql(
    `SELECT address, supply_token, borrow_token, supply_decimals, borrow_decimals,
            supply_symbol, borrow_symbol, vault_id, resolved
     FROM fluid_vaults`
  )
  const all: FluidVault[] = []
  for (const r of rows) {
    const v: FluidVault = {
      address: r.address,
      supplyToken: r.supply_token ?? "",
      borrowToken: r.borrow_token ?? "",
      supplyDecimals: Number(r.supply_decimals ?? 18),
      borrowDecimals: Number(r.borrow_decimals ?? 18),
      supplySymbol: r.supply_symbol ?? null,
      borrowSymbol: r.borrow_symbol ?? null,
      vaultId: Number(r.vault_id ?? 0),
      resolved: r.resolved === true,
    }
    memoryCache.set(v.address, v)
    all.push(v)
  }
  return all
}

/**
 * Discover new vault addresses from factory events between two blocks.
 * Returns the set of newly-seen vault addresses (not already in the DB).
 */
export async function discoverVaults(
  fromBlock: bigint,
  toBlock: bigint,
  scanChunk: bigint = 49_000n
): Promise<string[]> {
  const seen = new Set<string>()

  // Prime with already-known vaults so we only return NEW ones
  const existing = await rawSql(`SELECT address FROM fluid_vaults`)
  const existingSet = new Set(existing.map((r: any) => r.address))

  // Scan factory in chunks
  let cursor = fromBlock
  while (cursor <= toBlock) {
    const chunkEnd = cursor + scanChunk > toBlock ? toBlock : cursor + scanChunk
    try {
      const logs = await logsClient.getLogs({
        address: FLUID_VAULT_FACTORY as `0x${string}`,
        event: NEW_POSITION_MINTED_EVENT,
        fromBlock: cursor,
        toBlock: chunkEnd,
      })
      for (const l of logs) {
        const addr = l.args.minter?.toLowerCase()
        if (addr && !existingSet.has(addr) && !seen.has(addr)) {
          seen.add(addr)
        }
      }
    } catch (e: any) {
      console.warn(`Fluid discovery error ${cursor}-${chunkEnd}: ${e?.message?.slice(0, 100)}`)
    }
    cursor = chunkEnd + 1n
  }

  return [...seen]
}

/**
 * Resolve metadata for one vault by calling constantsView(). Also reads the
 * symbol for each token (treating 0xEEE...eEE as ETH and mapping to WETH).
 * Writes the result to the fluid_vaults DB.
 */
export async function resolveVaultMetadata(vaultAddress: string): Promise<FluidVault> {
  const addr = vaultAddress.toLowerCase()
  if (memoryCache.has(addr)) return memoryCache.get(addr)!

  // Default unresolved placeholder
  const placeholder: FluidVault = {
    address: addr,
    supplyToken: "",
    borrowToken: "",
    supplyDecimals: 18,
    borrowDecimals: 18,
    supplySymbol: null,
    borrowSymbol: null,
    vaultId: 0,
    resolved: false,
  }

  try {
    const raw = (await ethClient.readContract({
      address: addr as `0x${string}`,
      abi: FLUID_VAULT_CONSTANTS_ABI,
      functionName: "constantsView",
    })) as {
      supplyToken: string
      borrowToken: string
      supplyDecimals: number
      borrowDecimals: number
      vaultId: bigint
    }

    const supplyAddr = raw.supplyToken.toLowerCase()
    const borrowAddr = raw.borrowToken.toLowerCase()
    // Normalize native ETH sentinel to WETH for pricing purposes
    const normSupply = supplyAddr === NATIVE_ETH_SENTINEL.toLowerCase() ? WETH_ADDRESS.toLowerCase() : supplyAddr
    const normBorrow = borrowAddr === NATIVE_ETH_SENTINEL.toLowerCase() ? WETH_ADDRESS.toLowerCase() : borrowAddr

    // Try to resolve symbols — failure means smart col/debt
    let supplySymbol: string | null = null
    let borrowSymbol: string | null = null
    let supplyOk = false
    let borrowOk = false
    try {
      supplySymbol = (await ethClient.readContract({
        address: normSupply as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "symbol",
      })) as string
      supplyOk = true
    } catch {
      supplySymbol = null
    }
    try {
      borrowSymbol = (await ethClient.readContract({
        address: normBorrow as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "symbol",
      })) as string
      borrowOk = true
    } catch {
      borrowSymbol = null
    }

    // Convert ETH sentinel symbol presentation
    if (supplyAddr === NATIVE_ETH_SENTINEL.toLowerCase()) supplySymbol = "ETH"
    if (borrowAddr === NATIVE_ETH_SENTINEL.toLowerCase()) borrowSymbol = "ETH"

    const vault: FluidVault = {
      address: addr,
      supplyToken: normSupply,
      borrowToken: normBorrow,
      supplyDecimals: Number(raw.supplyDecimals),
      borrowDecimals: Number(raw.borrowDecimals),
      supplySymbol,
      borrowSymbol,
      vaultId: Number(raw.vaultId),
      resolved: supplyOk && borrowOk,
    }
    memoryCache.set(addr, vault)

    // Persist
    await rawSql(
      `INSERT INTO fluid_vaults
         (address, supply_token, borrow_token, supply_decimals, borrow_decimals,
          supply_symbol, borrow_symbol, vault_id, resolved)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (address) DO UPDATE SET
         supply_token = EXCLUDED.supply_token,
         borrow_token = EXCLUDED.borrow_token,
         supply_decimals = EXCLUDED.supply_decimals,
         borrow_decimals = EXCLUDED.borrow_decimals,
         supply_symbol = EXCLUDED.supply_symbol,
         borrow_symbol = EXCLUDED.borrow_symbol,
         vault_id = EXCLUDED.vault_id,
         resolved = EXCLUDED.resolved`,
      [
        vault.address,
        vault.supplyToken,
        vault.borrowToken,
        vault.supplyDecimals,
        vault.borrowDecimals,
        vault.supplySymbol,
        vault.borrowSymbol,
        vault.vaultId,
        vault.resolved,
      ]
    )

    return vault
  } catch (e: any) {
    // constantsView() failed entirely — likely a T2/T3/T4 smart vault with
    // a different struct. Save placeholder so we don't retry.
    console.warn(`Fluid vault ${addr.slice(0, 12)}... constantsView failed: ${e?.message?.slice(0, 100)}`)
    try {
      await rawSql(
        `INSERT INTO fluid_vaults (address, resolved) VALUES ($1, false)
         ON CONFLICT (address) DO NOTHING`,
        [placeholder.address]
      )
    } catch {}
    memoryCache.set(addr, placeholder)
    return placeholder
  }
}

/**
 * Resolve metadata for many vaults, with a small concurrency limit.
 */
export async function resolveManyVaults(addresses: string[], concurrency = 3): Promise<FluidVault[]> {
  const result: FluidVault[] = []
  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency)
    const resolved = await Promise.all(batch.map(a => resolveVaultMetadata(a)))
    result.push(...resolved)
    // small delay to avoid hammering RPCs during discovery phase
    await new Promise(r => setTimeout(r, 200))
  }
  return result
}
