import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import type { Abi, Address, Hex, TransactionReceipt } from 'viem'
import { useConfig } from 'wagmi'
import { simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { type FriendlyError, translateError } from '../lib/errors'

export type TxStatus = 'idle' | 'simulating' | 'wallet' | 'pending' | 'confirmed' | 'failed'

export interface TxState {
  status: TxStatus
  hash?: Hex
  receipt?: TransactionReceipt
  error?: FriendlyError
}

export interface TxRequest {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

interface ErrorContext {
  symbol?: string
  signingCost?: string
  maxMessageBytes?: number
  abis?: Abi[]
}

/**
 * One transaction lifecycle per action: simulate (so reverts surface before the
 * wallet opens), ask the wallet to sign, wait for the receipt, then refresh every
 * cached read. `busy` stays true from the click until the receipt lands, which
 * is the window where a second submission must be impossible.
 */
export function useTransaction(errorContext: ErrorContext = {}) {
  const config = useConfig()
  const queryClient = useQueryClient()
  const [state, setState] = useState<TxState>({ status: 'idle' })
  const inFlight = useRef(false)

  const run = useCallback(
    async (request: TxRequest): Promise<TransactionReceipt | null> => {
      if (inFlight.current) return null
      inFlight.current = true
      let hash: Hex | undefined
      try {
        setState({ status: 'simulating' })
        const { request: prepared } = await simulateContract(config, {
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args ?? [],
          value: request.value,
        } as never)
        setState({ status: 'wallet' })
        hash = await writeContract(config, prepared as never)
        setState({ status: 'pending', hash })
        const receipt = await waitForTransactionReceipt(config, { hash })
        if (receipt.status !== 'success') {
          setState({ status: 'failed', hash, error: { title: 'Transaction reverted on chain.', detail: 'No state changed. Check the explorer link for details.' } })
          return null
        }
        setState({ status: 'confirmed', hash, receipt })
        return receipt
      } catch (error) {
        setState({ status: 'failed', hash, error: translateError(error, errorContext) })
        return null
      } finally {
        inFlight.current = false
        void queryClient.invalidateQueries()
      }
    },
    [config, queryClient, errorContext],
  )

  const reset = useCallback(() => setState({ status: 'idle' }), [])
  const busy = state.status === 'simulating' || state.status === 'wallet' || state.status === 'pending'
  return { state, run, reset, busy }
}
