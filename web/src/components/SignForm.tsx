import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { decodeEventLog } from 'viem'
import { useDeployment } from '../hooks/deployment'
import { useGuestbookConstants } from '../hooks/useGuestbook'
import { useNetworkState } from '../hooks/useNetworkState'
import { useTokenAllowance, useTokenBalance, useTokenMetadata } from '../hooks/useToken'
import { useTransaction } from '../hooks/useTransaction'
import { formatAmount, utf8ByteLength } from '../lib/format'
import { ConnectWallet } from './ConnectWallet'
import { Notice } from './Notice'
import { TxStatus } from './TxStatus'

const FALLBACK_MAX_BYTES = 280

/**
 * Four-state flow: connect -> switch network -> approve exact cost -> sign.
 * Only one primary control renders at a time, and signing stays disabled until
 * the allowance and balance read from chain satisfy the cost.
 */
export function SignForm() {
  const deployment = useDeployment()
  const { address, isConnected, wrongNetwork, switching, switchNetwork, switchError, networkName } = useNetworkState()
  const { signingCost, maxMessageBytes } = useGuestbookConstants()
  const { symbol, decimals } = useTokenMetadata()
  const { balance } = useTokenBalance(address)
  const { allowance } = useTokenAllowance(address, deployment.guestbook.address)

  const [message, setMessage] = useState('')
  const [lengthError, setLengthError] = useState<string | null>(null)
  const [lastEntryId, setLastEntryId] = useState<bigint | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fieldId = useId()
  const hintId = `${fieldId}-hint`
  const errorId = `${fieldId}-error`

  const maxBytes = maxMessageBytes ?? FALLBACK_MAX_BYTES
  const bytes = utf8ByteLength(message)
  const tooLong = bytes > maxBytes
  const costLabel = signingCost !== undefined ? formatAmount(signingCost, decimals) : '10'

  const errorContext = useMemo(
    () => ({ symbol, signingCost: costLabel, maxMessageBytes: maxBytes, abis: [deployment.guestbook.abi, deployment.token.abi] }),
    [symbol, costLabel, maxBytes, deployment.guestbook.abi, deployment.token.abi],
  )
  const approveTx = useTransaction(errorContext)
  const signTx = useTransaction(errorContext)

  // Cooldown after an approval confirms, until the allowance read catches up.
  const [awaitingAllowance, setAwaitingAllowance] = useState(false)
  useEffect(() => {
    if (approveTx.state.status === 'confirmed') setAwaitingAllowance(true)
  }, [approveTx.state.status])
  useEffect(() => {
    if (awaitingAllowance && signingCost !== undefined && allowance !== undefined && allowance >= signingCost) {
      setAwaitingAllowance(false)
    }
  }, [awaitingAllowance, allowance, signingCost])

  useEffect(() => {
    if (tooLong === false) setLengthError(null)
  }, [tooLong])

  const ready = signingCost !== undefined && balance !== undefined && allowance !== undefined
  const hasBalance = ready && balance >= signingCost
  const hasAllowance = ready && allowance >= signingCost && !awaitingAllowance

  const approve = async () => {
    if (signingCost === undefined) return
    signTx.reset()
    await approveTx.run({
      address: deployment.token.address,
      abi: deployment.token.abi,
      functionName: 'approve',
      args: [deployment.guestbook.address, signingCost],
    })
  }

  const sign = async (event: FormEvent) => {
    event.preventDefault()
    if (tooLong) {
      setLengthError(`Message is ${bytes} bytes. Use at most ${maxBytes} bytes.`)
      textareaRef.current?.focus()
      return
    }
    approveTx.reset()
    setLastEntryId(null)
    const receipt = await signTx.run({
      address: deployment.guestbook.address,
      abi: deployment.guestbook.abi,
      functionName: 'sign',
      args: [message],
    })
    if (!receipt) return
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== deployment.guestbook.address.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({ abi: deployment.guestbook.abi, data: log.data, topics: log.topics })
        if (decoded.eventName === 'Signed') {
          const args = decoded.args as unknown as { entryId: bigint }
          setLastEntryId(args.entryId)
          break
        }
      } catch {
        // not the Signed event
      }
    }
    setMessage('')
  }

  let action: React.ReactNode
  if (!isConnected) {
    action = <ConnectWallet variant="primary" inline />
  } else if (wrongNetwork) {
    action = (
      <div className="stack stack--tight">
        <button type="button" className="btn btn--primary" disabled={switching} onClick={() => switchNetwork()}>
          {switching ? `Switching to ${networkName}…` : `Switch to ${networkName}`}
        </button>
        {switchError ? (
          <Notice tone="error" title={switchError.title}>
            {switchError.detail}
          </Notice>
        ) : null}
      </div>
    )
  } else if (!ready) {
    action = (
      <button type="button" className="btn btn--primary" disabled>
        Loading wallet state…
      </button>
    )
  } else if (!hasBalance) {
    action = (
      <div className="stack stack--tight">
        <button type="button" className="btn btn--primary" disabled>
          Sign the guestbook
        </button>
        <Notice tone="warning" title={`You need ${costLabel} ${symbol} to sign.`} live="none">
          <p>
            Balance: {formatAmount(balance, decimals)} {symbol}. <a href="#swap">Get {symbol} with ETH</a> below, then come back.
          </p>
        </Notice>
      </div>
    )
  } else if (!hasAllowance) {
    action = (
      <button type="button" className="btn btn--primary" disabled={approveTx.busy || awaitingAllowance} onClick={approve}>
        {approveTx.busy ? `Approving ${costLabel} ${symbol}…` : awaitingAllowance ? 'Updating allowance…' : `Approve ${costLabel} ${symbol}`}
      </button>
    )
  } else {
    action = (
      <button type="submit" className="btn btn--primary" disabled={signTx.busy}>
        {signTx.busy ? 'Signing…' : `Sign the guestbook`}
      </button>
    )
  }

  return (
    <section className="card" aria-labelledby="sign-title">
      <h2 id="sign-title" className="card__title">
        Sign the guestbook
      </h2>
      <p className="card__lead">
        Signing burns {costLabel} {symbol} from your wallet and stores your message on chain forever. Entries cannot be edited or
        removed.
      </p>
      <form className="stack" onSubmit={sign} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={fieldId}>
            Message
          </label>
          <textarea
            ref={textareaRef}
            id={fieldId}
            className="textarea"
            name="message"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Hello from Sepolia"
            aria-describedby={lengthError ? `${hintId} ${errorId}` : hintId}
            aria-invalid={lengthError ? true : undefined}
            spellCheck
          />
          <p id={hintId} className={`field__hint ${tooLong ? 'field__hint--over' : ''}`} role="status">
            {bytes} of {maxBytes} bytes{tooLong ? ' (too long)' : ''}
          </p>
          {lengthError ? (
            <p id={errorId} className="field__error">
              {lengthError}
            </p>
          ) : null}
        </div>

        {isConnected && !wrongNetwork && ready ? (
          <dl className="kv" aria-label="Wallet state">
            <div>
              <dt>Cost</dt>
              <dd>
                {costLabel} {symbol}
              </dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd className="num">
                {formatAmount(balance, decimals)} {symbol}
              </dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd className="num">
                {formatAmount(allowance, decimals)} {symbol}
              </dd>
            </div>
          </dl>
        ) : null}

        <div className="actions">{action}</div>
        <p className="hint">
          Approval and signing are two wallet confirmations. A failed signature stores nothing and burns nothing.
        </p>
        <TxStatus state={approveTx.state} label={`Approving ${costLabel} ${symbol}`} successTitle="Approval confirmed." successDetail="You can sign now." />
        <TxStatus
          state={signTx.state}
          label="Signing"
          successTitle={lastEntryId !== null ? `Signed. Your entry is #${lastEntryId.toString()}.` : 'Signed.'}
          successDetail={`${costLabel} ${symbol} were burned.`}
        />
      </form>
    </section>
  )
}
