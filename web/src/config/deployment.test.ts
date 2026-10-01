import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTestDeployment, publicFetch } from '../test/fixtures'
import { canonicalAbiHash, loadDeployment, validateManifest } from './deployment'

const manifestPath = resolve(__dirname, '..', '..', 'public', 'imd-deployment.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

describe('loadDeployment', () => {
  it('loads the committed manifest and hash-verified ABIs', async () => {
    const deployment = await loadTestDeployment()
    expect(deployment.chainId).toBe(11155111)
    expect(deployment.token.address.toLowerCase()).toBe(manifest.contracts[0].address)
    expect(deployment.guestbook.address.toLowerCase()).toBe(manifest.contracts[1].address)
    expect(deployment.network?.uniswapV4.universalRouter).toBeDefined()
    expect(deployment.walletAddChain?.chainId).toBe('0xaa36a7')
    expect(deployment.poolKey?.hooks.toLowerCase()).toBe(manifest.poolKey.hooks)
    expect(deployment.guestbook.abi.some((item) => item.type === 'function' && item.name === 'sign')).toBe(true)
    for (const contract of deployment.contracts) {
      expect(canonicalAbiHash(contract.abi)).toBe(contract.abiHash)
    }
  })

  it('rejects an ABI whose hash does not match the attestation', async () => {
    const tampered = async (url: string) => {
      const res = await publicFetch(url)
      if (!url.endsWith('Guestbook.json')) return res
      const abi = (await res.json()) as unknown[]
      return { ok: true, status: 200, json: async () => [...abi, { type: 'function', name: 'backdoor', inputs: [], outputs: [], stateMutability: 'nonpayable' }] }
    }
    await expect(loadDeployment({ fetchFn: tampered, baseUrl: 'http://localhost/' })).rejects.toThrow(/does not match the attested hash/)
  })

  it('fails clearly when the manifest is missing', async () => {
    await expect(loadDeployment({ fetchFn: publicFetch, baseUrl: 'http://localhost/missing/' })).rejects.toThrow(/HTTP 404/)
  })
})

describe('validateManifest', () => {
  it('accepts the committed manifest', () => {
    const parsed = validateManifest(manifest)
    expect(parsed.contracts.map((c) => c.name)).toEqual(['LaunchToken', 'Guestbook'])
    expect(parsed.network?.rpcUrls.length).toBeGreaterThan(0)
  })
  it('rejects absolute or traversing ABI paths', () => {
    expect(() => validateManifest({ ...manifest, contracts: [{ ...manifest.contracts[0], abiPath: 'https://evil.example/abi.json' }] })).toThrow(/relative path/)
    expect(() => validateManifest({ ...manifest, contracts: [{ ...manifest.contracts[0], abiPath: '../abi.json' }] })).toThrow(/relative path/)
  })
  it('rejects a network block for another chain', () => {
    expect(() => validateManifest({ ...manifest, network: { ...manifest.network, chainId: 1 } })).toThrow(/does not match/)
  })
  it('rejects a malformed address', () => {
    expect(() => validateManifest({ ...manifest, contracts: [{ ...manifest.contracts[0], address: '0x1234' }] })).toThrow(/not an address/)
  })
})
