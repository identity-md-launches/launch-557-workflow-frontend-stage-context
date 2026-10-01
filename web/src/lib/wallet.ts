import type { Hex } from 'viem'
import type { WalletAddChain } from '../config/deployment'

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
}

export const UNKNOWN_CHAIN_CODE = 4902

function hasCode(error: unknown, code: number): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown; data?: { originalError?: { code?: unknown } } }
    if (candidate.code === code) return true
    if (candidate.data?.originalError?.code === code) return true
    current = candidate.cause
  }
  return false
}

/** True when the wallet reported that it does not know the requested chain. */
export function isUnknownChainError(error: unknown): boolean {
  if (hasCode(error, UNKNOWN_CHAIN_CODE)) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /unrecognized chain|unknown chain|chain .* not (?:been )?added|not supported by the wallet|try adding the chain/i.test(message)
}

export function toChainIdHex(chainId: number): Hex {
  return `0x${chainId.toString(16)}` as Hex
}

/**
 * Ask the wallet to switch to the configured chain. When the wallet does not know
 * the chain (EIP-3326 error 4902 or an equivalent message) and the deployment
 * supplies `walletAddChain`, add it with the exact parameters and switch again.
 */
export async function switchOrAddChain(
  provider: Eip1193Provider,
  chainId: number,
  walletAddChain: WalletAddChain | null,
): Promise<'switched' | 'added'> {
  const chainIdHex = toChainIdHex(chainId)
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
    return 'switched'
  } catch (error) {
    if (!walletAddChain || !isUnknownChainError(error)) throw error
    await provider.request({ method: 'wallet_addEthereumChain', params: [walletAddChain] })
    // Some wallets switch as part of adding; a second switch is harmless and
    // covers those that do not.
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
    return 'added'
  }
}
