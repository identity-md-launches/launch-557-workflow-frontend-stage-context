import { ContractsSection } from './components/ContractsSection'
import { EntryFeed } from './components/EntryFeed'
import { Header } from './components/Header'
import { NetworkBanner } from './components/NetworkBanner'
import { SignForm } from './components/SignForm'
import { SwapPanel } from './components/SwapPanel'
import { TokenPanel } from './components/TokenPanel'
import { useDeployment } from './hooks/deployment'
import { useTokenMetadata } from './hooks/useToken'

export function App() {
  const deployment = useDeployment()
  const { symbol } = useTokenMetadata()
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" className="page">
        <section className="intro" aria-labelledby="intro-title">
          <h1 id="intro-title">An onchain guestbook paid in {symbol}</h1>
          <p className="intro__lead">
            Every signature burns 10 {symbol} and stores a message of at most 280 bytes on {deployment.network?.name ?? 'the chain'}
            . Entries are public, permanent and listed newest first.
          </p>
        </section>
        <NetworkBanner />
        {/* DOM order is the mobile reading order: sign, read, then get and manage tokens.
            On wide screens the feed moves to a second column via grid areas. */}
        <div className="layout">
          <div className="layout__sign">
            <SignForm />
          </div>
          <div className="layout__feed">
            <EntryFeed />
          </div>
          <div className="layout__swap">
            <SwapPanel />
          </div>
          <div className="layout__token">
            <TokenPanel />
          </div>
        </div>
        <ContractsSection />
      </main>
      <footer className="app-footer">
        <p>
          Static site: it talks to the chain through public RPC endpoints and your wallet. No server, no tracking, no custody.
        </p>
      </footer>
    </>
  )
}
