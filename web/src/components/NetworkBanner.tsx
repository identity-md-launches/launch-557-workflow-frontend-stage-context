import { useNetworkState } from '../hooks/useNetworkState'
import { Notice } from './Notice'

/** Single wrong-network control. Switch first; add the chain when the wallet does not know it. */
export function NetworkBanner() {
  const { wrongNetwork, chainId, switching, switchError, switchNetwork, networkName } = useNetworkState()
  if (!wrongNetwork) return null
  return (
    <div className="banner" role="region" aria-label="Network">
      <Notice tone="warning" title={`Your wallet is on chain ${chainId ?? 'unknown'}. This guestbook lives on ${networkName}.`}>
        <p>Switch to continue. If the wallet does not know {networkName}, it will offer to add it.</p>
        <button type="button" className="btn btn--primary" disabled={switching} onClick={() => switchNetwork()}>
          {switching ? `Switching to ${networkName}…` : `Switch to ${networkName}`}
        </button>
        {switchError ? (
          <p className="notice__inline-error">
            {switchError.title} {switchError.detail}
          </p>
        ) : null}
      </Notice>
    </div>
  )
}
