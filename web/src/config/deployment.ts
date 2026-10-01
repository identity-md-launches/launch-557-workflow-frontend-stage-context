/**
 * Runtime deployment configuration.
 *
 * The app has exactly one source of addresses, chain id and ABIs: the
 * `imd-deployment.json` file that ships next to `index.html` in the static
 * export. It is generated from the workflow handoff by `scripts/sync-deployment.mjs`
 * and finalised (asset hashes) by `scripts/finalize-export.mjs`. Nothing in the
 * bundle hard-codes an address, a chain id, an RPC URL or an ABI for the deployed
 * contracts.
 */
import { type Abi, type Address, type Hex, getAddress, isAddress, keccak256, stringToHex } from 'viem'

export const DEPLOYMENT_FILE = 'imd-deployment.json'
export const TOKEN_CONTRACT = 'LaunchToken'
export const GUESTBOOK_CONTRACT = 'Guestbook'

export interface DeploymentContract {
  name: string
  address: Address
  abiHash: string
  abiPath: string
}

export interface DeploymentAsset {
  path: string
  sha256: string
}

export interface NativeCurrency {
  name: string
  symbol: string
  decimals: number
}

export interface UniswapV4Addresses {
  poolManager: Address
  universalRouter: Address
  quoter: Address
  stateView: Address
  positionManager: Address
  permit2: Address
}

export interface NetworkConfig {
  chainId: number
  name: string
  testnet: boolean
  rpcUrls: string[]
  explorer: string
  nativeCurrency: NativeCurrency
  faucets?: string[]
  uniswapV4: UniswapV4Addresses
  pairToken?: Address
}

export interface WalletAddChain {
  chainId: Hex
  chainName: string
  rpcUrls: string[]
  nativeCurrency: NativeCurrency
  blockExplorerUrls: string[]
}

export interface PoolKey {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

export interface DeploymentManifest {
  version: 1
  launchId: string
  chainId: number
  sourceCommit: string
  attestationHash: string
  contracts: DeploymentContract[]
  assets: DeploymentAsset[]
  poolKey?: PoolKey
  network?: NetworkConfig
  walletAddChain?: WalletAddChain
}

export interface LoadedContract {
  name: string
  address: Address
  abi: Abi
  abiHash: string
  abiPath: string
}

export interface Deployment {
  manifest: DeploymentManifest
  manifestUrl: string
  chainId: number
  network: NetworkConfig | null
  walletAddChain: WalletAddChain | null
  poolKey: PoolKey | null
  token: LoadedContract
  guestbook: LoadedContract
  contracts: LoadedContract[]
}

export class DeploymentConfigError extends Error {
  override name = 'DeploymentConfigError'
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: { [key: string]: Json } = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key] as Json)
    return out
  }
  return value
}

/** Keccak-256 of the ABI serialised as compact JSON with recursively sorted keys, hex without `0x`. */
export function canonicalAbiHash(abi: unknown): string {
  return keccak256(stringToHex(JSON.stringify(sortKeys(abi as Json)))).slice(2)
}

const HEX64 = /^[0-9a-f]{64}$/

function fail(message: string): never {
  throw new DeploymentConfigError(message)
}

function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) fail(`${label} is not an address`)
  return getAddress(value)
}

function requireRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} is missing`)
  if (/^[a-z]+:/i.test(value) || value.startsWith('/') || value.split('/').includes('..')) {
    fail(`${label} must be a relative path inside the export`)
  }
  return value
}

function validateNetwork(raw: unknown): NetworkConfig {
  if (!raw || typeof raw !== 'object') fail('network block is malformed')
  const n = raw as Record<string, unknown>
  if (typeof n.chainId !== 'number') fail('network.chainId is missing')
  if (typeof n.name !== 'string') fail('network.name is missing')
  if (!Array.isArray(n.rpcUrls) || n.rpcUrls.some((u) => typeof u !== 'string')) fail('network.rpcUrls is malformed')
  if (typeof n.explorer !== 'string') fail('network.explorer is missing')
  const uni = n.uniswapV4 as Record<string, unknown> | undefined
  if (!uni) fail('network.uniswapV4 is missing')
  const uniswapV4: UniswapV4Addresses = {
    poolManager: requireAddress(uni.poolManager, 'network.uniswapV4.poolManager'),
    universalRouter: requireAddress(uni.universalRouter, 'network.uniswapV4.universalRouter'),
    quoter: requireAddress(uni.quoter, 'network.uniswapV4.quoter'),
    stateView: requireAddress(uni.stateView, 'network.uniswapV4.stateView'),
    positionManager: requireAddress(uni.positionManager, 'network.uniswapV4.positionManager'),
    permit2: requireAddress(uni.permit2, 'network.uniswapV4.permit2'),
  }
  const nativeCurrency = (n.nativeCurrency as NativeCurrency | undefined) ?? { name: 'Ether', symbol: 'ETH', decimals: 18 }
  return {
    chainId: n.chainId,
    name: n.name,
    testnet: Boolean(n.testnet),
    rpcUrls: n.rpcUrls as string[],
    explorer: n.explorer,
    nativeCurrency,
    faucets: Array.isArray(n.faucets) ? (n.faucets as string[]) : undefined,
    uniswapV4,
    pairToken: typeof n.pairToken === 'string' ? requireAddress(n.pairToken, 'network.pairToken') : undefined,
  }
}

function validatePoolKey(raw: unknown): PoolKey {
  if (!raw || typeof raw !== 'object') fail('poolKey is malformed')
  const k = raw as Record<string, unknown>
  if (typeof k.fee !== 'number' || typeof k.tickSpacing !== 'number') fail('poolKey fee/tickSpacing are missing')
  return {
    currency0: requireAddress(k.currency0, 'poolKey.currency0'),
    currency1: requireAddress(k.currency1, 'poolKey.currency1'),
    fee: k.fee,
    tickSpacing: k.tickSpacing,
    hooks: requireAddress(k.hooks, 'poolKey.hooks'),
  }
}

export function validateManifest(raw: unknown): DeploymentManifest {
  if (!raw || typeof raw !== 'object') fail('deployment manifest is not an object')
  const m = raw as Record<string, unknown>
  if (m.version !== 1) fail('deployment manifest version must be 1')
  if (typeof m.launchId !== 'string' || !m.launchId) fail('launchId is missing')
  if (typeof m.chainId !== 'number' || !Number.isInteger(m.chainId) || m.chainId <= 0) fail('chainId is missing')
  if (typeof m.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(m.sourceCommit)) fail('sourceCommit is malformed')
  if (typeof m.attestationHash !== 'string' || !HEX64.test(m.attestationHash)) fail('attestationHash is malformed')
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) fail('contracts are missing')
  const contracts = m.contracts.map((c, i): DeploymentContract => {
    const entry = c as Record<string, unknown>
    if (typeof entry.name !== 'string' || !entry.name) fail(`contracts[${i}].name is missing`)
    if (typeof entry.abiHash !== 'string' || !HEX64.test(entry.abiHash)) fail(`contracts[${i}].abiHash is malformed`)
    return {
      name: entry.name,
      address: requireAddress(entry.address, `contracts[${i}].address`),
      abiHash: entry.abiHash,
      abiPath: requireRelativePath(entry.abiPath, `contracts[${i}].abiPath`),
    }
  })
  const assets = Array.isArray(m.assets)
    ? m.assets.map((a, i): DeploymentAsset => {
        const entry = a as Record<string, unknown>
        if (typeof entry.sha256 !== 'string' || !HEX64.test(entry.sha256)) fail(`assets[${i}].sha256 is malformed`)
        return { path: requireRelativePath(entry.path, `assets[${i}].path`), sha256: entry.sha256 }
      })
    : []
  const manifest: DeploymentManifest = {
    version: 1,
    launchId: m.launchId,
    chainId: m.chainId,
    sourceCommit: m.sourceCommit,
    attestationHash: m.attestationHash,
    contracts,
    assets,
  }
  if (m.poolKey !== undefined) manifest.poolKey = validatePoolKey(m.poolKey)
  if (m.network !== undefined) {
    manifest.network = validateNetwork(m.network)
    if (manifest.network.chainId !== manifest.chainId) fail('network.chainId does not match chainId')
  }
  if (m.walletAddChain !== undefined) {
    const w = m.walletAddChain as Record<string, unknown>
    if (!w || typeof w.chainId !== 'string' || !/^0x[0-9a-f]+$/i.test(w.chainId)) fail('walletAddChain.chainId is malformed')
    if (parseInt(w.chainId, 16) !== manifest.chainId) fail('walletAddChain.chainId does not match chainId')
    manifest.walletAddChain = w as unknown as WalletAddChain
  }
  return manifest
}

export type FetchLike = (input: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

async function fetchJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await fetchFn(url)
  } catch (error) {
    fail(`unable to fetch ${url}: ${(error as Error).message}`)
  }
  if (!response.ok) fail(`unable to fetch ${url}: HTTP ${response.status}`)
  try {
    return await response.json()
  } catch {
    fail(`${url} is not valid JSON`)
  }
}

/**
 * Load `imd-deployment.json` relative to the page and every ABI it references,
 * verifying each ABI against the attested hash before it is used.
 */
export async function loadDeployment(options: { fetchFn?: FetchLike; baseUrl?: string } = {}): Promise<Deployment> {
  const fetchFn = options.fetchFn ?? ((input: string) => fetch(input, { cache: 'no-cache' }))
  const baseUrl = options.baseUrl ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/')
  const manifestUrl = new URL(DEPLOYMENT_FILE, baseUrl).toString()
  const manifest = validateManifest(await fetchJson(fetchFn, manifestUrl))

  const contracts: LoadedContract[] = []
  for (const contract of manifest.contracts) {
    const abiUrl = new URL(contract.abiPath, manifestUrl).toString()
    const abi = await fetchJson(fetchFn, abiUrl)
    if (!Array.isArray(abi)) fail(`${contract.abiPath} is not an ABI array`)
    const hash = canonicalAbiHash(abi)
    if (hash !== contract.abiHash) {
      fail(`ABI for ${contract.name} does not match the attested hash (${contract.abiPath})`)
    }
    contracts.push({ ...contract, abi: abi as Abi })
  }

  const token = contracts.find((c) => c.name === TOKEN_CONTRACT)
  const guestbook = contracts.find((c) => c.name === GUESTBOOK_CONTRACT)
  if (!token) fail(`contract ${TOKEN_CONTRACT} is missing from the deployment`)
  if (!guestbook) fail(`contract ${GUESTBOOK_CONTRACT} is missing from the deployment`)

  const poolKey = manifest.poolKey ?? null
  if (poolKey) {
    const addrs = [poolKey.currency0.toLowerCase(), poolKey.currency1.toLowerCase()]
    if (!addrs.includes(token.address.toLowerCase())) fail('poolKey does not contain the launch token')
  }

  return {
    manifest,
    manifestUrl,
    chainId: manifest.chainId,
    network: manifest.network ?? null,
    walletAddChain: manifest.walletAddChain ?? null,
    poolKey,
    token,
    guestbook,
    contracts,
  }
}

export function explorerAddressUrl(deployment: Pick<Deployment, 'network'>, address: string): string | null {
  return deployment.network ? `${deployment.network.explorer.replace(/\/$/, '')}/address/${address}` : null
}

export function explorerTxUrl(deployment: Pick<Deployment, 'network'>, hash: string): string | null {
  return deployment.network ? `${deployment.network.explorer.replace(/\/$/, '')}/tx/${hash}` : null
}
