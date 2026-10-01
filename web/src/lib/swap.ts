import { type Address, type Hex, encodeAbiParameters, keccak256, toHex } from 'viem'
import type { PoolKey } from '../config/deployment'
import { POOL_KEY_COMPONENTS, V4_ACTIONS_EXACT_IN_SINGLE, V4_SWAP_COMMAND } from '../config/uniswap'

export const NATIVE_CURRENCY: Address = '0x0000000000000000000000000000000000000000'

export function isNative(currency: Address): boolean {
  return currency.toLowerCase() === NATIVE_CURRENCY
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** PoolId = keccak256(abi.encode(poolKey)). */
export function computePoolId(poolKey: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters([{ type: 'tuple', components: POOL_KEY_COMPONENTS }], [
      {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks,
      },
    ]),
  )
}

export interface SwapDirection {
  /** Currency the visitor spends. */
  inputCurrency: Address
  /** Currency the visitor receives. */
  outputCurrency: Address
  zeroForOne: boolean
}

/** Resolve the swap direction for buying or selling the launch token in its pool. */
export function resolveDirection(poolKey: PoolKey, token: Address, side: 'buy' | 'sell'): SwapDirection {
  const tokenIs0 = sameAddress(poolKey.currency0, token)
  const tokenCurrency = tokenIs0 ? poolKey.currency0 : poolKey.currency1
  const pairedCurrency = tokenIs0 ? poolKey.currency1 : poolKey.currency0
  const inputCurrency = side === 'buy' ? pairedCurrency : tokenCurrency
  const outputCurrency = side === 'buy' ? tokenCurrency : pairedCurrency
  return { inputCurrency, outputCurrency, zeroForOne: sameAddress(inputCurrency, poolKey.currency0) }
}

export interface ExactInSingleArgs {
  poolKey: PoolKey
  zeroForOne: boolean
  amountIn: bigint
  amountOutMinimum: bigint
  hookData?: Hex
}

/**
 * Encode `execute(commands, inputs, deadline)` arguments for one exact-input
 * single-pool v4 swap: command 0x10 (V4_SWAP), actions
 * SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL.
 */
export function encodeV4ExactInSingle(args: ExactInSingleArgs): { commands: Hex; inputs: Hex[] } {
  const { poolKey, zeroForOne, amountIn, amountOutMinimum } = args
  const hookData = args.hookData ?? '0x'
  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0

  const swapParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: POOL_KEY_COMPONENTS },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [
      {
        poolKey: {
          currency0: poolKey.currency0,
          currency1: poolKey.currency1,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
        },
        zeroForOne,
        amountIn,
        amountOutMinimum,
        hookData,
      },
    ],
  )
  const settleParams = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inputCurrency, amountIn])
  const takeParams = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [outputCurrency, amountOutMinimum])
  const v4Input = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [V4_ACTIONS_EXACT_IN_SINGLE, [swapParams, settleParams, takeParams]],
  )
  return { commands: toHex(new Uint8Array([V4_SWAP_COMMAND])), inputs: [v4Input] }
}

/** Minimum output after `slippageBps` basis points of slippage, rounded down. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))))
  return (amountOut * (10_000n - bps)) / 10_000n
}

export function swapDeadline(nowSeconds: number, ttlSeconds: number): bigint {
  return BigInt(Math.floor(nowSeconds) + ttlSeconds)
}

const Q192 = 1n << 192n
const WAD = 10n ** 18n

/**
 * Price of currency1 in currency0 (and the inverse) from a pool's sqrtPriceX96,
 * each scaled by 1e18 so it can be formatted with 18 decimals.
 */
export function priceFromSqrtPriceX96(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): { oneZeroInOne: bigint; oneOneInZero: bigint } | null {
  if (sqrtPriceX96 === 0n) return null
  const sq = sqrtPriceX96 * sqrtPriceX96
  // raw1PerRaw0 = sq / 2^192 ; human1Per0 = raw * 10^d0 / 10^d1
  const oneZeroInOne = (sq * WAD * 10n ** BigInt(decimals0)) / (Q192 * 10n ** BigInt(decimals1))
  const oneOneInZero = (Q192 * WAD * 10n ** BigInt(decimals1)) / (sq * 10n ** BigInt(decimals0))
  return { oneZeroInOne, oneOneInZero }
}

/** Human-readable fee for a v4 pool fee in hundredths of a basis point. */
export function formatPoolFee(fee: number): string {
  if (fee >= 0x800000) return 'dynamic'
  const percent = fee / 10_000
  return `${percent.toLocaleString('en-US', { maximumFractionDigits: 4 })}%`
}
