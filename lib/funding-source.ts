/**
 * Funding source detection for liquidator addresses.
 *
 * Finds the first incoming ETH transfer to a wallet — useful for clustering
 * bots that share a common funding source (often a CEX deposit address or
 * the operator's main wallet).
 *
 * Uses Etherscan's free API. If ETHERSCAN_API_KEY is set in env, we get
 * higher rate limits; otherwise we use the unauthenticated tier.
 */
import { rawSql } from "@/lib/db"

export interface FundingSource {
  fromAddress: string
  txHash: string
  blockNumber: number
  timestamp: number
  valueEth: number
  fromLabel?: string
  kind: "deployer" | "funding"  // "deployer" for contracts, "funding" for EOAs
}

// Known CEX/operator labels for common funding sources
const KNOWN_LABELS: Record<string, string> = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance 14",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance 15",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance 16",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance 17",
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance 18",
  "0x4976a4a02f38326660d17bf34b431dc6e2eb2327": "Binance 19",
  "0x46340b20830761efd32832a74d7169b29feb9758": "Binance 20",
  "0xd24400ae8bfebb18ca49be86258a3c749cf46853": "Gemini 1",
  "0x07ee55aa48bb72dcc6e9d78256648910de513eca": "OKX",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX 2",
  "0xa910f92acdaf488fa6ef02174fb86208ad7722ba": "OKX 3",
  "0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5": "Binance Hot Wallet",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance 8",
  "0x5a52e96bacdabb82fd05763e25335261b270efcb": "Binance 19",
  "0x40b38765696e3d5d8d9d834d8aad4bb6e418e489": "Robinhood",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
}

function labelFor(address: string): string | undefined {
  return KNOWN_LABELS[address.toLowerCase()]
}

/**
 * Fetch the first incoming ETH transfer to an address using Etherscan API.
 * Etherscan free tier: 5 calls/sec, 100K calls/day.
 * Set ETHERSCAN_API_KEY env var for authenticated tier.
 */
export async function getFundingSource(
  liquidator: string
): Promise<FundingSource | null> {
  // Check DB cache first
  try {
    const cached = await rawSql(
      "SELECT * FROM funding_source_cache WHERE liquidator = $1",
      [liquidator.toLowerCase()]
    )
    if (cached.length > 0) {
      const c = cached[0]
      // Only return cached if it has a valid from_address
      if (c.from_address) {
        return {
          fromAddress: c.from_address,
          txHash: c.tx_hash,
          blockNumber: Number(c.block_number),
          timestamp: Number(c.timestamp),
          valueEth: Number(c.value_eth),
          fromLabel: labelFor(c.from_address) || c.from_label || undefined,
          kind: (c.kind as "deployer" | "funding") || "funding",
        }
      }
    }
  } catch {
    // Table may not exist yet
  }

  // Try Etherscan first if API key is set, otherwise fall back to Blockscout (keyless)
  const apiKey = process.env.ETHERSCAN_API_KEY || ""
  const endpoints = apiKey
    ? [
        `https://api.etherscan.io/api?module=account&action=txlist&address=${liquidator}&startblock=0&endblock=99999999&page=1&offset=100&sort=asc&apikey=${apiKey}`,
        `https://eth.blockscout.com/api?module=account&action=txlist&address=${liquidator}&startblock=0&endblock=99999999&page=1&offset=100&sort=asc`,
      ]
    : [
        `https://eth.blockscout.com/api?module=account&action=txlist&address=${liquidator}&startblock=0&endblock=99999999&page=1&offset=100&sort=asc`,
      ]

  try {
    let data: any = null
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
        if (!res.ok) continue
        const json = await res.json()
        if (json.status === "1" && Array.isArray(json.result) && json.result.length > 0) {
          data = json
          break
        }
      } catch {
        continue
      }
    }

    if (!data) return null

    // First, check if the first transaction is a contract creation
    // (contract creation txs have `to: ""` or `to: null` in Etherscan-style APIs)
    const firstTx = data.result[0]
    let result: FundingSource | null = null

    const isContractCreation =
      firstTx && (!firstTx.to || firstTx.to === "") &&
      firstTx.from?.toLowerCase() !== liquidator.toLowerCase()

    if (isContractCreation) {
      // This is a smart contract — record its deployer
      result = {
        fromAddress: firstTx.from.toLowerCase(),
        txHash: firstTx.hash,
        blockNumber: Number(firstTx.blockNumber),
        timestamp: Number(firstTx.timeStamp),
        valueEth: Number(firstTx.value || 0) / 1e18,
        fromLabel: labelFor(firstTx.from),
        kind: "deployer",
      }
    } else {
      // EOA — find the first incoming ETH transfer with non-zero value
      const incoming = data.result.find(
        (tx: any) =>
          tx.to?.toLowerCase() === liquidator.toLowerCase() &&
          tx.value &&
          tx.value !== "0" &&
          tx.from?.toLowerCase() !== liquidator.toLowerCase()
      )

      if (incoming) {
        result = {
          fromAddress: incoming.from.toLowerCase(),
          txHash: incoming.hash,
          blockNumber: Number(incoming.blockNumber),
          timestamp: Number(incoming.timeStamp),
          valueEth: Number(incoming.value) / 1e18,
          fromLabel: labelFor(incoming.from),
          kind: "funding",
        }
      }
    }

    if (!result) return null

    // Cache it
    try {
      await rawSql(
        `INSERT INTO funding_source_cache
          (liquidator, from_address, tx_hash, block_number, timestamp, value_eth, from_label, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (liquidator) DO UPDATE SET
           from_address = EXCLUDED.from_address,
           tx_hash = EXCLUDED.tx_hash,
           block_number = EXCLUDED.block_number,
           timestamp = EXCLUDED.timestamp,
           value_eth = EXCLUDED.value_eth,
           from_label = EXCLUDED.from_label,
           kind = EXCLUDED.kind`,
        [
          liquidator.toLowerCase(),
          result.fromAddress,
          result.txHash,
          result.blockNumber,
          result.timestamp,
          result.valueEth,
          result.fromLabel || null,
          result.kind,
        ]
      )
    } catch {
      // Cache miss is non-fatal
    }

    return result
  } catch (e: any) {
    console.warn(`Funding source fetch failed for ${liquidator}:`, e?.message?.slice(0, 100))
    return null
  }
}
