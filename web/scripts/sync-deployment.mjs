#!/usr/bin/env node
/**
 * Derive the app's runtime deployment configuration from the workflow handoff.
 *
 * Inputs (repository root, present only while the assignment runs):
 *   .imd/reads/deployment.json   validated deployment handoff
 *   .imd/reads/network.json      vetted chain table (network + walletAddChain)
 *   docs/abi/<Contract>.json     implementation-derived ABIs at the pinned commit
 *
 * Outputs (committed, so later rebuilds need no handoff):
 *   web/public/abi/<Contract>.json
 *   web/public/imd-deployment.json   (assets filled in by finalize-export.mjs)
 *
 * When the handoff is absent the committed public files are left untouched.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { keccak256, stringToHex } = require('viem')

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(webRoot, '..')
const handoffPath = join(repoRoot, '.imd', 'reads', 'deployment.json')
const networkPath = join(repoRoot, '.imd', 'reads', 'network.json')
const publicDir = join(webRoot, 'public')

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]))
  }
  return value
}

export function canonicalAbiHash(abi) {
  return keccak256(stringToHex(JSON.stringify(sortKeys(abi)))).slice(2)
}

if (!existsSync(handoffPath)) {
  console.log(`sync-deployment: no handoff at ${handoffPath}; keeping committed public/imd-deployment.json`)
  process.exit(0)
}

const handoff = JSON.parse(readFileSync(handoffPath, 'utf8'))
if (handoff.version !== 1) throw new Error(`unexpected handoff version ${handoff.version}`)

mkdirSync(join(publicDir, 'abi'), { recursive: true })

const contracts = handoff.contracts.map((c) => {
  const abiSource = join(repoRoot, 'docs', 'abi', `${c.name}.json`)
  if (!existsSync(abiSource)) throw new Error(`missing ABI export ${abiSource}`)
  const abi = JSON.parse(readFileSync(abiSource, 'utf8'))
  if (!Array.isArray(abi)) throw new Error(`${abiSource} is not an ABI array`)
  const hash = canonicalAbiHash(abi)
  if (hash !== c.abiHash) throw new Error(`ABI hash mismatch for ${c.name}: ${hash} != ${c.abiHash}`)
  const abiPath = `abi/${c.name}.json`
  writeFileSync(join(publicDir, abiPath), JSON.stringify(abi) + '\n')
  console.log(`sync-deployment: ${abiPath} ok (${hash.slice(0, 12)}…)`)
  return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath }
})

const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets: [],
}
if (handoff.poolKey) {
  const { currency0, currency1, fee, tickSpacing, hooks } = handoff.poolKey
  manifest.poolKey = { currency0, currency1, fee, tickSpacing, hooks }
}
if (existsSync(networkPath)) {
  const network = JSON.parse(readFileSync(networkPath, 'utf8'))
  if (!network.network) throw new Error('network.json has no network block')
  if (network.network.chainId !== handoff.chainId) {
    throw new Error(`network.json chain ${network.network.chainId} != handoff chain ${handoff.chainId}`)
  }
  manifest.network = network.network
  if (network.walletAddChain) manifest.walletAddChain = network.walletAddChain
} else {
  console.warn('sync-deployment: no network.json; swaps will be disabled in the app')
}

writeFileSync(join(publicDir, 'imd-deployment.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`sync-deployment: wrote public/imd-deployment.json for launch ${manifest.launchId} on chain ${manifest.chainId}`)
