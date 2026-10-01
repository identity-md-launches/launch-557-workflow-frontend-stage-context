import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useMemo, useState } from 'react'
import { type Address, erc20Abi } from 'viem'
import { useBalance, usePublicClient, useReadContract } from 'wagmi'
import {
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  PERMIT2_EXPIRATION_SECONDS,
  SWAP_DEADLINE_SECONDS,
  permit2Abi,
  quoterAbi,
  stateViewAbi,
  universalRouterAbi,
} from '../config/uniswap'
import { useDeployment } from '../hooks/deployment'
import { pollInterval } from '../hooks/useGuestbook'
import { useNetworkState } from '../hooks/useNetworkState'
import { WALLET_POLL_MS, useTokenBalance, useTokenMetadata } from '../hooks/useToken'
import { useTransaction } from '../hooks/useTransaction'
import { translateError } from '../lib/errors'
import { formatAmount, parseDecimalAmount } from '../lib/format'
import { applySlippage, computePoolId, encodeV4ExactInSingle, formatPoolFee, isNative, priceFromSqrtPriceX96, resolveDirection, sameAddress, swapDeadline } from '../lib/swap'
import { AddressLink } from './AddressLink'
import { ConnectWallet } from './ConnectWallet'
import { Notice } from './Notice'
import { TxStatus } from './TxStatus'

const QUOTE_POLL_MS = 15_000

function parseSlippageBps(text: string): number | null {
  const value = Number(text.trim())
  if (!Number.isFinite(value) || value < 0) return null
  const bps = Math.round(value * 100)
  return bps > MAX_SLIPPAGE_BPS ? null : bps
}

export function SwapPanel() {
  const deployment = useDeployment()
  if (!deployment.network || !deployment.poolKey) {
    return (
      <section className="card" aria-labelledby="swap-title" id="swap">
        <h2 id="swap-title" className="card__title">
          Get {'tokens'}
        </h2>
        <Notice tone="info" title="Swaps are disabled for this deployment." live="none">
          <p>
            {!deployment.network
              ? 'No vetted network configuration (Uniswap router, quoter and Permit2 addresses) was supplied, so this site only reads the contracts.'
              : 'The deployment handoff has no pool key, so no pool can be addressed safely.'}
          </p>
        </Notice>
      </section>
    )
  }
  return <SwapForm />
}

function SwapForm() {
  const deployment = useDeployment()
  const network = deployment.network!
  const poolKey = deployment.poolKey!
  const uni = network.uniswapV4
  const publicClient = usePublicClient()
  const { address, isConnected, wrongNetwork, switching, switchNetwork, switchError, networkName } = useNetworkState()
  const { symbol: tokenSymbol, decimals: tokenDecimals } = useTokenMetadata()
  const { balance: tokenBalance } = useTokenBalance(address)
  const ids = useId()

  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [amountText, setAmountText] = useState('')
  const [slippageText, setSlippageText] = useState((DEFAULT_SLIPPAGE_BPS / 100).toString())
  const [formError, setFormError] = useState<string | null>(null)

  const direction = useMemo(() => resolveDirection(poolKey, deployment.token.address, side), [poolKey, deployment.token.address, side])
  const pairedCurrency: Address = sameAddress(poolKey.currency0, deployment.token.address) ? poolKey.currency1 : poolKey.currency0
  const pairedIsNative = isNative(pairedCurrency)

  const pairedSymbolQuery = useReadContract({
    address: pairedCurrency,
    abi: erc20Abi,
    functionName: 'symbol',
    query: { enabled: !pairedIsNative, staleTime: Infinity },
  })
  const pairedDecimalsQuery = useReadContract({
    address: pairedCurrency,
    abi: erc20Abi,
    functionName: 'decimals',
    query: { enabled: !pairedIsNative, staleTime: Infinity },
  })
  const pairedSymbol = pairedIsNative ? network.nativeCurrency.symbol : (pairedSymbolQuery.data ?? 'TOKEN')
  const pairedDecimals = pairedIsNative ? network.nativeCurrency.decimals : (pairedDecimalsQuery.data ?? 18)

  const inputIsNative = isNative(direction.inputCurrency)
  const inputSymbol = side === 'buy' ? pairedSymbol : tokenSymbol
  const outputSymbol = side === 'buy' ? tokenSymbol : pairedSymbol
  const inputDecimals = side === 'buy' ? pairedDecimals : tokenDecimals
  const outputDecimals = side === 'buy' ? tokenDecimals : pairedDecimals
  const decimals0 = sameAddress(poolKey.currency0, deployment.token.address) ? tokenDecimals : pairedDecimals
  const decimals1 = sameAddress(poolKey.currency1, deployment.token.address) ? tokenDecimals : pairedDecimals
  const symbol0 = sameAddress(poolKey.currency0, deployment.token.address) ? tokenSymbol : pairedSymbol
  const symbol1 = sameAddress(poolKey.currency1, deployment.token.address) ? tokenSymbol : pairedSymbol

  const nativeBalance = useBalance({ address, query: { enabled: Boolean(address), refetchInterval: WALLET_POLL_MS } })
  const pairedTokenBalance = useReadContract({
    address: pairedCurrency,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && !pairedIsNative, refetchInterval: WALLET_POLL_MS },
  })
  const inputBalance: bigint | undefined =
    side === 'sell' ? tokenBalance : pairedIsNative ? nativeBalance.data?.value : pairedTokenBalance.data

  const poolId = useMemo(() => computePoolId(poolKey), [poolKey])
  const slot0 = useReadContract({ address: uni.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId], query: { refetchInterval: pollInterval(WALLET_POLL_MS) } })
  const liquidity = useReadContract({ address: uni.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolId], query: { refetchInterval: pollInterval(WALLET_POLL_MS) } })
  const poolStateUnavailable = Boolean(slot0.error)
  const sqrtPriceX96 = slot0.data?.[0]
  const poolInitialized = sqrtPriceX96 !== undefined && sqrtPriceX96 > 0n
  const price = sqrtPriceX96 !== undefined ? priceFromSqrtPriceX96(sqrtPriceX96, decimals0, decimals1) : null

  const amountIn = parseDecimalAmount(amountText, inputDecimals)
  const slippageBps = parseSlippageBps(slippageText)

  const quote = useQuery({
    queryKey: ['v4-quote', uni.quoter, poolId, side, amountIn?.toString() ?? '0'],
    enabled: Boolean(publicClient) && amountIn !== null && amountIn > 0n && poolInitialized,
    refetchInterval: QUOTE_POLL_MS,
    retry: false,
    queryFn: async () => {
      const { result } = await publicClient!.simulateContract({
        address: uni.quoter,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [{ poolKey, zeroForOne: direction.zeroForOne, exactAmount: amountIn!, hookData: '0x' }],
      })
      return { amountOut: result[0], gasEstimate: result[1] }
    },
  })
  const amountOut = quote.data?.amountOut
  const amountOutMinimum = amountOut !== undefined && slippageBps !== null ? applySlippage(amountOut, slippageBps) : undefined

  // Token-in approvals: ERC-20 -> Permit2, then Permit2 -> Universal Router.
  const inputTokenAllowance = useReadContract({
    address: direction.inputCurrency,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, uni.permit2] : undefined,
    query: { enabled: Boolean(address) && !inputIsNative, refetchInterval: WALLET_POLL_MS },
  })
  const permit2Allowance = useReadContract({
    address: uni.permit2,
    abi: permit2Abi,
    functionName: 'allowance',
    args: address ? [address, direction.inputCurrency, uni.universalRouter] : undefined,
    query: { enabled: Boolean(address) && !inputIsNative, refetchInterval: WALLET_POLL_MS },
  })
  const nowSeconds = Math.floor(Date.now() / 1000)
  const needsTokenApproval =
    !inputIsNative && amountIn !== null && (inputTokenAllowance.data === undefined || inputTokenAllowance.data < amountIn)
  const permit2Amount = permit2Allowance.data?.[0]
  const permit2Expiration = permit2Allowance.data?.[1]
  const needsPermit2 =
    !inputIsNative &&
    amountIn !== null &&
    (permit2Amount === undefined || permit2Expiration === undefined || permit2Amount < amountIn || Number(permit2Expiration) <= nowSeconds)

  const errorContext = useMemo(() => ({ symbol: tokenSymbol, abis: [deployment.token.abi] }), [tokenSymbol, deployment.token.abi])
  const approveTx = useTransaction(errorContext)
  const permitTx = useTransaction(errorContext)
  const swapTx = useTransaction(errorContext)
  const anyBusy = approveTx.busy || permitTx.busy || swapTx.busy

  const insufficient = amountIn !== null && inputBalance !== undefined && amountIn > inputBalance

  const approveToken = async () => {
    if (amountIn === null) return
    await approveTx.run({ address: direction.inputCurrency, abi: deployment.token.abi, functionName: 'approve', args: [uni.permit2, amountIn] })
  }
  const authorizeRouter = async () => {
    if (amountIn === null) return
    await permitTx.run({
      address: uni.permit2,
      abi: permit2Abi,
      functionName: 'approve',
      args: [direction.inputCurrency, uni.universalRouter, amountIn, BigInt(nowSeconds + PERMIT2_EXPIRATION_SECONDS)],
    })
  }
  const swap = async (event: FormEvent) => {
    event.preventDefault()
    if (amountIn === null || amountIn <= 0n) {
      setFormError(`Enter an amount of ${inputSymbol} greater than zero.`)
      return
    }
    if (slippageBps === null) {
      setFormError('Enter a slippage between 0 and 50 percent.')
      return
    }
    if (amountOutMinimum === undefined) {
      setFormError('Wait for the quote before swapping.')
      return
    }
    setFormError(null)
    const { commands, inputs } = encodeV4ExactInSingle({ poolKey, zeroForOne: direction.zeroForOne, amountIn, amountOutMinimum })
    const receipt = await swapTx.run({
      address: uni.universalRouter,
      abi: universalRouterAbi,
      functionName: 'execute',
      args: [commands, inputs, swapDeadline(Date.now() / 1000, SWAP_DEADLINE_SECONDS)],
      value: inputIsNative ? amountIn : 0n,
    })
    if (receipt) setAmountText('')
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
  } else if (!inputIsNative && amountIn !== null && amountIn > 0n && !insufficient && needsTokenApproval) {
    action = (
      <button type="button" className="btn btn--primary" disabled={anyBusy} onClick={approveToken}>
        {approveTx.busy ? `Approving ${inputSymbol} for Permit2…` : `Step 1 of 3: approve ${inputSymbol} for Permit2`}
      </button>
    )
  } else if (!inputIsNative && amountIn !== null && amountIn > 0n && !insufficient && needsPermit2) {
    action = (
      <button type="button" className="btn btn--primary" disabled={anyBusy} onClick={authorizeRouter}>
        {permitTx.busy ? 'Authorizing the router…' : 'Step 2 of 3: authorize the router in Permit2'}
      </button>
    )
  } else {
    const disabled =
      anyBusy || amountIn === null || amountIn <= 0n || insufficient || !poolInitialized || quote.isFetching || amountOutMinimum === undefined
    action = (
      <button type="submit" className="btn btn--primary" disabled={disabled}>
        {swapTx.busy ? 'Swapping…' : inputIsNative ? `Swap ${inputSymbol} for ${outputSymbol}` : `Step 3 of 3: swap ${inputSymbol} for ${outputSymbol}`}
      </button>
    )
  }

  const quoteError = quote.error ? translateError(quote.error, errorContext) : null

  return (
    <section className="card" aria-labelledby="swap-title" id="swap">
      <h2 id="swap-title" className="card__title">
        Get {tokenSymbol}
      </h2>
      <p className="card__lead">
        Trade through the Uniswap v4 pool this launch created. Quotes come from the on-chain quoter; the swap goes through the
        Universal Router and settles in one transaction.
      </p>

      <dl className="kv" aria-label="Pool state">
        <div>
          <dt>Pool</dt>
          <dd>
            {symbol0}/{symbol1}, fee {formatPoolFee(poolKey.fee)}, tick spacing {poolKey.tickSpacing}
          </dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd className="num">
            {poolStateUnavailable
              ? 'Unavailable (RPC unreachable)'
              : slot0.isLoading
                ? 'Loading…'
                : !poolInitialized
                  ? 'Pool not initialized'
                  : price
                    ? `1 ${symbol0} ≈ ${formatAmount(price.oneZeroInOne, 18, 4)} ${symbol1} · 1 ${symbol1} ≈ ${formatAmount(price.oneOneInZero, 18, 8)} ${symbol0}`
                    : 'Unavailable'}
          </dd>
        </div>
        <div>
          <dt>Liquidity</dt>
          <dd className="num">
            {liquidity.data !== undefined
              ? liquidity.data === 0n
                ? 'None in range'
                : liquidity.data.toString()
              : liquidity.error
                ? 'Unavailable (RPC unreachable)'
                : 'Loading…'}
          </dd>
        </div>
      </dl>

      <form className="stack" onSubmit={swap} noValidate>
        <fieldset className="segmented">
          <legend className="field__label">Direction</legend>
          <label className={`segmented__option ${side === 'buy' ? 'is-selected' : ''}`}>
            <input type="radio" name="side" value="buy" checked={side === 'buy'} onChange={() => setSide('buy')} />
            Buy {tokenSymbol} with {pairedSymbol}
          </label>
          <label className={`segmented__option ${side === 'sell' ? 'is-selected' : ''}`}>
            <input type="radio" name="side" value="sell" checked={side === 'sell'} onChange={() => setSide('sell')} />
            Sell {tokenSymbol} for {pairedSymbol}
          </label>
        </fieldset>

        <div className="row">
          <div className="field field--grow">
            <label className="field__label" htmlFor={`${ids}-amount`}>
              You pay ({inputSymbol})
            </label>
            <input
              id={`${ids}-amount`}
              className="input num"
              name="amountIn"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-describedby={`${ids}-balance`}
              aria-invalid={formError?.includes('amount') ? true : undefined}
            />
            <p id={`${ids}-balance`} className="field__hint num">
              {isConnected && inputBalance !== undefined
                ? `Balance: ${formatAmount(inputBalance, inputDecimals)} ${inputSymbol}`
                : 'Connect a wallet to see your balance.'}
              {insufficient ? ' Amount exceeds balance.' : ''}
            </p>
          </div>
          <div className="field field--narrow">
            <label className="field__label" htmlFor={`${ids}-slippage`}>
              Max slippage (%)
            </label>
            <input
              id={`${ids}-slippage`}
              className="input num"
              name="slippage"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={slippageText}
              onChange={(e) => setSlippageText(e.target.value)}
              aria-invalid={slippageBps === null ? true : undefined}
              aria-describedby={`${ids}-slippage-hint`}
            />
            <p id={`${ids}-slippage-hint`} className="field__hint">
              {slippageBps === null ? 'Use a value between 0 and 50.' : 'Applied to the quoted output.'}
            </p>
          </div>
        </div>

        <div className="quote" role="status" aria-live="polite">
          {amountIn === null || amountIn <= 0n ? (
            <p className="hint">Enter an amount to see a quote.</p>
          ) : poolStateUnavailable ? (
            <p className="field__error">Pool state is unavailable because the RPC endpoints cannot be reached. Check your connection and reload.</p>
          ) : !poolInitialized ? (
            <p className="hint">The pool has no price yet, so there is nothing to quote.</p>
          ) : quote.isLoading ? (
            <p className="hint">Fetching quote…</p>
          ) : quoteError ? (
            <p className="field__error">
              Quote unavailable: {quoteError.title} {quoteError.detail}
            </p>
          ) : amountOut !== undefined ? (
            <dl className="kv">
              <div>
                <dt>You receive about</dt>
                <dd className="num">
                  {formatAmount(amountOut, outputDecimals, 6)} {outputSymbol}
                </dd>
              </div>
              <div>
                <dt>Minimum after slippage</dt>
                <dd className="num">{amountOutMinimum !== undefined ? `${formatAmount(amountOutMinimum, outputDecimals, 6)} ${outputSymbol}` : '—'}</dd>
              </div>
              <div>
                <dt>Rate</dt>
                <dd className="num">
                  1 {inputSymbol} ≈ {formatAmount((amountOut * 10n ** BigInt(inputDecimals)) / amountIn, outputDecimals, 6)} {outputSymbol}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>

        {formError ? (
          <p className="field__error" role="alert">
            {formError}
          </p>
        ) : null}

        {!inputIsNative && isConnected && !wrongNetwork ? (
          <ol className="steps" aria-label="Selling steps">
            <li className={needsTokenApproval ? 'is-current' : 'is-done'}>Approve {inputSymbol} for Permit2</li>
            <li className={!needsTokenApproval && needsPermit2 ? 'is-current' : needsTokenApproval ? '' : 'is-done'}>Authorize the Universal Router in Permit2</li>
            <li className={!needsTokenApproval && !needsPermit2 ? 'is-current' : ''}>Swap</li>
          </ol>
        ) : null}

        <div className="actions">{action}</div>
        <p className="hint">
          {inputIsNative
            ? `${inputSymbol} is sent as the transaction value; nothing needs approval. `
            : `Selling needs two one-time approvals before the swap. `}
          The transaction is simulated before your wallet opens, so a failing swap is reported here instead. USD values are not
          shown because this site reads no price source.
        </p>
        <TxStatus state={approveTx.state} label={`Approving ${inputSymbol}`} successTitle="Permit2 approval confirmed." />
        <TxStatus state={permitTx.state} label="Authorizing the router" successTitle="Router authorized." />
        <TxStatus state={swapTx.state} label="Swapping" successTitle="Swap confirmed." successDetail={`Your ${outputSymbol} balance updates within a few seconds.`} />
      </form>

      <details className="disclosure">
        <summary>Pool and router addresses</summary>
        <dl className="kv">
          <div>
            <dt>Hooks</dt>
            <dd>
              <AddressLink address={poolKey.hooks} />
            </dd>
          </div>
          <div>
            <dt>Universal Router</dt>
            <dd>
              <AddressLink address={uni.universalRouter} />
            </dd>
          </div>
          <div>
            <dt>Quoter</dt>
            <dd>
              <AddressLink address={uni.quoter} />
            </dd>
          </div>
          <div>
            <dt>Permit2</dt>
            <dd>
              <AddressLink address={uni.permit2} />
            </dd>
          </div>
          <div>
            <dt>Pool id</dt>
            <dd className="mono wrap">{poolId}</dd>
          </div>
        </dl>
      </details>
    </section>
  )
}
