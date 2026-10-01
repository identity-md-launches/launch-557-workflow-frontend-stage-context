/**
 * In-memory stand-in for the Sepolia JSON-RPC endpoint and the deployed
 * contracts. It decodes calldata with the real ABIs, applies the Guestbook and
 * LaunchToken rules (allowance, balance, 280-byte limit, burn), and answers the
 * Uniswap periphery calls (quoter, state view, Permit2, Universal Router) so
 * the swap flow can be exercised without funds.
 */
import {
  type Abi,
  type Address,
  type Hex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  erc20Abi,
  keccak256,
  numberToHex,
  stringToHex,
  toHex,
} from 'viem'
import type { Deployment } from '../config/deployment'
import { permit2Abi, quoterAbi, stateViewAbi, universalRouterAbi } from '../config/uniswap'

export interface MockEntry {
  signer: Address
  timestamp: bigint
  message: string
}

export interface SentTransaction {
  from: Address
  to: Address
  data: Hex
  value: bigint
  hash: Hex
}

export interface MockChainOptions {
  deployment: Deployment
  entries?: MockEntry[]
  tokenBalances?: Record<string, bigint>
  ethBalances?: Record<string, bigint>
  totalSupply?: bigint
  sqrtPriceX96?: bigint
  liquidity?: bigint
  /** Output per unit of currency0 input, in 1e18 fixed point (used by the quoter stub). */
  oneForZeroRate?: bigint
  zeroForOneRate?: bigint
}

interface RpcError {
  code: number
  message: string
  data?: Hex
}

class RevertError extends Error {
  constructor(public readonly data: Hex) {
    super('execution reverted')
  }
}

const SIGNING_COST = 10n * 10n ** 18n
const MAX_MESSAGE_BYTES = 280n
const MAX_PAGE_SIZE = 50n
const ZERO: Address = '0x0000000000000000000000000000000000000000'
const Q96 = 1n << 96n

function key(...parts: string[]): string {
  return parts.map((p) => p.toLowerCase()).join('|')
}

export function createMockChain(options: MockChainOptions) {
  const { deployment } = options
  const network = deployment.network!
  const uni = network.uniswapV4
  const chainId = deployment.chainId
  const guestbookAbi = deployment.guestbook.abi
  const tokenAbi = deployment.token.abi
  const tokenAddress = deployment.token.address
  const guestbookAddress = deployment.guestbook.address

  const state = {
    blockNumber: 1_000n,
    timestamp: 1_760_000_000n,
    entries: [...(options.entries ?? [])],
    balances: new Map<string, bigint>(Object.entries(options.tokenBalances ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    ethBalances: new Map<string, bigint>(Object.entries(options.ethBalances ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    allowances: new Map<string, bigint>(),
    permit2: new Map<string, { amount: bigint; expiration: bigint }>(),
    totalSupply: options.totalSupply ?? 1_000_000_000n * 10n ** 18n,
    sqrtPriceX96: options.sqrtPriceX96 ?? Q96,
    liquidity: options.liquidity ?? 10n ** 18n,
    zeroForOneRate: options.zeroForOneRate ?? 10n ** 18n,
    oneForZeroRate: options.oneForZeroRate ?? 10n ** 18n,
    receipts: new Map<string, unknown>(),
    transactions: new Map<string, unknown>(),
    sent: [] as SentTransaction[],
    forcedReverts: new Map<string, { abi: Abi; errorName: string; args: unknown[] }>(),
    requestLog: [] as { method: string; url: string }[],
  }

  const balanceOf = (a: string) => state.balances.get(a.toLowerCase()) ?? 0n
  const setBalance = (a: string, v: bigint) => state.balances.set(a.toLowerCase(), v)
  const allowanceOf = (o: string, s: string) => state.allowances.get(key(o, s)) ?? 0n

  function revert(abi: Abi, errorName: string, args: unknown[]): never {
    throw new RevertError(encodeErrorResult({ abi, errorName, args }))
  }

  function runGuestbook(fn: string, args: readonly unknown[], from: Address, apply: boolean): Hex {
    switch (fn) {
      case 'entryCount':
        return encodeFunctionResult({ abi: guestbookAbi, functionName: fn, result: BigInt(state.entries.length) })
      case 'SIGNING_COST':
        return encodeFunctionResult({ abi: guestbookAbi, functionName: fn, result: SIGNING_COST })
      case 'MAX_MESSAGE_BYTES':
        return encodeFunctionResult({ abi: guestbookAbi, functionName: fn, result: MAX_MESSAGE_BYTES })
      case 'MAX_PAGE_SIZE':
        return encodeFunctionResult({ abi: guestbookAbi, functionName: fn, result: MAX_PAGE_SIZE })
      case 'token':
        return encodeFunctionResult({ abi: guestbookAbi, functionName: fn, result: tokenAddress })
      case 'getEntry': {
        const id = args[0] as bigint
        if (id >= BigInt(state.entries.length)) revert(guestbookAbi, 'EntryNotFound', [id])
        return encodeFunctionResult({ abi: guestbookAbi, functionName: fn, result: state.entries[Number(id)] })
      }
      case 'getEntries': {
        const [beforeId, limit] = args as [bigint, bigint]
        if (limit === 0n || limit > MAX_PAGE_SIZE) revert(guestbookAbi, 'InvalidPageSize', [limit])
        const count = BigInt(state.entries.length)
        if (beforeId > count) revert(guestbookAbi, 'InvalidCursor', [beforeId, count])
        const size = beforeId < limit ? beforeId : limit
        const page: MockEntry[] = []
        for (let i = 0n; i < size; i += 1n) page.push(state.entries[Number(beforeId - 1n - i)]!)
        return encodeFunctionResult({ abi: guestbookAbi, functionName: fn, result: [page, beforeId - size] })
      }
      case 'sign': {
        const forced = state.forcedReverts.get('sign')
        if (forced) revert(forced.abi, forced.errorName, forced.args)
        const message = args[0] as string
        const length = BigInt(new TextEncoder().encode(message).length)
        if (length > MAX_MESSAGE_BYTES) revert(guestbookAbi, 'MessageTooLong', [length])
        const allowance = allowanceOf(from, guestbookAddress)
        if (allowance < SIGNING_COST) revert(tokenAbi, 'ERC20InsufficientAllowance', [guestbookAddress, allowance, SIGNING_COST])
        const balance = balanceOf(from)
        if (balance < SIGNING_COST) revert(tokenAbi, 'ERC20InsufficientBalance', [from, balance, SIGNING_COST])
        const entryId = BigInt(state.entries.length)
        if (apply) {
          state.entries.push({ signer: from, timestamp: state.timestamp, message })
          state.allowances.set(key(from, guestbookAddress), allowance - SIGNING_COST)
          setBalance(from, balance - SIGNING_COST)
          state.totalSupply -= SIGNING_COST
        }
        return encodeFunctionResult({ abi: guestbookAbi, functionName: fn, result: entryId })
      }
      default:
        throw new Error(`mock guestbook: unsupported ${fn}`)
    }
  }

  function runToken(address: Address, fn: string, args: readonly unknown[], from: Address, apply: boolean): Hex {
    const abi = address.toLowerCase() === tokenAddress.toLowerCase() ? tokenAbi : erc20Abi
    switch (fn) {
      case 'name':
        return encodeFunctionResult({ abi, functionName: fn, result: 'Guestbook' })
      case 'symbol':
        return encodeFunctionResult({ abi, functionName: fn, result: 'GUEST' })
      case 'decimals':
        return encodeFunctionResult({ abi, functionName: fn, result: 18 })
      case 'totalSupply':
        return encodeFunctionResult({ abi, functionName: fn, result: state.totalSupply })
      case 'balanceOf':
        return encodeFunctionResult({ abi, functionName: fn, result: balanceOf(args[0] as string) })
      case 'allowance':
        return encodeFunctionResult({ abi, functionName: fn, result: allowanceOf(args[0] as string, args[1] as string) })
      case 'approve': {
        if (apply) state.allowances.set(key(from, args[0] as string), args[1] as bigint)
        return encodeFunctionResult({ abi, functionName: fn, result: true })
      }
      case 'transfer': {
        const [to, value] = args as [Address, bigint]
        if (to.toLowerCase() === ZERO) revert(tokenAbi, 'ERC20InvalidReceiver', [to])
        const balance = balanceOf(from)
        if (balance < value) revert(tokenAbi, 'ERC20InsufficientBalance', [from, balance, value])
        if (apply) {
          setBalance(from, balance - value)
          setBalance(to, balanceOf(to) + value)
        }
        return encodeFunctionResult({ abi, functionName: fn, result: true })
      }
      case 'burn': {
        const value = args[0] as bigint
        const balance = balanceOf(from)
        if (balance < value) revert(tokenAbi, 'ERC20InsufficientBalance', [from, balance, value])
        if (apply) {
          setBalance(from, balance - value)
          state.totalSupply -= value
        }
        return '0x'
      }
      default:
        throw new Error(`mock token: unsupported ${fn}`)
    }
  }

  function runQuoter(fn: string, args: readonly unknown[]): Hex {
    if (fn !== 'quoteExactInputSingle') throw new Error(`mock quoter: unsupported ${fn}`)
    const params = args[0] as { zeroForOne: boolean; exactAmount: bigint }
    const rate = params.zeroForOne ? state.zeroForOneRate : state.oneForZeroRate
    const amountOut = (params.exactAmount * rate) / 10n ** 18n
    return encodeFunctionResult({ abi: quoterAbi, functionName: fn, result: [amountOut, 150_000n] })
  }

  function runStateView(fn: string): Hex {
    if (fn === 'getSlot0') return encodeFunctionResult({ abi: stateViewAbi, functionName: fn, result: [state.sqrtPriceX96, 0, 0, 12_500] })
    if (fn === 'getLiquidity') return encodeFunctionResult({ abi: stateViewAbi, functionName: fn, result: state.liquidity })
    throw new Error(`mock state view: unsupported ${fn}`)
  }

  function runPermit2(fn: string, args: readonly unknown[], from: Address, apply: boolean): Hex {
    if (fn === 'allowance') {
      const [user, token, spender] = args as [string, string, string]
      const entry = state.permit2.get(key(user, token, spender)) ?? { amount: 0n, expiration: 0n }
      return encodeFunctionResult({ abi: permit2Abi, functionName: fn, result: [entry.amount, Number(entry.expiration), 0] })
    }
    if (fn === 'approve') {
      const [token, spender, amount, expiration] = args as [string, string, bigint, bigint | number]
      if (apply) state.permit2.set(key(from, token, spender), { amount, expiration: BigInt(expiration) })
      return '0x'
    }
    throw new Error(`mock permit2: unsupported ${fn}`)
  }

  function runRouter(fn: string): Hex {
    if (fn !== 'execute') throw new Error(`mock router: unsupported ${fn}`)
    const forced = state.forcedReverts.get('execute')
    if (forced) revert(forced.abi, forced.errorName, forced.args)
    return '0x'
  }

  function call(tx: { to?: Address; data?: Hex; from?: Address; value?: Hex }, apply: boolean): Hex {
    const to = (tx.to ?? ZERO).toLowerCase()
    const from = (tx.from ?? ZERO) as Address
    const data = tx.data ?? '0x'
    if (to === guestbookAddress.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: guestbookAbi, data })
      return runGuestbook(functionName, args ?? [], from, apply)
    }
    if (to === tokenAddress.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: tokenAbi, data })
      return runToken(tokenAddress, functionName, args ?? [], from, apply)
    }
    if (to === uni.quoter.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: quoterAbi, data })
      return runQuoter(functionName, args ?? [])
    }
    if (to === uni.stateView.toLowerCase()) {
      const { functionName } = decodeFunctionData({ abi: stateViewAbi, data })
      return runStateView(functionName)
    }
    if (to === uni.permit2.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: permit2Abi, data })
      return runPermit2(functionName, args ?? [], from, apply)
    }
    if (to === uni.universalRouter.toLowerCase()) {
      const { functionName } = decodeFunctionData({ abi: universalRouterAbi, data })
      return runRouter(functionName)
    }
    throw new Error(`mock chain: no contract at ${to}`)
  }

  function sendTransaction(tx: { to?: Address; data?: Hex; from?: Address; value?: Hex }): Hex {
    const hash = keccak256(stringToHex(`${state.sent.length}:${tx.data ?? ''}:${tx.value ?? ''}`))
    const logs: unknown[] = []
    const before = state.entries.length
    call(tx, true)
    state.blockNumber += 1n
    if (state.entries.length > before) {
      const entry = state.entries[before]!
      const topics = encodeEventTopics({
        abi: guestbookAbi,
        eventName: 'Signed',
        args: { entryId: BigInt(before), signer: entry.signer },
      })
      logs.push({
        address: guestbookAddress,
        topics,
        data: encodeAbiParameters([{ type: 'uint256' }, { type: 'string' }], [entry.timestamp, entry.message]),
        blockNumber: numberToHex(state.blockNumber),
        transactionHash: hash,
        transactionIndex: '0x0',
        blockHash: keccak256(toHex(state.blockNumber)),
        logIndex: '0x0',
        removed: false,
      })
    }
    const blockHash = keccak256(toHex(state.blockNumber))
    state.sent.push({ from: tx.from ?? ZERO, to: tx.to ?? ZERO, data: tx.data ?? '0x', value: tx.value ? BigInt(tx.value) : 0n, hash })
    state.receipts.set(hash, {
      transactionHash: hash,
      transactionIndex: '0x0',
      blockHash,
      blockNumber: numberToHex(state.blockNumber),
      from: tx.from ?? ZERO,
      to: tx.to ?? ZERO,
      cumulativeGasUsed: '0x5208',
      gasUsed: '0x5208',
      effectiveGasPrice: '0x3b9aca00',
      contractAddress: null,
      logs,
      logsBloom: `0x${'0'.repeat(512)}`,
      status: '0x1',
      type: '0x2',
    })
    state.transactions.set(hash, {
      hash,
      nonce: '0x1',
      blockHash,
      blockNumber: numberToHex(state.blockNumber),
      transactionIndex: '0x0',
      from: tx.from ?? ZERO,
      to: tx.to ?? ZERO,
      value: tx.value ?? '0x0',
      gas: '0x5208',
      gasPrice: '0x3b9aca00',
      maxFeePerGas: '0x3b9aca00',
      maxPriorityFeePerGas: '0x1',
      input: tx.data ?? '0x',
      type: '0x2',
      chainId: numberToHex(chainId),
      v: '0x0',
      r: '0x0',
      s: '0x0',
    })
    return hash
  }

  function block() {
    return {
      number: numberToHex(state.blockNumber),
      hash: keccak256(toHex(state.blockNumber)),
      parentHash: keccak256(toHex(state.blockNumber - 1n)),
      timestamp: numberToHex(state.timestamp),
      transactions: [],
      gasLimit: '0x1c9c380',
      gasUsed: '0x0',
      baseFeePerGas: '0x3b9aca00',
      miner: ZERO,
      nonce: '0x0000000000000000',
      difficulty: '0x0',
      extraData: '0x',
      logsBloom: `0x${'0'.repeat(512)}`,
      mixHash: keccak256(toHex(1n)),
      receiptsRoot: keccak256(toHex(2n)),
      sha3Uncles: keccak256(toHex(3n)),
      size: '0x100',
      stateRoot: keccak256(toHex(4n)),
      totalDifficulty: '0x0',
      transactionsRoot: keccak256(toHex(5n)),
      uncles: [],
    }
  }

  function handle(method: string, params: unknown[] | undefined): unknown {
    switch (method) {
      case 'eth_chainId':
        return numberToHex(chainId)
      case 'net_version':
        return String(chainId)
      case 'eth_blockNumber':
        return numberToHex(state.blockNumber)
      case 'eth_getBalance':
        return numberToHex(state.ethBalances.get(String(params?.[0]).toLowerCase()) ?? 0n)
      case 'eth_getCode':
        return '0x6080'
      case 'eth_gasPrice':
        return '0x3b9aca00'
      case 'eth_maxPriorityFeePerGas':
        return '0x1'
      case 'eth_estimateGas':
        return '0x186a0'
      case 'eth_call':
        return call(params?.[0] as never, false)
      case 'eth_sendTransaction':
        return sendTransaction(params?.[0] as never)
      case 'eth_getTransactionReceipt':
        return state.receipts.get(String(params?.[0])) ?? null
      case 'eth_getTransactionByHash':
        return state.transactions.get(String(params?.[0])) ?? null
      case 'eth_getBlockByNumber':
      case 'eth_getBlockByHash':
        return block()
      case 'eth_getLogs':
        return []
      default:
        throw new Error(`mock chain: unsupported method ${method}`)
    }
  }

  function respond(request: { id: number; method: string; params?: unknown[] }, url: string) {
    state.requestLog.push({ method: request.method, url })
    try {
      return { jsonrpc: '2.0', id: request.id, result: handle(request.method, request.params) }
    } catch (error) {
      const rpcError: RpcError =
        error instanceof RevertError
          ? { code: 3, message: 'execution reverted', data: error.data }
          : { code: -32603, message: (error as Error).message }
      return { jsonrpc: '2.0', id: request.id, error: rpcError }
    }
  }

  /** Route `fetch` to this chain for the configured RPC URLs. Returns a restore function. */
  function installFetch() {
    const original = globalThis.fetch
    const allowed = new Map(network.rpcUrls.map((u) => [new URL(u).toString(), u]))
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const url = allowed.get(new URL(raw).toString())
      if (!url) throw new Error(`mock chain: unexpected fetch to ${raw}`)
      const body = JSON.parse(String(init?.body ?? '{}'))
      const payload = Array.isArray(body) ? body.map((r) => respond(r, url)) : respond(body, url)
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    return () => {
      globalThis.fetch = original
    }
  }

  return {
    state,
    handle,
    installFetch,
    /** Provider-side request handler (what a wallet forwards to the node). */
    request: (method: string, params?: unknown[]) => handle(method, params),
    setBalance,
    forceRevert(fn: 'sign' | 'execute', abi: Abi, errorName: string, args: unknown[] = []) {
      state.forcedReverts.set(fn, { abi, errorName, args })
    },
    clearRevert(fn: 'sign' | 'execute') {
      state.forcedReverts.delete(fn)
    },
  }
}

export type MockChain = ReturnType<typeof createMockChain>
