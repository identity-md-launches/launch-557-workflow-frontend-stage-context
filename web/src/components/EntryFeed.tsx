import { useAccount } from 'wagmi'
import { type GuestbookEntry, useEntries } from '../hooks/useGuestbook'
import { formatTimestamp, pluralize } from '../lib/format'
import { AddressLink } from './AddressLink'
import { Notice } from './Notice'

function Entry({ entry, isMine }: { entry: GuestbookEntry; isMine: boolean }) {
  return (
    <li className="entry" id={`entry-${entry.id.toString()}`}>
      <div className="entry__meta">
        <span className="entry__id num">#{entry.id.toString()}</span>
        {entry.unreadable ? (
          <span className="entry__signer">unreadable entry</span>
        ) : (
          <span className="entry__signer">
            <AddressLink address={entry.signer} />
            {isMine ? <span className="tag">you</span> : null}
          </span>
        )}
        {!entry.unreadable ? (
          <time className="entry__time" dateTime={new Date(Number(entry.timestamp) * 1000).toISOString()}>
            {formatTimestamp(entry.timestamp)}
          </time>
        ) : null}
      </div>
      {entry.unreadable ? (
        <p className="entry__message entry__message--empty">This entry could not be decoded from the chain.</p>
      ) : entry.message.length === 0 ? (
        <p className="entry__message entry__message--empty">(empty message)</p>
      ) : (
        <p className="entry__message">{entry.message}</p>
      )}
    </li>
  )
}

/** Newest-first feed of signatures. Messages are rendered as text, never as markup. */
export function EntryFeed() {
  const { address } = useAccount()
  const { entries, count, hasOlder, loadOlder, loading, error } = useEntries(20)

  return (
    <section className="card card--feed" aria-labelledby="entries-title">
      <div className="card__header">
        <h2 id="entries-title" className="card__title">
          Entries
        </h2>
        <p className="card__count num" role="status">
          {count !== undefined ? pluralize(count, 'signature', 'signatures') : error ? 'Count unavailable' : 'Loading count…'}
        </p>
      </div>

      {error ? (
        <Notice tone="error" title={error.title}>
          {error.detail}
        </Notice>
      ) : null}

      {count === 0n ? (
        <div className="empty">
          <p className="empty__title">No signatures yet</p>
          <p className="empty__body">The guestbook is empty. Connect a wallet and be the first to sign.</p>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <ol className="entries" aria-label="Guestbook entries, newest first">
          {entries.map((entry) => (
            <Entry key={entry.id.toString()} entry={entry} isMine={Boolean(address && entry.signer.toLowerCase() === address.toLowerCase())} />
          ))}
        </ol>
      ) : null}

      {count !== undefined && count > 0n && entries.length === 0 && loading ? <p className="hint">Loading entries…</p> : null}

      {hasOlder ? (
        <div className="actions">
          <button type="button" className="btn btn--secondary" disabled={loading} onClick={() => loadOlder()}>
            {loading ? 'Loading…' : 'Load older entries'}
          </button>
        </div>
      ) : null}
    </section>
  )
}
