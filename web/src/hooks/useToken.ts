import type { Address } from 'viem'
import { useReadContract } from 'wagmi'
import { useDeployment } from './deployment'
import { pollInterval } from './useGuestbook'

export const WALLET_POLL_MS = 15_000
const walletPoll = pollInterval(WALLET_POLL_MS)

export function useTokenMetadata() {
  const { token } = useDeployment()
  const base = { address: token.address, abi: token.abi, query: { staleTime: Infinity } } as const
  const name = useReadContract({ ...base, functionName: 'name' })
  const symbol = useReadContract({ ...base, functionName: 'symbol' })
  const decimals = useReadContract({ ...base, functionName: 'decimals' })
  return {
    name: (name.data as string | undefined) ?? 'Launch token',
    symbol: (symbol.data as string | undefined) ?? 'TOKEN',
    decimals: decimals.data !== undefined ? Number(decimals.data as number | bigint) : 18,
    loaded: symbol.data !== undefined && decimals.data !== undefined,
  }
}

export function useTotalSupply() {
  const { token } = useDeployment()
  const query = useReadContract({ address: token.address, abi: token.abi, functionName: 'totalSupply', query: { refetchInterval: walletPoll } })
  return { totalSupply: query.data as bigint | undefined, error: query.error }
}

export function useTokenBalance(account: Address | undefined) {
  const { token } = useDeployment()
  const query = useReadContract({
    address: token.address,
    abi: token.abi,
    functionName: 'balanceOf',
    args: account ? [account] : undefined,
    query: { enabled: Boolean(account), refetchInterval: walletPoll },
  })
  return { balance: query.data as bigint | undefined, isLoading: query.isLoading, refetch: query.refetch }
}

export function useTokenAllowance(owner: Address | undefined, spender: Address | undefined) {
  const { token } = useDeployment()
  const query = useReadContract({
    address: token.address,
    abi: token.abi,
    functionName: 'allowance',
    args: owner && spender ? [owner, spender] : undefined,
    query: { enabled: Boolean(owner && spender), refetchInterval: walletPoll },
  })
  return { allowance: query.data as bigint | undefined, isLoading: query.isLoading, refetch: query.refetch }
}
