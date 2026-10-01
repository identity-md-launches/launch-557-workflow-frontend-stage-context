import { useAccount, useDisconnect } from 'wagmi'
import { useDeployment } from '../hooks/deployment'
import { useEntryCount } from '../hooks/useGuestbook'
import { useNetworkState } from '../hooks/useNetworkState'
import { AddressLink } from './AddressLink'
import { ConnectWallet } from './ConnectWallet'

export function Header() {
  const deployment = useDeployment()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { wrongNetwork, networkName } = useNetworkState()
  const { live, error: rpcError } = useEntryCount()
  const rpcState = rpcError ? 'RPC unreachable' : live ? 'live' : 'connecting'

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <a className="brand" href="#main" aria-label="Guestbook, top of page">
          <img src="./favicon.svg" alt="" width={28} height={28} />
          <span className="brand__name">Guestbook</span>
        </a>
        <div className="app-header__status">
          <span className={`pill ${wrongNetwork || rpcError ? 'pill--warning' : ''}`} role="status" aria-live="polite">
            <span className="pill__dot" aria-hidden="true" />
            {networkName}
            {deployment.network?.testnet ? ' testnet' : ''} · {rpcState}
          </span>
          {isConnected && address ? (
            <div className="account">
              <AddressLink address={address} label="Connected account" />
              <button type="button" className="btn btn--ghost" onClick={() => disconnect()}>
                Disconnect
              </button>
            </div>
          ) : (
            <ConnectWallet variant="secondary" compact />
          )}
        </div>
      </div>
    </header>
  )
}
