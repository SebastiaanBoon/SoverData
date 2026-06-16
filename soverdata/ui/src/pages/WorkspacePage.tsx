import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { WorkspaceListItem, wsApi } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'
import api from '../api/client'

interface Stats {
  tables: number
  tables_by_layer: Record<string, number>
  pipelines: number
  connections: number
  runs: number
  last_run: { pipeline: string; status: string; started_at: string } | null
}

const WORKFLOW = [
  { to: '/catalog', label: 'Check data', desc: 'Browse Bronze, Silver, and Gold tables.', stat: 'tables' },
  { to: '/pipelines', label: 'Create activities', desc: 'Load Bronze, clean Silver, publish Gold.', stat: 'pipelines' },
  { to: '/orchestrations', label: 'Build flow', desc: 'Choose Bronze, Silver, Gold and retries.', stat: null },
  { to: '/runs', label: 'Monitor runs', desc: 'See successes, failures, and logs.', stat: 'runs' },
]

export default function WorkspacePage() {
  const { workspace, refresh } = useWorkspace()
  const [mode, setMode] = useState<'open' | 'create' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [workspaceList, setWorkspaceList] = useState<WorkspaceListItem[]>([])
  const [listRoot, setListRoot] = useState('')
  const [listLoading, setListLoading] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    if (!workspace) {
      setStats(null)
      return
    }
    api.get<Stats>('/stats').then(r => setStats(r.data)).catch(() => setStats(null))
  }, [workspace])

  useEffect(() => {
    if (mode !== 'open') {
      setWorkspaceList([])
      setError('')
      return
    }
    setListLoading(true)
    wsApi.list()
      .then(data => { setWorkspaceList(data.workspaces); setListRoot(data.root) })
      .catch(() => setWorkspaceList([]))
      .finally(() => setListLoading(false))
  }, [mode])

  const handleOpen = async (path: string) => {
    setLoading(true); setError('')
    try { await wsApi.open(path); await refresh(); setMode(null) }
    catch (err) { setError(errMsg(err)) }
    finally { setLoading(false) }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('')
    try { await wsApi.create(name, description); await refresh(); setMode(null) }
    catch (err) { setError(errMsg(err)) }
    finally { setLoading(false) }
  }

  const handleClose = async () => {
    await wsApi.close()
    await refresh()
    setStats(null)
  }

  const statVal = (key: string | null): string => {
    if (!stats || !key) return ''
    const v = (stats as Record<string, unknown>)[key]
    return v != null ? String(v) : ''
  }

  return (
    <div>
      <div className="page-header">
        <h1>Home</h1>
        <p>One workspace, one lakehouse, one clear Bronze to Silver to Gold workflow.</p>
      </div>
      <div className="page-body">
        {workspace ? (
          <>
            <div className="home-hero">
              <div>
                <div className="home-kicker">Current workspace</div>
                <h2>{workspace.name}</h2>
                {workspace.description && <p>{workspace.description}</p>}
                <div className="home-tags">
                  <span className="tag">Format v{workspace.format_version}</span>
                  <span className="tag" title={workspace.path}>{workspace.path}</span>
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={handleClose}>Close</button>
            </div>

            {stats && (
              <div className="home-stats">
                <Stat label="Tables" value={stats.tables} detail={Object.entries(stats.tables_by_layer).map(([l, c]) => `${l}: ${c}`).join(' / ')} />
                <Stat label="Activities" value={stats.pipelines} />
                <Stat label="Runs" value={stats.runs} detail={stats.last_run ? `Last: ${stats.last_run.pipeline} (${stats.last_run.status})` : 'No runs yet'} />
              </div>
            )}

            <div className="home-flow">
              {WORKFLOW.map((item, index) => (
                <NavLink key={item.to} to={item.to} className="home-step">
                  <span className="home-step-number">{index + 1}</span>
                  <span className="home-step-copy">
                    <strong>{item.label}</strong>
                    <span>{item.desc}</span>
                  </span>
                  {item.stat && statVal(item.stat) && <span className="home-step-stat">{statVal(item.stat)}</span>}
                </NavLink>
              ))}
            </div>
          </>
        ) : (
          <div className="home-empty">
            <h2>Open a workspace to start</h2>
            <p>Create one folder for the data, activities, flows, and run history.</p>
            <div>
              <button className="btn btn-primary" onClick={() => setMode('open')}>Open Workspace</button>
              <button className="btn btn-secondary" onClick={() => { setMode('create'); setName(''); setDescription('') }}>New Workspace</button>
            </div>
          </div>
        )}

        {mode === 'open' && (
          <div className="modal-overlay" onClick={() => setMode(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2>Open Workspace</h2>
              {error && <div className="alert alert-error">{error}</div>}
              {listRoot && <p className="modal-note">Workspaces in {listRoot}</p>}
              {listLoading && <div className="empty-state">Loading...</div>}
              {!listLoading && workspaceList.length === 0 && <div className="empty-state">No workspaces yet.</div>}
              {!listLoading && workspaceList.length > 0 && (
                <div className="workspace-scan-list">
                  {workspaceList.map(ws => (
                    <button key={ws.path} type="button" className="workspace-scan-row" onClick={() => handleOpen(ws.path)} disabled={loading}>
                      <div style={{ fontWeight: 600 }}>{ws.name}</div>
                      {ws.description && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ws.description}</div>}
                    </button>
                  ))}
                </div>
              )}
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <div className="modal-overlay" onClick={() => setMode(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2>New Workspace</h2>
              {error && <div className="alert alert-error">{error}</div>}
              <form onSubmit={handleCreate}>
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" placeholder="Finance lakehouse" value={name} onChange={e => setName(e.target.value)} required autoFocus />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input type="text" placeholder="Optional" value={description} onChange={e => setDescription(e.target.value)} />
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setMode(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
                    {loading ? <span className="spinner" /> : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, detail = '' }: { label: string; value: number; detail?: string }) {
  return (
    <div className="home-stat">
      <strong>{value}</strong>
      <span>{label}</span>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'An error occurred'
  }
  return String(e)
}
