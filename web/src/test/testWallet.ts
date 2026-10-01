/**
 * A wagmi connector that behaves like a browser wallet with a controllable
 * current chain and a list of chains it knows. Unknown chains fail
 * `wallet_switchEthereumChain` with EIP-3326 code 4902 until
 * `wallet_addEthereumChain` is called, mirroring MetaMask.
 */
import { type Address, numberToHex } from 'viem'
import { createConnector } from 'wagmi'
import type { MockChain } from './mockChain'

export interface TestWalletOptions {
  accounts: readonly [Address, ...Address[]]
  chainId: number
  knownChainIds: number[]
  chain: MockChain
  rejectNextTransaction?: boolean
}

export function testWallet(options: TestWalletOptions) {
  const known = new Set(options.knownChainIds)
  const added: unknown[] = []
  let currentChainId = options.chainId
  let connected = false
  let rejectNext = options.rejectNextTransaction ?? false
  let emitChange: ((chainId: number) => void) | null = null

  const provider = {
    added,
    get chainId() {
      return currentChainId
    },
    rejectNextTransaction() {
      rejectNext = true
    },
    async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
      switch (method) {
        case 'eth_chainId':
          return numberToHex(currentChainId)
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return options.accounts
        case 'wallet_switchEthereumChain': {
          const target = parseInt((params?.[0] as { chainId: string }).chainId, 16)
          if (!known.has(target)) {
            throw Object.assign(new Error('Unrecognized chain ID. Try adding the chain first.'), { code: 4902 })
          }
          currentChainId = target
          emitChange?.(target)
          return null
        }
        case 'wallet_addEthereumChain': {
          const chain = params?.[0] as { chainId: string }
          added.push(chain)
          known.add(parseInt(chain.chainId, 16))
          return null
        }
        case 'eth_sendTransaction': {
          if (rejectNext) {
            rejectNext = false
            throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
          }
          return options.chain.request(method, params)
        }
        default:
          return options.chain.request(method, params)
      }
    },
  }

  const connector = createConnector<typeof provider>((config) => {
    emitChange = (chainId) => config.emitter.emit('change', { chainId })
    return {
      id: 'testwallet',
      name: 'Test Wallet',
      type: 'testwallet',
      async connect() {
        connected = true
        return { accounts: options.accounts, chainId: currentChainId } as never
      },
      async disconnect() {
        connected = false
      },
      async getAccounts() {
        return options.accounts
      },
      async getChainId() {
        return currentChainId
      },
      async isAuthorized() {
        return connected
      },
      async switchChain({ chainId }) {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(chainId) }] })
        return config.chains.find((c) => c.id === chainId)!
      },
      onAccountsChanged() {},
      onChainChanged(chain) {
        config.emitter.emit('change', { chainId: Number(chain) })
      },
      onDisconnect() {
        config.emitter.emit('disconnect')
      },
      async getProvider() {
        return provider
      },
    }
  })

  return { connector, provider }
}
