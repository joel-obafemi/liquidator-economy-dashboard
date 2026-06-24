import { createPublicClient, http, fallback, type PublicClient } from "viem"
import { mainnet } from "viem/chains"

const ETH_RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://eth.llamarpc.com",
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.ankr.com/eth",
]

export const ethClient: PublicClient = createPublicClient({
  chain: mainnet,
  transport: fallback(
    ETH_RPCS.map((url) =>
      http(url, { retryCount: 2, retryDelay: 1000, timeout: 30_000 })
    )
  ),
  batch: { multicall: true },
}) as PublicClient

export const logsClient: PublicClient = createPublicClient({
  chain: mainnet,
  transport: fallback(
    ETH_RPCS.map((url) =>
      http(url, { retryCount: 3, retryDelay: 2000, timeout: 45_000 })
    )
  ),
}) as PublicClient
