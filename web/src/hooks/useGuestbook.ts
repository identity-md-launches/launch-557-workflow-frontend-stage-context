import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { useConfig, useReadContract } from 'wagmi'
import { readContract } from 'wagmi/actions'
import { type FriendlyError, translateError } from '../lib/errors'
import { useDeployment } from './deployment'

export const ENTRY_COUNT_POLL_MS = 5_000
/** Slower cadence while the RPC is unreachable, so a dead network does not spin. */
export const ERROR_POLL_MS = 30_000
const MAX_PAGE = 50n

export function pollInterval(normal: number) {
  return (query: { state: { status: string } }) => (query.state.status === 'error' ? ERROR_POLL_MS : normal)
}

export interface GuestbookEntry {
  id: bigint
  signer: Address
  timestamp: bigint
  message: string
  unreadable?: boolean
}

interface RawEntry {
  signer: Address
  timestamp: bigint
  message: string
}

export function useGuestbookConstants() {
  const { guestbook } = useDeployment()
  const base = { address: guestbook.address, abi: guestbook.abi } as const
  const cost = useReadContract({ ...base, functionName: 'SIGNING_COST', query: { staleTime: Infinity } })
  const maxBytes = useReadContract({ ...base, functionName: 'MAX_MESSAGE_BYTES', query: { staleTime: Infinity } })
  return {
    signingCost: cost.data as bigint | undefined,
    maxMessageBytes: maxBytes.data !== undefined ? Number(maxBytes.data as bigint) : undefined,
  }
}

export function useEntryCount() {
  const { guestbook } = useDeployment()
  const query = useReadContract({
    address: guestbook.address,
    abi: guestbook.abi,
    functionName: 'entryCount',
    query: { refetchInterval: pollInterval(ENTRY_COUNT_POLL_MS) },
  })
  return {
    count: query.data as bigint | undefined,
    error: query.error,
    isLoading: query.isLoading,
    /** True once at least one read succeeded and the latest one did too. */
    live: query.status === 'success' && !query.isError,
    refetch: query.refetch,
  }
}

/**
 * Newest-first feed over `getEntries(beforeId, limit)`. New signatures are
 * prepended when `entryCount()` grows; older pages are appended on demand.
 * A page that fails to decode falls back to `getEntry(id)` per entry so one
 * malformed message cannot break the whole feed.
 */
export function useEntries(pageSize = 20) {
  const config = useConfig()
  const { guestbook } = useDeployment()
  const { count, error: countError, isLoading: countLoading } = useEntryCount()
  const [entries, setEntries] = useState<GuestbookEntry[]>([])
  const [cursor, setCursor] = useState<bigint | null>(null)
  const [head, setHead] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  const busy = useRef(false)

  const readPage = useCallback(
    async (beforeId: bigint, limit: bigint): Promise<GuestbookEntry[]> => {
      const base = { address: guestbook.address, abi: guestbook.abi } as const
      try {
        const [raw] = (await readContract(config, { ...base, functionName: 'getEntries', args: [beforeId, limit] })) as [
          RawEntry[],
          bigint,
        ]
        return raw.map((entry, i) => ({ id: beforeId - 1n - BigInt(i), signer: entry.signer, timestamp: entry.timestamp, message: entry.message }))
      } catch (pageError) {
        const size = beforeId < limit ? beforeId : limit
        const out: GuestbookEntry[] = []
        for (let i = 0n; i < size; i += 1n) {
          const id = beforeId - 1n - i
          try {
            const entry = (await readContract(config, { ...base, functionName: 'getEntry', args: [id] })) as RawEntry
            out.push({ id, signer: entry.signer, timestamp: entry.timestamp, message: entry.message })
          } catch {
            out.push({ id, signer: '0x0000000000000000000000000000000000000000', timestamp: 0n, message: '', unreadable: true })
          }
        }
        if (out.every((e) => e.unreadable)) throw pageError
        return out
      }
    },
    [config, guestbook.address, guestbook.abi],
  )

  useEffect(() => {
    if (count === undefined || busy.current) return
    if (head !== null && count <= head) return
    busy.current = true
    setLoading(true)
    setError(null)
    const run = async () => {
      if (head === null) {
        const limit = count < BigInt(pageSize) ? count : BigInt(pageSize)
        const page = limit === 0n ? [] : await readPage(count, limit)
        setEntries(page)
        setCursor(count - BigInt(page.length))
        setHead(count)
        return
      }
      let fresh: GuestbookEntry[] = []
      let before = count
      while (before > head) {
        const remaining = before - head
        const limit = remaining < MAX_PAGE ? remaining : MAX_PAGE
        const page = await readPage(before, limit)
        fresh = fresh.concat(page)
        before -= BigInt(page.length)
        if (page.length === 0) break
      }
      setEntries((current) => fresh.concat(current))
      setHead(count)
    }
    run()
      .catch((e) => setError(translateError(e)))
      .finally(() => {
        busy.current = false
        setLoading(false)
      })
  }, [count, head, pageSize, readPage])

  const loadOlder = useCallback(async () => {
    if (cursor === null || cursor === 0n || busy.current) return
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      const limit = cursor < BigInt(pageSize) ? cursor : BigInt(pageSize)
      const page = await readPage(cursor, limit)
      setEntries((current) => current.concat(page))
      setCursor(cursor - BigInt(page.length))
    } catch (e) {
      setError(translateError(e))
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [cursor, pageSize, readPage])

  return {
    entries,
    count,
    hasOlder: cursor !== null && cursor > 0n,
    loadOlder,
    loading: loading || countLoading,
    error: error ?? (countError ? translateError(countError) : null),
  }
}
