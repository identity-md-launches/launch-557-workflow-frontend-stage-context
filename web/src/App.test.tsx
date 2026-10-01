/**
 * Interaction tests. The real components, wagmi config and ABIs run against an
 * in-memory chain (served through a `fetch` stub on the manifest's RPC URLs)
 * and a scripted wallet connector. No real RPC or funds are involved.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decodeAbiParameters, decodeFunctionData, erc20Abi } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import { Bootstrap } from './Bootstrap'
import type { Deployment } from './config/deployment'
import { POOL_KEY_COMPONENTS, permit2Abi, universalRouterAbi } from './config/uniswap'
import { buildWagmiConfig } from './config/wagmi'
import { ALICE, BOB, CAROL, GUEST, loadTestDeployment } from './test/fixtures'
import { type MockChainOptions, type MockEntry, createMockChain } from './test/mockChain'
import { testWallet } from './test/testWallet'

const SEPOLIA = 11155111
const COST = 10n * GUEST
const LONG_TIMEOUT = { timeout: 8_000 }
let restoreFetch: (() => void) | null = null
let deploymentCache: Deployment | null = null

interface SetupOptions extends Partial<MockChainOptions> {
  walletChainId?: number
  knownChainIds?: number[]
}

async function setup(options: SetupOptions = {}) {
  const deployment = deploymentCache ?? (deploymentCache = await loadTestDeployment())
  const chain = createMockChain({
    deployment,
    entries: options.entries ?? [
      { signer: BOB, timestamp: 1_760_000_000n, message: 'first post' },
      { signer: CAROL, timestamp: 1_760_000_100n, message: 'second <b>post</b>' },
    ],
    tokenBalances: options.tokenBalances ?? { [ALICE]: 100n * GUEST },
    ethBalances: options.ethBalances ?? { [ALICE]: 10n ** 18n },
    ...options,
  })
  restoreFetch = chain.installFetch()
  const wallet = testWallet({
    accounts: [ALICE],
    chainId: options.walletChainId ?? SEPOLIA,
    knownChainIds: options.knownChainIds ?? [1, SEPOLIA],
    chain,
  })
  const config = buildWagmiConfig(deployment, { connectors: [wallet.connector], pollingInterval: 25 })
  render(<Bootstrap preset={{ deployment, config }} />)
  const user = userEvent.setup()
  const connect = async () => {
    await user.click((await screen.findAllByRole('button', { name: 'Connect Test Wallet' }))[0]!)
    await screen.findByRole('button', { name: 'Disconnect' })
  }
  const signForm = () => screen.getByRole('region', { name: 'Sign the guestbook' })
  const swapForm = () => screen.findByRole('region', { name: 'Get GUEST' }, LONG_TIMEOUT)
  const tokenPanel = () => screen.findByRole('region', { name: 'Guestbook token (GUEST)' }, LONG_TIMEOUT)
  const allow = (amount: bigint) => chain.state.allowances.set(`${ALICE}|${deployment.guestbook.address.toLowerCase()}`, amount)
  return { deployment, chain, wallet, user, connect, signForm, swapForm, tokenPanel, allow }
}

afterEach(() => {
  restoreFetch?.()
  restoreFetch = null
})

describe('reads', () => {
  it('lists entries newest first with the live count and renders messages as text', async () => {
    const { chain, deployment } = await setup()
    expect(await screen.findByText('2 signatures')).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: /Guestbook entries/ })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('#1')
    expect(items[0]).toHaveTextContent('second <b>post</b>')
    expect(items[0]!.querySelector('b')).toBeNull()
    expect(items[1]).toHaveTextContent('#0')
    expect(items[1]).toHaveTextContent('first post')
    // Reads went to the manifest's RPC endpoints, never anywhere else.
    expect(chain.state.requestLog.length).toBeGreaterThan(0)
    expect(chain.state.requestLog.every((r) => deployment.network!.rpcUrls.includes(r.url))).toBe(true)
  })

  it('shows the empty state and the contract table while disconnected', async () => {
    await setup({ entries: [] })
    expect(await screen.findByText('No signatures yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Connect Test Wallet' }).length).toBeGreaterThanOrEqual(1)
    const table = screen.getByRole('table')
    expect(within(table).getByRole('rowheader', { name: 'Guestbook' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'LaunchToken' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'abi/Guestbook.json' })).toHaveAttribute('href', './abi/Guestbook.json')
  })

  it('pages older entries on demand', async () => {
    const entries: MockEntry[] = Array.from({ length: 25 }, (_, i) => ({ signer: BOB, timestamp: 1_760_000_000n + BigInt(i), message: `entry ${i}` }))
    const { user } = await setup({ entries })
    const list = await screen.findByRole('list', { name: /Guestbook entries/ })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(20))
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('entry 24')
    await user.click(screen.getByRole('button', { name: 'Load older entries' }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(25))
    expect(within(list).getAllByRole('listitem')[24]).toHaveTextContent('entry 0')
    expect(screen.queryByRole('button', { name: 'Load older entries' })).toBeNull()
  })
})

describe('wallet and network', () => {
  it('connects, shows the account and offers to add the chain when the wallet does not know it', async () => {
    const { connect, wallet, deployment, user, signForm } = await setup({ walletChainId: 1, knownChainIds: [1] })
    await connect()
    expect(screen.getByText('0x1111…1111')).toBeInTheDocument()
    const banner = await screen.findByRole('region', { name: 'Network' })
    expect(banner).toHaveTextContent('Your wallet is on chain 1')
    await user.click(within(banner).getByRole('button', { name: 'Switch to Sepolia' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Network' })).toBeNull(), LONG_TIMEOUT)
    expect(wallet.provider.added).toEqual([deployment.walletAddChain])
    expect(wallet.provider.chainId).toBe(SEPOLIA)
    expect(await within(signForm()).findByRole('button', { name: 'Approve 10 GUEST' }, LONG_TIMEOUT)).toBeEnabled()
  })

  it('disconnects back to the connect state', async () => {
    const { connect, user } = await setup()
    await connect()
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect((await screen.findAllByRole('button', { name: 'Connect Test Wallet' })).length).toBeGreaterThanOrEqual(1)
  })
})

describe('signing flow', () => {
  it('approves the exact cost, signs, burns 10 GUEST and prepends the new entry', async () => {
    const { connect, user, chain, signForm, deployment } = await setup()
    await connect()
    const form = signForm()
    const approve = await within(form).findByRole('button', { name: 'Approve 10 GUEST' }, LONG_TIMEOUT)
    await user.click(approve)
    expect(await within(form).findByText('Approval confirmed.', {}, LONG_TIMEOUT)).toBeInTheDocument()
    expect(chain.state.sent).toHaveLength(1)
    const approveCall = decodeFunctionData({ abi: deployment.token.abi, data: chain.state.sent[0]!.data })
    expect(approveCall.functionName).toBe('approve')
    expect(approveCall.args).toEqual([deployment.guestbook.address, COST])

    const sign = await within(form).findByRole('button', { name: 'Sign the guestbook' }, LONG_TIMEOUT)
    await user.type(within(form).getByLabelText('Message'), 'Hello chain')
    expect(within(form).getByText('11 of 280 bytes')).toBeInTheDocument()
    await user.click(sign)
    expect(await within(form).findByText('Signed. Your entry is #2.', {}, LONG_TIMEOUT)).toBeInTheDocument()
    expect(chain.state.sent).toHaveLength(2)
    expect(chain.state.sent[1]!.to.toLowerCase()).toBe(deployment.guestbook.address.toLowerCase())
    expect(chain.state.sent[1]!.value).toBe(0n)
    expect(chain.state.balances.get(ALICE)).toBe(90n * GUEST)

    const list = screen.getByRole('list', { name: /Guestbook entries/ })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3), LONG_TIMEOUT)
    const newest = within(list).getAllByRole('listitem')[0]!
    expect(newest).toHaveTextContent('#2')
    expect(newest).toHaveTextContent('Hello chain')
    expect(newest).toHaveTextContent('you')
    expect(await screen.findByText('3 signatures')).toBeInTheDocument()
    // The allowance was consumed, so the next signature needs a fresh approval.
    expect(await within(form).findByRole('button', { name: 'Approve 10 GUEST' }, LONG_TIMEOUT)).toBeInTheDocument()
  })

  it('validates the 280-byte limit on submit without sending anything', async () => {
    const { connect, user, chain, signForm, allow } = await setup()
    allow(COST)
    await connect()
    const form = signForm()
    const sign = await within(form).findByRole('button', { name: 'Sign the guestbook' }, LONG_TIMEOUT)
    const field = within(form).getByLabelText('Message')
    await user.click(field)
    await user.paste('😀'.repeat(71))
    expect(within(form).getByText('284 of 280 bytes (too long)')).toBeInTheDocument()
    await user.click(sign)
    expect(within(form).getByText('Message is 284 bytes. Use at most 280 bytes.')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveFocus()
    expect(chain.state.sent).toHaveLength(0)
  })

  it('keeps signing disabled when the balance is below the cost', async () => {
    const { connect, signForm } = await setup({ tokenBalances: { [ALICE]: 3n * GUEST } })
    await connect()
    const form = signForm()
    expect(await within(form).findByText('You need 10 GUEST to sign.', {}, LONG_TIMEOUT)).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Sign the guestbook' })).toBeDisabled()
    expect(within(form).getByRole('link', { name: 'Get GUEST with ETH' })).toHaveAttribute('href', '#swap')
  })

  it('surfaces a contract revert from the simulation before the wallet opens', async () => {
    const { connect, user, chain, signForm, allow, deployment } = await setup()
    allow(COST)
    chain.forceRevert('sign', deployment.token.abi, 'ERC20InsufficientBalance', [ALICE, 0n, COST])
    await connect()
    const form = signForm()
    await user.type(within(form).getByLabelText('Message'), 'hi')
    await user.click(await within(form).findByRole('button', { name: 'Sign the guestbook' }, LONG_TIMEOUT))
    const alert = await within(form).findByRole('alert', {}, LONG_TIMEOUT)
    expect(alert).toHaveTextContent('Not enough GUEST.')
    expect(chain.state.sent).toHaveLength(0)
    expect(within(form).getByRole('button', { name: 'Sign the guestbook' })).toBeEnabled()
  })

  it('reports a wallet rejection and releases the button', async () => {
    const { connect, user, wallet, signForm, chain } = await setup()
    await connect()
    const form = signForm()
    wallet.provider.rejectNextTransaction()
    await user.click(await within(form).findByRole('button', { name: 'Approve 10 GUEST' }, LONG_TIMEOUT))
    const alert = await within(form).findByRole('alert', {}, LONG_TIMEOUT)
    expect(alert).toHaveTextContent('Request cancelled in the wallet.')
    expect(chain.state.sent).toHaveLength(0)
    expect(within(form).getByRole('button', { name: 'Approve 10 GUEST' })).toBeEnabled()
  })
})

describe('swap', () => {
  it('quotes and buys GUEST with ETH through the Universal Router', async () => {
    const { connect, user, chain, swapForm, deployment } = await setup({ zeroForOneRate: 2n * 10n ** 18n })
    await connect()
    const form = await swapForm()
    expect(await within(form).findByText(/1 ETH ≈ 1 GUEST/)).toBeInTheDocument()
    await user.type(within(form).getByLabelText('You pay (ETH)'), '0.5')
    expect(await within(form).findByText('1 GUEST', {}, LONG_TIMEOUT)).toBeInTheDocument()
    expect(within(form).getByText('0.99 GUEST')).toBeInTheDocument()
    const swap = await within(form).findByRole('button', { name: 'Swap ETH for GUEST' }, LONG_TIMEOUT)
    await waitFor(() => expect(swap).toBeEnabled(), LONG_TIMEOUT)
    await user.click(swap)
    expect(await within(form).findByText('Swap confirmed.', {}, LONG_TIMEOUT)).toBeInTheDocument()
    expect(chain.state.sent).toHaveLength(1)
    const sent = chain.state.sent[0]!
    expect(sent.to.toLowerCase()).toBe(deployment.network!.uniswapV4.universalRouter.toLowerCase())
    expect(sent.value).toBe(5n * 10n ** 17n)
    const call = decodeFunctionData({ abi: universalRouterAbi, data: sent.data })
    expect(call.functionName).toBe('execute')
    const [commands, inputs, deadline] = call.args as [`0x${string}`, `0x${string}`[], bigint]
    expect(commands).toBe('0x10')
    expect(Number(deadline)).toBeGreaterThan(Date.now() / 1000 + 60)
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0]!)
    expect(actions).toBe('0x060c0f')
    const [swapParams] = decodeAbiParameters(
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
    expect(swapParams.poolKey.hooks.toLowerCase()).toBe(deployment.poolKey!.hooks.toLowerCase())
    expect(swapParams.poolKey.fee).toBe(deployment.poolKey!.fee)
    expect(swapParams.zeroForOne).toBe(true)
    expect(swapParams.amountIn).toBe(5n * 10n ** 17n)
    expect(swapParams.amountOutMinimum).toBe(99n * 10n ** 16n)
  })

  it('walks the Permit2 steps when selling GUEST', async () => {
    const { connect, user, chain, swapForm, deployment } = await setup()
    await connect()
    const form = await swapForm()
    await user.click(within(form).getByLabelText('Sell GUEST for ETH'))
    await user.type(within(form).getByLabelText('You pay (GUEST)'), '5')
    const uni = deployment.network!.uniswapV4
    await user.click(await within(form).findByRole('button', { name: 'Step 1 of 3: approve GUEST for Permit2' }, LONG_TIMEOUT))
    expect(await within(form).findByText('Permit2 approval confirmed.', {}, LONG_TIMEOUT)).toBeInTheDocument()
    const approve = decodeFunctionData({ abi: erc20Abi, data: chain.state.sent[0]!.data })
    expect(approve.functionName).toBe('approve')
    expect(approve.args).toEqual([uni.permit2, 5n * GUEST])

    await user.click(await within(form).findByRole('button', { name: 'Step 2 of 3: authorize the router in Permit2' }, LONG_TIMEOUT))
    expect(await within(form).findByText('Router authorized.', {}, LONG_TIMEOUT)).toBeInTheDocument()
    expect(chain.state.sent[1]!.to.toLowerCase()).toBe(uni.permit2.toLowerCase())
    const permit = decodeFunctionData({ abi: permit2Abi, data: chain.state.sent[1]!.data })
    expect(permit.functionName).toBe('approve')
    const permitArgs = permit.args as readonly unknown[]
    expect(permitArgs[0]).toBe(deployment.token.address)
    expect(permitArgs[1]).toBe(uni.universalRouter)
    expect(permitArgs[2]).toBe(5n * GUEST)

    const swap = await within(form).findByRole('button', { name: 'Step 3 of 3: swap GUEST for ETH' }, LONG_TIMEOUT)
    await waitFor(() => expect(swap).toBeEnabled(), LONG_TIMEOUT)
    await user.click(swap)
    expect(await within(form).findByText('Swap confirmed.', {}, LONG_TIMEOUT)).toBeInTheDocument()
    expect(chain.state.sent[2]!.to.toLowerCase()).toBe(uni.universalRouter.toLowerCase())
    expect(chain.state.sent[2]!.value).toBe(0n)
  })

  it('shows the router revert reason instead of sending', async () => {
    const { connect, user, chain, swapForm, deployment } = await setup()
    chain.forceRevert('execute', deployment.token.abi, 'ERC20InsufficientBalance', [ALICE, 0n, 1n])
    await connect()
    const form = await swapForm()
    await user.type(within(form).getByLabelText('You pay (ETH)'), '0.1')
    const swap = await within(form).findByRole('button', { name: 'Swap ETH for GUEST' }, LONG_TIMEOUT)
    await waitFor(() => expect(swap).toBeEnabled(), LONG_TIMEOUT)
    await user.click(swap)
    expect(await within(form).findByRole('alert', {}, LONG_TIMEOUT)).toHaveTextContent('Not enough GUEST.')
    expect(chain.state.sent).toHaveLength(0)
  })
})

describe('token panel', () => {
  it('transfers and burns with validation', async () => {
    const { connect, user, chain, tokenPanel } = await setup()
    await connect()
    const panel = await tokenPanel()
    expect(await within(panel).findByText('100 GUEST', {}, LONG_TIMEOUT)).toBeInTheDocument()

    await user.click(within(panel).getByText('Transfer GUEST', { selector: 'summary' }))
    await user.click(within(panel).getByRole('button', { name: 'Transfer GUEST' }))
    expect(within(panel).getByText('Enter a valid 0x address for the recipient.')).toBeInTheDocument()
    await user.type(within(panel).getByLabelText('Recipient address'), BOB)
    await user.type(within(panel).getByLabelText('Amount (GUEST)'), '1.5')
    await user.click(within(panel).getByRole('button', { name: 'Transfer GUEST' }))
    expect(await within(panel).findByText('Transfer confirmed.', {}, LONG_TIMEOUT)).toBeInTheDocument()
    expect(chain.state.balances.get(BOB)).toBe(15n * 10n ** 17n)

    await user.click(within(panel).getByText('Burn GUEST', { selector: 'summary' }))
    await user.type(within(panel).getByLabelText('Amount to burn (GUEST)'), '1000')
    await user.click(within(panel).getByRole('button', { name: 'Burn GUEST' }))
    expect(within(panel).getByText(/Amount exceeds your balance/)).toBeInTheDocument()
    await user.clear(within(panel).getByLabelText('Amount to burn (GUEST)'))
    await user.type(within(panel).getByLabelText('Amount to burn (GUEST)'), '2')
    const supplyBefore = chain.state.totalSupply
    await user.click(within(panel).getByRole('button', { name: 'Burn GUEST' }))
    expect(await within(panel).findByText('Burn confirmed.', {}, LONG_TIMEOUT)).toBeInTheDocument()
    expect(chain.state.totalSupply).toBe(supplyBefore - 2n * GUEST)
  })
})
