import { type FormEvent, useId, useMemo, useState } from 'react'
import { isAddress } from 'viem'
import { useDeployment } from '../hooks/deployment'
import { useNetworkState } from '../hooks/useNetworkState'
import { useTokenAllowance, useTokenBalance, useTokenMetadata, useTotalSupply } from '../hooks/useToken'
import { useTransaction } from '../hooks/useTransaction'
import { formatAmount, parseDecimalAmount } from '../lib/format'
import { AddressLink } from './AddressLink'
import { Notice } from './Notice'
import { TxStatus } from './TxStatus'

/** Token reads plus the remaining token actions: transfer, burn and revoking the guestbook approval. */
export function TokenPanel() {
  const deployment = useDeployment()
  const { address, isConnected, wrongNetwork } = useNetworkState()
  const { name, symbol, decimals } = useTokenMetadata()
  const { totalSupply, error: supplyError } = useTotalSupply()
  const { balance } = useTokenBalance(address)
  const { allowance } = useTokenAllowance(address, deployment.guestbook.address)
  const canAct = isConnected && !wrongNetwork

  const errorContext = useMemo(() => ({ symbol, abis: [deployment.token.abi] }), [symbol, deployment.token.abi])
  const transferTx = useTransaction(errorContext)
  const burnTx = useTransaction(errorContext)
  const revokeTx = useTransaction(errorContext)

  const [to, setTo] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [burnAmount, setBurnAmount] = useState('')
  const [transferError, setTransferError] = useState<string | null>(null)
  const [burnError, setBurnError] = useState<string | null>(null)
  const ids = useId()

  const submitTransfer = async (event: FormEvent) => {
    event.preventDefault()
    const amount = parseDecimalAmount(transferAmount, decimals)
    if (!isAddress(to.trim(), { strict: false })) {
      setTransferError('Enter a valid 0x address for the recipient.')
      return
    }
    if (amount === null || amount <= 0n) {
      setTransferError(`Enter an amount of ${symbol} greater than zero.`)
      return
    }
    if (balance !== undefined && amount > balance) {
      setTransferError(`Amount exceeds your balance of ${formatAmount(balance, decimals)} ${symbol}.`)
      return
    }
    setTransferError(null)
    const receipt = await transferTx.run({ address: deployment.token.address, abi: deployment.token.abi, functionName: 'transfer', args: [to.trim(), amount] })
    if (receipt) {
      setTo('')
      setTransferAmount('')
    }
  }

  const submitBurn = async (event: FormEvent) => {
    event.preventDefault()
    const amount = parseDecimalAmount(burnAmount, decimals)
    if (amount === null || amount <= 0n) {
      setBurnError(`Enter an amount of ${symbol} greater than zero.`)
      return
    }
    if (balance !== undefined && amount > balance) {
      setBurnError(`Amount exceeds your balance of ${formatAmount(balance, decimals)} ${symbol}.`)
      return
    }
    setBurnError(null)
    const receipt = await burnTx.run({ address: deployment.token.address, abi: deployment.token.abi, functionName: 'burn', args: [amount] })
    if (receipt) setBurnAmount('')
  }

  const revoke = async () => {
    await revokeTx.run({ address: deployment.token.address, abi: deployment.token.abi, functionName: 'approve', args: [deployment.guestbook.address, 0n] })
  }

  return (
    <section className="card" aria-labelledby="token-title" id="token">
      <h2 id="token-title" className="card__title">
        {name} token ({symbol})
      </h2>
      <dl className="kv">
        <div>
          <dt>Contract</dt>
          <dd>
            <AddressLink address={deployment.token.address} />
          </dd>
        </div>
        <div>
          <dt>Total supply</dt>
          <dd className="num">
            {totalSupply !== undefined ? `${formatAmount(totalSupply, decimals, 2)} ${symbol}` : supplyError ? 'Unavailable (RPC unreachable)' : 'Loading…'}
          </dd>
        </div>
        <div>
          <dt>Your balance</dt>
          <dd className="num">{!isConnected ? 'Connect a wallet' : balance !== undefined ? `${formatAmount(balance, decimals)} ${symbol}` : 'Loading…'}</dd>
        </div>
        <div>
          <dt>Approved for guestbook</dt>
          <dd className="num">{!isConnected ? '—' : allowance !== undefined ? `${formatAmount(allowance, decimals)} ${symbol}` : 'Loading…'}</dd>
        </div>
      </dl>
      <p className="hint">Supply only falls when tokens are burned. USD value is not shown because this site reads no price source.</p>

      <details className="disclosure">
        <summary>Transfer {symbol}</summary>
        <form className="stack" onSubmit={submitTransfer} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={`${ids}-to`}>
              Recipient address
            </label>
            <input
              id={`${ids}-to`}
              className="input mono"
              name="recipient"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={transferError?.includes('address') ? true : undefined}
              aria-describedby={transferError ? `${ids}-transfer-error` : undefined}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${ids}-transfer-amount`}>
              Amount ({symbol})
            </label>
            <input
              id={`${ids}-transfer-amount`}
              className="input num"
              name="transferAmount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              aria-invalid={transferError && !transferError.includes('address') ? true : undefined}
              aria-describedby={transferError ? `${ids}-transfer-error` : undefined}
            />
          </div>
          {transferError ? (
            <p id={`${ids}-transfer-error`} className="field__error">
              {transferError}
            </p>
          ) : null}
          <div className="actions">
            <button type="submit" className="btn btn--secondary" disabled={!canAct || transferTx.busy}>
              {transferTx.busy ? 'Transferring…' : `Transfer ${symbol}`}
            </button>
            {!canAct ? <span className="hint">Connect a wallet on the right network to transfer.</span> : null}
          </div>
          <TxStatus state={transferTx.state} label="Transferring" successTitle="Transfer confirmed." />
        </form>
      </details>

      <details className="disclosure">
        <summary>Burn {symbol}</summary>
        <form className="stack" onSubmit={submitBurn} noValidate>
          <Notice tone="warning" title="Burning destroys tokens permanently." live="none">
            <p>This lowers the total supply and creates no guestbook entry.</p>
          </Notice>
          <div className="field">
            <label className="field__label" htmlFor={`${ids}-burn-amount`}>
              Amount to burn ({symbol})
            </label>
            <input
              id={`${ids}-burn-amount`}
              className="input num"
              name="burnAmount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={burnAmount}
              onChange={(e) => setBurnAmount(e.target.value)}
              aria-invalid={burnError ? true : undefined}
              aria-describedby={burnError ? `${ids}-burn-error` : undefined}
            />
          </div>
          {burnError ? (
            <p id={`${ids}-burn-error`} className="field__error">
              {burnError}
            </p>
          ) : null}
          <div className="actions">
            <button type="submit" className="btn btn--danger" disabled={!canAct || burnTx.busy}>
              {burnTx.busy ? 'Burning…' : `Burn ${symbol}`}
            </button>
          </div>
          <TxStatus state={burnTx.state} label="Burning" successTitle="Burn confirmed." />
        </form>
      </details>

      <details className="disclosure">
        <summary>Revoke the guestbook approval</summary>
        <div className="stack">
          <p className="hint">Sets the guestbook's allowance back to zero. Each signature only ever spends the exact cost.</p>
          <div className="actions">
            <button type="button" className="btn btn--secondary" disabled={!canAct || revokeTx.busy || allowance === 0n} onClick={revoke}>
              {revokeTx.busy ? 'Revoking…' : 'Revoke approval'}
            </button>
          </div>
          <TxStatus state={revokeTx.state} label="Revoking" successTitle="Approval revoked." />
        </div>
      </details>
    </section>
  )
}
