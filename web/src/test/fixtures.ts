import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Address } from 'viem'
import { type Deployment, type FetchLike, loadDeployment } from '../config/deployment'

const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public')

/** Serve the committed `public/` files (manifest and ABIs) the way a static host would. */
export const publicFetch: FetchLike = async (input: string) => {
  const path = decodeURIComponent(new URL(input).pathname).replace(/^\/+/, '')
  try {
    const text = readFileSync(join(PUBLIC_DIR, path), 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(text) }
  } catch {
    return { ok: false, status: 404, json: async () => null }
  }
}

export function loadTestDeployment(): Promise<Deployment> {
  return loadDeployment({ fetchFn: publicFetch, baseUrl: 'http://localhost/' })
}

export const ALICE: Address = '0x1111111111111111111111111111111111111111'
export const BOB: Address = '0x2222222222222222222222222222222222222222'
export const CAROL: Address = '0x3333333333333333333333333333333333333333'
export const GUEST = 10n ** 18n
