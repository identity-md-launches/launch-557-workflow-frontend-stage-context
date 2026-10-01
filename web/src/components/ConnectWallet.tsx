import { useEffect, useId, useRef, useState } from 'react'
import { type Connector, useConnect } from 'wagmi'
import { translateError } from '../lib/errors'
import { Notice } from './Notice'

interface ConnectWalletProps {
  variant?: 'primary' | 'secondary'
  /** Render the wallet list open immediately (used inside the sign form). */
  inline?: boolean
  /** Header placement: keep the no-wallet hint to one line; the form carries the full instruction. */
  compact?: boolean
}

function hasInjectedProvider(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum)
}

function usableConnectors(connectors: readonly Connector[]): Connector[] {
  const seen = new Set<string>()
  const list: Connector[] = []
  for (const connector of connectors) {
    if (connector.id === 'injected' && !hasInjectedProvider()) continue
    const key = connector.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(connector)
  }
  return list
}

/**
 * "Connect wallet" control. Browser wallets are discovered through EIP-6963;
 * with exactly one wallet the button connects directly, otherwise it expands a
 * list. No WalletConnect project id is configured in this export.
 */
export function ConnectWallet({ variant = 'primary', inline = false, compact = false }: ConnectWalletProps) {
  const { connectors, connectAsync, isPending, variables } = useConnect()
  const [open, setOpen] = useState(inline)
  const [error, setError] = useState<ReturnType<typeof translateError> | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const list = usableConnectors(connectors)

  useEffect(() => {
    if (!open || inline) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, inline])

  const connectWith = async (connector: Connector) => {
    setError(null)
    try {
      await connectAsync({ connector })
      if (!inline) setOpen(false)
    } catch (e) {
      setError(translateError(e))
    }
  }

  const pendingId = isPending ? variables?.connector && 'uid' in variables.connector ? variables.connector.uid : 'pending' : null

  if (list.length === 0) {
    return (
      <div className="stack stack--tight">
        <button type="button" className={`btn btn--${variant}`} disabled>
          Connect wallet
        </button>
        <p className="hint">
          {compact ? 'No browser wallet detected.' : 'No browser wallet detected. Install a wallet extension such as MetaMask or Rabby, then reload.'}
        </p>
      </div>
    )
  }

  if (list.length === 1 && !open) {
    const only = list[0]!
    return (
      <div className="stack stack--tight">
        <button type="button" className={`btn btn--${variant}`} disabled={isPending} onClick={() => connectWith(only)}>
          {isPending ? 'Connecting…' : `Connect ${only.name}`}
        </button>
        {error ? (
          <Notice tone="error" title={error.title}>
            {error.detail}
          </Notice>
        ) : null}
      </div>
    )
  }

  return (
    <div className="connect">
      {!inline ? (
        <button
          ref={triggerRef}
          type="button"
          className={`btn btn--${variant}`}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
        >
          Connect wallet
        </button>
      ) : null}
      {open ? (
        <div id={listId} className="connect__list" role="group" aria-label="Choose a wallet">
          {list.map((connector) => (
            <button
              key={connector.uid}
              type="button"
              className="btn btn--secondary connect__option"
              disabled={isPending}
              onClick={() => connectWith(connector)}
            >
              {connector.icon ? <img src={connector.icon} alt="" width={20} height={20} /> : null}
              {pendingId === connector.uid ? `Connecting to ${connector.name}…` : `Connect ${connector.name}`}
            </button>
          ))}
          {error ? (
            <Notice tone="error" title={error.title}>
              {error.detail}
            </Notice>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
