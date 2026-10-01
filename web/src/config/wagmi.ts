import { type Chain, defineChain } from 'viem'
import { type Config, type CreateConnectorFn, createConfig, fallback, http, unstable_connector } from 'wagmi'
import { injected } from 'wagmi/connectors'
import type { Deployment } from './deployment'

/** Build the viem chain description from the runtime deployment configuration. */
export function buildChain(deployment: Pick<Deployment, 'chainId' | 'network'>): Chain {
  const network = deployment.network
  return defineChain({
    id: deployment.chainId,
    name: network?.name ?? `Chain ${deployment.chainId}`,
    testnet: network?.testnet ?? false,
    nativeCurrency: network?.nativeCurrency ?? { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: network?.rpcUrls ?? [] } },
    ...(network?.explorer
      ? { blockExplorers: { default: { name: 'Explorer', url: network.explorer.replace(/\/$/, '') } } }
      : {}),
  })
}

/**
 * Reads go through the vetted public RPC endpoints from the network block, tried in
 * order. When no endpoint is configured the connected wallet's provider is used.
 * Transaction signing always stays with the visitor's wallet.
 */
export interface WagmiConfigOptions {
  /** Override the connector list (tests inject a scripted wallet). */
  connectors?: CreateConnectorFn[]
  /** Block/receipt polling interval in milliseconds. */
  pollingInterval?: number
}

export function buildWagmiConfig(deployment: Pick<Deployment, 'chainId' | 'network'>, options: WagmiConfigOptions = {}): Config {
  const chain = buildChain(deployment)
  const urls = chain.rpcUrls.default.http
  const transport =
    urls.length > 0
      ? fallback(
          // One retry per endpoint, no outer retry: a dead network costs at most
          // 2 x (number of endpoints) requests per read instead of a retry storm.
          urls.map((url) => http(url, { batch: { wait: 16 }, retryCount: 1, retryDelay: 500, timeout: 15_000 })),
          { rank: false, retryCount: 0 },
        )
      : unstable_connector(injected)
  return createConfig({
    chains: [chain],
    connectors: options.connectors ?? [injected()],
    transports: { [chain.id]: transport },
    multiInjectedProviderDiscovery: true,
    pollingInterval: options.pollingInterval ?? 4_000,
  })
}

/** Optional WalletConnect project id (public, not a secret). Unset in this export. */
export const WALLETCONNECT_PROJECT_ID: string | undefined = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
