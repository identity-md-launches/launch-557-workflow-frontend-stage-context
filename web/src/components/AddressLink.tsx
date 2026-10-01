import { useEffect, useState } from 'react'
import { explorerAddressUrl } from '../config/deployment'
import { useDeployment } from '../hooks/deployment'
import { safeChecksum, shortAddress } from '../lib/format'

interface AddressLinkProps {
  address: string
  /** Show the full checksummed address instead of the truncated form. */
  full?: boolean
  label?: string
}

/** Checksummed address with explorer link and a copy control. ENS is not resolved on this testnet. */
export function AddressLink({ address, full = false, label }: AddressLinkProps) {
  const deployment = useDeployment()
  const checksummed = safeChecksum(address)
  const url = explorerAddressUrl(deployment, checksummed)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const text = full ? checksummed : shortAddress(checksummed)
  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard)

  return (
    <span className="addr">
      {url ? (
        <a className="addr__link mono" href={url} target="_blank" rel="noreferrer noopener" title={checksummed}>
          <span className="sr-only">{label ? `${label}: ` : ''}Open address </span>
          <bdi>{text}</bdi>
          <span className="sr-only"> on the explorer</span>
        </a>
      ) : (
        <span className="mono" title={checksummed}>
          <bdi>{text}</bdi>
        </span>
      )}
      {canCopy ? (
        <button
          type="button"
          className="btn btn--icon"
          aria-label={copied ? `Copied ${shortAddress(checksummed)}` : `Copy address ${shortAddress(checksummed)}`}
          onClick={() => {
            navigator.clipboard.writeText(checksummed).then(() => setCopied(true)).catch(() => setCopied(false))
          }}
        >
          <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
        </button>
      ) : null}
    </span>
  )
}
