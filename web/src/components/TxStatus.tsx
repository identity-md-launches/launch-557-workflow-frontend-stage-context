import { explorerTxUrl } from '../config/deployment'
import { useDeployment } from '../hooks/deployment'
import type { TxState } from '../hooks/useTransaction'
import { shortHash } from '../lib/format'
import { Notice } from './Notice'

interface TxStatusProps {
  state: TxState
  /** Verb phrase used while waiting, e.g. "Approving 10 GUEST". */
  label: string
  successTitle?: string
  successDetail?: string
}

export function TxLink({ hash }: { hash: string }) {
  const deployment = useDeployment()
  const url = explorerTxUrl(deployment, hash)
  if (!url) return <code className="mono">{shortHash(hash)}</code>
  return (
    <a href={url} target="_blank" rel="noreferrer noopener">
      View transaction {shortHash(hash)} on the explorer
    </a>
  )
}

/** Renders one transaction's lifecycle; stays visible until the next action replaces it. */
export function TxStatus({ state, label, successTitle = 'Confirmed.', successDetail }: TxStatusProps) {
  switch (state.status) {
    case 'idle':
      return null
    case 'simulating':
      return <Notice tone="info" title={`${label}: checking the transaction…`} />
    case 'wallet':
      return <Notice tone="info" title={`${label}: confirm in your wallet.`} />
    case 'pending':
      return (
        <Notice tone="info" title={`${label}: waiting for confirmation…`}>
          {state.hash ? <TxLink hash={state.hash} /> : null}
        </Notice>
      )
    case 'confirmed':
      return (
        <Notice tone="success" title={successTitle}>
          {successDetail ? <p>{successDetail}</p> : null}
          {state.hash ? <TxLink hash={state.hash} /> : null}
        </Notice>
      )
    case 'failed':
      return (
        <Notice tone="error" title={state.error?.title ?? 'Request failed.'}>
          {state.error?.detail ? <p>{state.error.detail}</p> : null}
          {state.hash ? <TxLink hash={state.hash} /> : null}
        </Notice>
      )
  }
}
