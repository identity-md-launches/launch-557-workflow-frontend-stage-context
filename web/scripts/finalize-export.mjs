#!/usr/bin/env node
/**
 * Finalise `dist/imd-deployment.json` after `vite build`.
 *
 * - verifies every referenced ABI file exists in dist/ and matches its attested hash
 * - enumerates every exported file except the manifest itself and records its SHA-256
 * - enforces the publication limits (<= 128 assets, <= 8 MiB per file) and the
 *   allowed top-level key set
 * - `--check` verifies the committed manifest against the current bytes instead of writing
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { keccak256, stringToHex } = require('viem')

const MANIFEST = 'imd-deployment.json'
const MAX_ASSETS = 128
const MAX_FILE_BYTES = 8 * 1024 * 1024
const TARGET_TOTAL_BYTES = 24 * 1024 * 1024
const ALLOWED_KEYS = ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'poolKey', 'network', 'walletAddChain']

const check = process.argv.includes('--check')
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(webRoot, '..', 'dist')

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]))
  }
  return value
}

function canonicalAbiHash(abi) {
  return keccak256(stringToHex(JSON.stringify(sortKeys(abi)))).slice(2)
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

if (!existsSync(distDir)) throw new Error(`dist directory missing: ${distDir}`)
const manifestPath = join(distDir, MANIFEST)
if (!existsSync(manifestPath)) throw new Error(`${MANIFEST} missing from dist (run scripts/sync-deployment.mjs before building)`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const key of Object.keys(manifest)) {
  if (!ALLOWED_KEYS.includes(key)) throw new Error(`manifest has a disallowed top-level key: ${key}`)
}
for (const key of ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts']) {
  if (manifest[key] === undefined) throw new Error(`manifest is missing ${key}`)
}

for (const contract of manifest.contracts) {
  const abiFile = join(distDir, contract.abiPath)
  if (!existsSync(abiFile)) throw new Error(`ABI file missing for ${contract.name}: ${contract.abiPath}`)
  const abi = JSON.parse(readFileSync(abiFile, 'utf8'))
  const hash = canonicalAbiHash(abi)
  if (hash !== contract.abiHash) throw new Error(`ABI hash mismatch for ${contract.name}: ${hash} != ${contract.abiHash}`)
}

const files = walk(distDir)
  .map((full) => relative(distDir, full).split(sep).join('/'))
  .filter((path) => path !== MANIFEST)
  .sort()

if (files.length > MAX_ASSETS) throw new Error(`export has ${files.length} assets; limit is ${MAX_ASSETS}`)
if (!files.includes('index.html')) throw new Error('index.html missing from export')

let total = 0
const assets = files.map((path) => {
  const bytes = readFileSync(join(distDir, path))
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path} is ${bytes.length} bytes; limit is ${MAX_FILE_BYTES}`)
  total += bytes.length
  return { path, sha256: sha256(bytes) }
})
if (total > TARGET_TOTAL_BYTES) throw new Error(`export totals ${total} bytes; keep it under ${TARGET_TOTAL_BYTES}`)

const ordered = {
  version: manifest.version,
  launchId: manifest.launchId,
  chainId: manifest.chainId,
  sourceCommit: manifest.sourceCommit,
  attestationHash: manifest.attestationHash,
  contracts: manifest.contracts,
  assets,
}
if (manifest.poolKey) ordered.poolKey = manifest.poolKey
if (manifest.network) ordered.network = manifest.network
if (manifest.walletAddChain) ordered.walletAddChain = manifest.walletAddChain

const serialized = JSON.stringify(ordered, null, 2) + '\n'

if (check) {
  const current = readFileSync(manifestPath, 'utf8')
  if (current !== serialized) {
    const want = JSON.stringify(ordered.assets)
    const have = JSON.stringify(manifest.assets ?? [])
    throw new Error(`committed ${MANIFEST} is stale${want !== have ? ' (asset hashes differ)' : ''}; rebuild with npm run build`)
  }
  console.log(`finalize-export: ${MANIFEST} matches ${assets.length} assets (${total} bytes)`)
} else {
  writeFileSync(manifestPath, serialized)
  console.log(`finalize-export: wrote ${MANIFEST} with ${assets.length} assets (${total} bytes total)`)
  for (const asset of assets) console.log(`  ${asset.sha256.slice(0, 16)}  ${asset.path}`)
}
