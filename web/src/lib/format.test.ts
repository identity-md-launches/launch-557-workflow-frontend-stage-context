import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { formatAmount, parseDecimalAmount, pluralize, shortAddress, utf8ByteLength } from './format'

describe('utf8ByteLength', () => {
  it('counts bytes, not characters', () => {
    expect(utf8ByteLength('')).toBe(0)
    expect(utf8ByteLength('hello')).toBe(5)
    expect(utf8ByteLength('é')).toBe(2)
    expect(utf8ByteLength('😀')).toBe(4)
    expect(utf8ByteLength('😀'.repeat(70))).toBe(280)
    expect(utf8ByteLength('😀'.repeat(71))).toBe(284)
  })
})

describe('formatAmount', () => {
  it('groups digits and truncates fractions', () => {
    expect(formatAmount(10n * 10n ** 18n, 18)).toBe('10')
    expect(formatAmount(1_234_567n * 10n ** 18n, 18)).toBe('1,234,567')
    expect(formatAmount(123_456_789_000_000_000_000n, 18, 4)).toBe('123.4567')
    expect(formatAmount(1n, 18)).toBe('<0.0001')
    expect(formatAmount(0n, 18)).toBe('0')
    expect(formatAmount(15n * 10n ** 17n, 18)).toBe('1.5')
  })
})

describe('parseDecimalAmount', () => {
  it('parses decimal text into raw units', () => {
    expect(parseDecimalAmount('1', 18)).toBe(10n ** 18n)
    expect(parseDecimalAmount('0.5', 18)).toBe(5n * 10n ** 17n)
    expect(parseDecimalAmount('1,000', 18)).toBe(1000n * 10n ** 18n)
    expect(parseDecimalAmount('.25', 2)).toBe(25n)
    expect(parseDecimalAmount('', 18)).toBeNull()
    expect(parseDecimalAmount('abc', 18)).toBeNull()
    expect(parseDecimalAmount('1.123', 2)).toBeNull()
    expect(parseDecimalAmount('-1', 18)).toBeNull()
  })
})

describe('shortAddress and pluralize', () => {
  it('truncates with checksum', () => {
    const checksummed = getAddress('0xfb4ec514a8464a30beccc3b07e2cdd694cbe8e93')
    expect(checksummed).not.toBe('0xfb4ec514a8464a30beccc3b07e2cdd694cbe8e93')
    expect(shortAddress('0xfb4ec514a8464a30beccc3b07e2cdd694cbe8e93')).toBe(`${checksummed.slice(0, 6)}…${checksummed.slice(-4)}`)
    expect(shortAddress('not an address')).toBe('not an…ress')
  })
  it('pluralizes counts', () => {
    expect(pluralize(0n, 'signature', 'signatures')).toBe('0 signatures')
    expect(pluralize(1n, 'signature', 'signatures')).toBe('1 signature')
    expect(pluralize(1234n, 'signature', 'signatures')).toBe('1,234 signatures')
  })
})
