import { useState, useEffect } from 'react'
import { branchApi, BranchInfo } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

export default function BranchesPage() {
  const { workspace } = useWorkspace()
  const [info, setInfo] = useState<BranchInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    if (!workspace) return
    setLoading(true)
    try {
      setInfo(await branchApi.list())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspace])

  const handleInitGit = async () => {
    try {
      await branchApi.init()
      setMessage('Git repository initialized in workspace.')
      await load()
    } catch (e) { setError(errMsg(e)) }
  }

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBranch.trim()) return
    try {
      await branchApi.create(newBranch.trim())
      setMessage(`Branch "${newBranch}" created.`)
      setNewBranch('')
      await load()
    } catch (e) { setError(errMsg(e)) }
  }

  const handleCheckout = async (name: string) => {
    try {
      await branchApi.checkout(name)
      setMessage(`Switched to branch "${name}".`)
      await load()
    } catch (e) { setError(errMsg(e)) }
  }

  if (!workspace) return (
    <div>
      <div className="page-header"><h1>Branches</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <h1>Branches</h1>
        <p>Git branch management for the workspace. Pipelines, SQL, and config are all versioned.</p>
      </div>
      <div className="page-body">
        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
        ) : info && !info.git_available ? (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Workspace is not a git repository</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 13 }}>
              Initialize git to enable branch-based workflows.
            </p>
            <button className="btn btn-primary" onClick={handleInitGit}>
              Initialize git repository
            </button>
            {info.error && <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 12 }}>{info.error}</div>}
          </div>
        ) : info ? (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <strong>Current branch: </strong>
                {info.current
                  ? <span className="badge badge-success" style={{ marginLeft: 6 }}>{info.current}</span>
                  : <span className="tag">detached HEAD</span>}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {info.branches.map(b => (
                  <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={b === info.current ? 'badge badge-success' : 'badge badge-running'}>{b}</span>
                    {b !== info.current && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleCheckout(b)}>
                        Checkout
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>Create new branch</h3>
              <form onSubmit={handleCreateBranch} style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text"
                  placeholder="feature/my-pipeline"
                  value={newBranch}
                  onChange={e => setNewBranch(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btn-primary">Create</button>
              </form>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'Error'
  }
  return String(e)
}
