import { BaseError, ContractFunctionRevertedError, type Abi, decodeErrorResult } from 'viem'

export interface FriendlyError {
  title: string
  detail?: string
}

interface ErrorContext {
  symbol?: string
  signingCost?: string
  maxMessageBytes?: number
  abis?: Abi[]
}

function findCode(error: unknown): number | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown; data?: { originalError?: { code?: unknown } } }
    if (typeof candidate.code === 'number') return candidate.code
    if (typeof candidate.data?.originalError?.code === 'number') return candidate.data.originalError.code
    current = candidate.cause
  }
  return undefined
}

function describeRevert(errorName: string, args: readonly unknown[] | undefined, ctx: ErrorContext): FriendlyError {
  const symbol = ctx.symbol ?? 'tokens'
  const cost = ctx.signingCost ?? '10'
  switch (errorName) {
    case 'MessageTooLong': {
      const length = args?.[0] !== undefined ? String(args[0]) : undefined
      return {
        title: 'Message is too long.',
        detail: `${length ? `It is ${length} bytes. ` : ''}Use at most ${ctx.maxMessageBytes ?? 280} bytes.`,
      }
    }
    case 'ERC20InsufficientAllowance':
      return { title: 'Approval is too small.', detail: `Approve ${cost} ${symbol} for the guestbook, then sign.` }
    case 'ERC20InsufficientBalance':
      return { title: `Not enough ${symbol}.`, detail: `Signing burns ${cost} ${symbol}. Get ${symbol} below, then try again.` }
    case 'ERC20InvalidReceiver':
    case 'ERC20InvalidSender':
    case 'ERC20InvalidSpender':
      return { title: 'Invalid address.', detail: 'Use a non-zero address.' }
    case 'ReentrancyGuardReentrantCall':
      return { title: 'The guestbook rejected a nested call.' }
    case 'EntryNotFound':
      return { title: 'That entry does not exist.' }
    case 'InvalidCursor':
    case 'InvalidPageSize':
      return { title: 'Unable to read that page of entries.', detail: 'Reload and try again.' }
    default:
      return { title: `The contract rejected the request (${errorName}).` }
  }
}

function tryDecodeRevertData(data: unknown, ctx: ErrorContext): FriendlyError | null {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null
  for (const abi of ctx.abis ?? []) {
    try {
      const decoded = decodeErrorResult({ abi, data: data as `0x${string}` })
      return describeRevert(decoded.errorName, decoded.args, ctx)
    } catch {
      // try the next ABI
    }
  }
  return null
}

/** Translate wallet, RPC and contract errors into a plain-language message with a next step. */
export function translateError(error: unknown, ctx: ErrorContext = {}): FriendlyError {
  const code = findCode(error)
  const message = error instanceof Error ? error.message : String(error ?? '')
  const lower = message.toLowerCase()

  if (code === 4001 || /user rejected|user denied|rejected the request/.test(lower)) {
    return { title: 'Request cancelled in the wallet.', detail: 'Nothing was sent. Try again when ready.' }
  }
  if (code === 4902) {
    return { title: 'The wallet does not know this network.', detail: 'Add it from the switch control, then retry.' }
  }

  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    if (revert) {
      if (revert.data?.errorName) return describeRevert(revert.data.errorName, revert.data.args, ctx)
      const decoded = tryDecodeRevertData(revert.raw, ctx)
      if (decoded) return decoded
      if (revert.reason) return { title: 'The contract rejected the request.', detail: revert.reason }
      return { title: 'The contract rejected the request.', detail: 'It reverted without a reason.' }
    }
    if (/insufficient funds/.test(lower)) {
      return { title: 'Not enough ETH for gas.', detail: 'Top up the wallet with Sepolia ETH from a faucet, then retry.' }
    }
    if (/chain mismatch|does not match the target chain|wrong network/.test(lower)) {
      return { title: 'Wallet is on another network.', detail: 'Switch to the configured network, then retry.' }
    }
    if (/http request failed|timeout|failed to fetch|network error|load failed/.test(lower)) {
      return { title: 'Unable to reach the network RPC.', detail: 'Check your connection and try again.' }
    }
    const decoded = tryDecodeRevertData((error as { data?: unknown }).data, ctx)
    if (decoded) return decoded
    return { title: 'Request failed.', detail: error.shortMessage }
  }

  const decoded = tryDecodeRevertData((error as { data?: unknown } | null)?.data, ctx)
  if (decoded) return decoded
  if (/insufficient funds/.test(lower)) {
    return { title: 'Not enough ETH for gas.', detail: 'Top up the wallet with Sepolia ETH from a faucet, then retry.' }
  }
  if (/failed to fetch|network error|load failed/.test(lower)) {
    return { title: 'Unable to reach the network RPC.', detail: 'Check your connection and try again.' }
  }
  return { title: 'Request failed.', detail: message ? message.slice(0, 200) : 'Try again.' }
}
