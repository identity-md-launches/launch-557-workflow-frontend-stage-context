import { decodeAbiParameters, decodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'
import type { PoolKey } from '../config/deployment'
import { POOL_KEY_COMPONENTS, universalRouterAbi } from '../config/uniswap'
import { applySlippage, computePoolId, encodeV4ExactInSingle, formatPoolFee, priceFromSqrtPriceX96, resolveDirection } from './swap'

const token = '0xfb4ec514a8464a30beccc3b07e2cdd694cbe8e93' as const
const poolKey: PoolKey = {
  currency0: '0x0000000000000000000000000000000000000000',
  currency1: token,
  fee: 12_500,
  tickSpacing: 60,
  hooks: '0x1b7dae02cbe9ccd80ae77e1f51884a324f006000',
}

describe('resolveDirection', () => {
  it('buys the token with the paired currency (ETH is currency0 -> zeroForOne)', () => {
    const d = resolveDirection(poolKey, token, 'buy')
    expect(d.zeroForOne).toBe(true)
    expect(d.inputCurrency).toBe(poolKey.currency0)
    expect(d.outputCurrency.toLowerCase()).toBe(token)
  })
  it('sells the token for the paired currency', () => {
    const d = resolveDirection(poolKey, token, 'sell')
    expect(d.zeroForOne).toBe(false)
    expect(d.inputCurrency.toLowerCase()).toBe(token)
  })
  it('handles a pool where the token sorts first', () => {
    const key: PoolKey = { ...poolKey, currency0: '0x1000000000000000000000000000000000000000', currency1: '0x2000000000000000000000000000000000000000' }
    const d = resolveDirection(key, key.currency0, 'buy')
    expect(d.zeroForOne).toBe(false)
    expect(d.inputCurrency).toBe(key.currency1)
  })
})

describe('encodeV4ExactInSingle', () => {
  it('produces command 0x10 with actions 0x060c0f and the three params', () => {
    const amountIn = 10n ** 18n
    const minOut = 99n * 10n ** 16n
    const { commands, inputs } = encodeV4ExactInSingle({ poolKey, zeroForOne: true, amountIn, amountOutMinimum: minOut })
    expect(commands).toBe('0x10')
    expect(inputs).toHaveLength(1)
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0]!)
    expect(actions).toBe('0x060c0f')
    expect(params).toHaveLength(3)
    const [swap] = decodeAbiParameters(
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
      params[0]!,
    )
    expect(swap.poolKey.currency1.toLowerCase()).toBe(token)
    expect(swap.poolKey.fee).toBe(12_500)
    expect(swap.poolKey.tickSpacing).toBe(60)
    expect(swap.poolKey.hooks.toLowerCase()).toBe(poolKey.hooks)
    expect(swap.zeroForOne).toBe(true)
    expect(swap.amountIn).toBe(amountIn)
    expect(swap.amountOutMinimum).toBe(minOut)
    expect(swap.hookData).toBe('0x')
    const [settleCurrency, settleAmount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]!)
    expect(settleCurrency).toBe(poolKey.currency0)
    expect(settleAmount).toBe(amountIn)
    const [takeCurrency, takeAmount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[2]!)
    expect(takeCurrency.toLowerCase()).toBe(token)
    expect(takeAmount).toBe(minOut)
  })

  it('settles the token and takes ETH when selling', () => {
    const { inputs } = encodeV4ExactInSingle({ poolKey, zeroForOne: false, amountIn: 5n, amountOutMinimum: 1n })
    const [, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0]!)
    const [settleCurrency] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]!)
    const [takeCurrency] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[2]!)
    expect(settleCurrency.toLowerCase()).toBe(token)
    expect(takeCurrency).toBe(poolKey.currency0)
  })

  it('is accepted by the Universal Router execute ABI', () => {
    const { commands, inputs } = encodeV4ExactInSingle({ poolKey, zeroForOne: true, amountIn: 1n, amountOutMinimum: 0n })
    const { encodeFunctionData } = require('viem') as typeof import('viem')
    const data = encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: [commands, inputs, 123n] })
    const decoded = decodeFunctionData({ abi: universalRouterAbi, data })
    expect(decoded.functionName).toBe('execute')
    expect(decoded.args[2]).toBe(123n)
  })
})

describe('math helpers', () => {
  it('applies slippage in basis points, rounding down', () => {
    expect(applySlippage(1000n, 100)).toBe(990n)
    expect(applySlippage(1000n, 50)).toBe(995n)
    expect(applySlippage(999n, 100)).toBe(989n)
    expect(applySlippage(1000n, 0)).toBe(1000n)
  })
  it('computes a stable pool id', () => {
    const id = computePoolId(poolKey)
    expect(id).toMatch(/^0x[0-9a-f]{64}$/)
    expect(computePoolId({ ...poolKey })).toBe(id)
    expect(computePoolId({ ...poolKey, fee: 3000 })).not.toBe(id)
  })
  it('derives prices from sqrtPriceX96', () => {
    const one = priceFromSqrtPriceX96(1n << 96n, 18, 18)!
    expect(one.oneZeroInOne).toBe(10n ** 18n)
    expect(one.oneOneInZero).toBe(10n ** 18n)
    // price 4: sqrt = 2 * 2^96
    const four = priceFromSqrtPriceX96(2n << 96n, 18, 18)!
    expect(four.oneZeroInOne).toBe(4n * 10n ** 18n)
    expect(four.oneOneInZero).toBe(25n * 10n ** 16n)
    expect(priceFromSqrtPriceX96(0n, 18, 18)).toBeNull()
  })
  it('formats pool fees', () => {
    expect(formatPoolFee(12_500)).toBe('1.25%')
    expect(formatPoolFee(3000)).toBe('0.3%')
    expect(formatPoolFee(0x800000)).toBe('dynamic')
  })
})
