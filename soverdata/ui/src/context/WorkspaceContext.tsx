import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { wsApi, Workspace } from '../api/client'

interface WorkspaceContextValue {
  workspace: Workspace | null
  loading: boolean
  refresh: () => void
  setWorkspace: (ws: Workspace | null) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  loading: true,
  refresh: () => {},
  setWorkspace: () => {},
})

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const ws = await wsApi.get()
      setWorkspace(ws)
    } catch {
      setWorkspace(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  return (
    <WorkspaceContext.Provider value={{ workspace, loading, refresh, setWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  return useContext(WorkspaceContext)
}
