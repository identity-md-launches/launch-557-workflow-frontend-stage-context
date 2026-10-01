import { createContext, useContext, type ReactNode } from 'react'
import type { Deployment } from '../config/deployment'

const DeploymentContext = createContext<Deployment | null>(null)

export function DeploymentProvider({ deployment, children }: { deployment: Deployment; children: ReactNode }) {
  return <DeploymentContext.Provider value={deployment}>{children}</DeploymentContext.Provider>
}

export function useDeployment(): Deployment {
  const value = useContext(DeploymentContext)
  if (!value) throw new Error('useDeployment must be used inside DeploymentProvider')
  return value
}
