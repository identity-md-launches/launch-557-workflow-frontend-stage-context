import { describe, expect, it } from 'vitest'
import type { WalletAddChain } from '../config/deployment'
import { isUnknownChainError, switchOrAddChain, toChainIdHex } from './wallet'

const addParams: WalletAddChain = {
  chainId: '0xaa36a7',
  chainName: 'Sepolia',
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
}

function fakeProvider(known: Set<number>) {
  const calls: { method: string; params?: unknown }[] = []
  return {
    calls,
    async request({ method, params }: { method: string; params?: unknown[] }) {
      calls.push({ method, params })
      if (method === 'wallet_switchEthereumChain') {
        const id = parseInt((params![0] as { chainId: string }).chainId, 16)
        if (!known.has(id)) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 })
        return null
      }
      if (method === 'wallet_addEthereumChain') {
        known.add(parseInt((params![0] as { chainId: string }).chainId, 16))
        return null
      }
      throw new Error(`unexpected ${method}`)
    },
  }
}

describe('switchOrAddChain', () => {
  it('switches directly when the wallet knows the chain', async () => {
    const provider = fakeProvider(new Set([11155111]))
    await expect(switchOrAddChain(provider, 11155111, addParams)).resolves.toBe('switched')
    expect(provider.calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain'])
    expect(provider.calls[0]!.params).toEqual([{ chainId: '0xaa36a7' }])
  })

  it('adds the chain with the exact walletAddChain parameters after a 4902 error, then switches again', async () => {
    const provider = fakeProvider(new Set([1]))
    await expect(switchOrAddChain(provider, 11155111, addParams)).resolves.toBe('added')
    expect(provider.calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain'])
    expect(provider.calls[1]!.params).toEqual([addParams])
  })

  it('rethrows when no add parameters are available', async () => {
    const provider = fakeProvider(new Set([1]))
    await expect(switchOrAddChain(provider, 11155111, null)).rejects.toMatchObject({ code: 4902 })
    expect(provider.calls).toHaveLength(1)
  })

  it('rethrows non-4902 errors such as a user rejection', async () => {
    const provider = {
      async request() {
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      },
    }
    await expect(switchOrAddChain(provider, 11155111, addParams)).rejects.toMatchObject({ code: 4001 })
  })

  it('recognises nested and message-based unknown-chain errors', () => {
    expect(isUnknownChainError({ code: 4902 })).toBe(true)
    expect(isUnknownChainError({ code: -32603, data: { originalError: { code: 4902 } } })).toBe(true)
    expect(isUnknownChainError(new Error('Unrecognized chain ID "0xaa36a7". Try adding the chain using wallet_addEthereumChain first.'))).toBe(true)
    expect(isUnknownChainError(Object.assign(new Error('nope'), { code: 4001 }))).toBe(false)
  })

  it('formats hex chain ids', () => {
    expect(toChainIdHex(11155111)).toBe('0xaa36a7')
    expect(toChainIdHex(1)).toBe('0x1')
  })
})
