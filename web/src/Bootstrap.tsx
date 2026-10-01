import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { type Config, WagmiProvider } from 'wagmi'
import { App } from './App'
import { DEPLOYMENT_FILE, type Deployment, loadDeployment } from './config/deployment'
import { buildWagmiConfig } from './config/wagmi'
import { DeploymentProvider } from './hooks/deployment'

type LoadState = { status: 'loading' } | { status: 'ready'; deployment: Deployment } | { status: 'error'; message: string }

interface BootstrapProps {
  /** Test seam: supply a deployment and wagmi config instead of fetching. */
  preset?: { deployment: Deployment; config: Config }
}

/** Loads the runtime deployment configuration, then mounts the providers and the app. */
export function Bootstrap({ preset }: BootstrapProps) {
  const [state, setState] = useState<LoadState>(preset ? { status: 'ready', deployment: preset.deployment } : { status: 'loading' })

  useEffect(() => {
    if (preset) return
    let cancelled = false
    loadDeployment()
      .then((deployment) => {
        if (!cancelled) setState({ status: 'ready', deployment })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: 'error', message: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [preset])

  const deployment = state.status === 'ready' ? state.deployment : null
  const config = useMemo(() => (preset ? preset.config : deployment ? buildWagmiConfig(deployment) : null), [preset, deployment])
  // The RPC transport already retries once per endpoint; react-query must not multiply that.
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 0 } } }), [])

  if (state.status === 'loading') {
    return (
      <main className="page page--center" id="main">
        <p role="status">Loading deployment configuration…</p>
      </main>
    )
  }
  if (state.status === 'error' || !deployment || !config) {
    return (
      <main className="page page--center" id="main">
        <div className="notice notice--error" role="alert">
          <span className="notice__icon" aria-hidden="true">
            ✕
          </span>
          <div className="notice__body">
            <p className="notice__title">Unable to load the deployment configuration.</p>
            <p className="notice__detail">
              {state.status === 'error' ? state.message : 'Unknown error.'} The file <code>{DEPLOYMENT_FILE}</code> must sit next to
              this page. Reload to try again.
            </p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <DeploymentProvider deployment={deployment}>
          <App />
        </DeploymentProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
