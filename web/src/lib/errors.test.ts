import { BaseError, ContractFunctionExecutionError, ContractFunctionRevertedError, UserRejectedRequestError, encodeErrorResult } from 'viem'
import { describe, expect, it } from 'vitest'
import { loadTestDeployment } from '../test/fixtures'
import { translateError } from './errors'

describe('translateError', () => {
  it('explains a user rejection without blame', () => {
    const friendly = translateError(new UserRejectedRequestError(new Error('User rejected the request.')))
    expect(friendly.title).toBe('Request cancelled in the wallet.')
  })

  it('maps raw provider error codes', () => {
    expect(translateError(Object.assign(new Error('denied'), { code: 4001 })).title).toBe('Request cancelled in the wallet.')
    expect(translateError(Object.assign(new Error('x'), { code: 4902 })).title).toMatch(/does not know this network/)
  })

  it('decodes custom errors from the loaded ABIs', async () => {
    const deployment = await loadTestDeployment()
    const abis = [deployment.guestbook.abi, deployment.token.abi]
    const tooLong = new ContractFunctionRevertedError({ abi: deployment.guestbook.abi, functionName: 'sign', data: encodeErrorResult({ abi: deployment.guestbook.abi, errorName: 'MessageTooLong', args: [300n] }) })
    const wrapped = new ContractFunctionExecutionError(tooLong, { abi: deployment.guestbook.abi, functionName: 'sign', args: ['x'] })
    const friendly = translateError(wrapped, { abis, symbol: 'GUEST', maxMessageBytes: 280 })
    expect(friendly.title).toBe('Message is too long.')
    expect(friendly.detail).toContain('300 bytes')

    const noAllowance = new ContractFunctionRevertedError({ abi: deployment.token.abi, functionName: 'sign', data: encodeErrorResult({ abi: deployment.token.abi, errorName: 'ERC20InsufficientAllowance', args: [deployment.guestbook.address, 0n, 10n] }) })
    expect(translateError(new ContractFunctionExecutionError(noAllowance, { abi: deployment.token.abi, functionName: 'sign' }), { abis, symbol: 'GUEST' }).title).toBe('Approval is too small.')

    const noBalance = new ContractFunctionRevertedError({ abi: deployment.token.abi, functionName: 'sign', data: encodeErrorResult({ abi: deployment.token.abi, errorName: 'ERC20InsufficientBalance', args: [deployment.guestbook.address, 0n, 10n] }) })
    expect(translateError(new ContractFunctionExecutionError(noBalance, { abi: deployment.token.abi, functionName: 'sign' }), { abis, symbol: 'GUEST' }).title).toBe('Not enough GUEST.')
  })

  it('decodes raw revert data attached to a plain error', async () => {
    const deployment = await loadTestDeployment()
    const data = encodeErrorResult({ abi: deployment.guestbook.abi, errorName: 'MessageTooLong', args: [281n] })
    expect(translateError({ message: 'execution reverted', data }, { abis: [deployment.guestbook.abi] }).title).toBe('Message is too long.')
  })

  it('flags RPC connectivity and gas problems', () => {
    expect(translateError(new BaseError('HTTP request failed.')).title).toMatch(/Unable to reach/)
    expect(translateError(new BaseError('insufficient funds for gas * price + value')).title).toMatch(/Not enough ETH for gas/)
    expect(translateError(new Error('Failed to fetch')).title).toMatch(/Unable to reach/)
  })

  it('falls back to a short message', () => {
    expect(translateError(new Error('something odd')).detail).toBe('something odd')
    expect(translateError(undefined).detail).toBe('Try again.')
  })
})
