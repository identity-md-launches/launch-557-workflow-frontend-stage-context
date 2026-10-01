import { useCallback, useState } from 'react'
import { useAccount } from 'wagmi'
import { type FriendlyError, translateError } from '../lib/errors'
import { type Eip1193Provider, switchOrAddChain } from '../lib/wallet'
import { useDeployment } from './deployment'

/**
 * Connection and chain state for the four-state action flow:
 * disconnected -> wrong network -> (approve) -> action.
 */
export function useNetworkState() {
  const deployment = useDeployment()
  const { address, chainId, isConnected, connector, status } = useAccount()
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<FriendlyError | null>(null)

  const wrongNetwork = isConnected && chainId !== deployment.chainId

  const switchNetwork = useCallback(async () => {
    if (!connector) return
    setSwitching(true)
    setSwitchError(null)
    try {
      const provider = (await connector.getProvider()) as Eip1193Provider
      await switchOrAddChain(provider, deployment.chainId, deployment.walletAddChain)
    } catch (error) {
      setSwitchError(translateError(error))
    } finally {
      setSwitching(false)
    }
  }, [connector, deployment.chainId, deployment.walletAddChain])

  return {
    address,
    chainId,
    isConnected,
    isConnecting: status === 'connecting' || status === 'reconnecting',
    wrongNetwork,
    switching,
    switchError,
    switchNetwork,
    networkName: deployment.network?.name ?? `chain ${deployment.chainId}`,
  }
}
