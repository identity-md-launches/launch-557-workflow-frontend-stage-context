import { formatUnits, getAddress } from 'viem'

/** UTF-8 byte length, which is what the contract measures. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function groupInteger(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Format a raw token amount in display units: grouped integer part, fraction
 * truncated (never rounded up) to `maxFraction` digits, trailing zeros removed.
 */
export function formatAmount(value: bigint, decimals: number, maxFraction = 4): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const units = formatUnits(abs, decimals)
  const [integer, fraction = ''] = units.split('.')
  const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, '')
  let out = groupInteger(integer)
  if (trimmed) out += `.${trimmed}`
  if (out === '0' && abs > 0n) out = `<0.${'0'.repeat(Math.max(0, maxFraction - 1))}1`
  return negative ? `-${out}` : out
}

export function formatTokenAmount(value: bigint, decimals: number, symbol: string, maxFraction = 4): string {
  return `${formatAmount(value, decimals, maxFraction)} ${symbol}`
}

export function shortAddress(address: string): string {
  const checksummed = safeChecksum(address)
  return `${checksummed.slice(0, 6)}…${checksummed.slice(-4)}`
}

export function safeChecksum(address: string): string {
  try {
    return getAddress(address)
  } catch {
    return address
  }
}

export function formatTimestamp(seconds: bigint | number): string {
  const ms = Number(seconds) * 1000
  if (!Number.isFinite(ms)) return 'unknown time'
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

/** Parse a decimal string typed by the visitor into raw units. Returns null when invalid. */
export function parseDecimalAmount(text: string, decimals: number): bigint | null {
  const cleaned = text.trim().replace(/,/g, '')
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '.') return null
  const [integer = '0', fraction = ''] = cleaned.split('.')
  if (fraction.length > decimals) return null
  const raw = BigInt(integer || '0') * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
  return raw
}

export function pluralize(count: number | bigint, singular: string, plural: string): string {
  const n = typeof count === 'bigint' ? count : BigInt(Math.trunc(count))
  return `${groupInteger(n.toString())} ${n === 1n ? singular : plural}`
}
