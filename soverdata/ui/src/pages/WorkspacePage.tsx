import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { lakehouseApi, LakehouseRetentionSettings, WorkspaceListItem, wsApi } from '../api/client'
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

const NAV_SECTIONS = [
  { to: '/files', label: 'Files', icon: '[]', desc: 'Workspace file browser', stat: null },
  { to: '/connections', label: 'Connections', icon: '⚡', desc: 'Data source definitions', stat: 'connections' },
  { to: '/pipelines', label: 'Pipelines', icon: '▶', desc: 'Python & SQL scripts', stat: 'pipelines' },
  { to: '/orchestrations', label: 'Orchestrations', icon: '>>', desc: 'Ordered pipeline runs', stat: null },
  { to: '/packages', label: 'Packages', icon: '+', desc: 'Python dependencies', stat: null },
  { to: '/runs', label: 'Runs', icon: '◎', desc: 'Execution history', stat: 'runs' },
  { to: '/catalog', label: 'Catalog', icon: '◫', desc: 'Bronze / Silver / Gold tables', stat: 'tables' },
  { to: '/query', label: 'SQL Query', icon: '≡', desc: 'Ad-hoc SQL editor', stat: null },
  { to: '/branches', label: 'Branches', icon: '⎇', desc: 'Git branch management', stat: null },
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
  const [retention, setRetention] = useState<LakehouseRetentionSettings | null>(null)
  const [retentionMessage, setRetentionMessage] = useState('')

  useEffect(() => {
    if (workspace) {
      api.get<Stats>('/stats').then(r => setStats(r.data)).catch(() => setStats(null))
      lakehouseApi.retention().then(setRetention).catch(() => setRetention(null))
    } else {
      setStats(null)
      setRetention(null)
    }
  }, [workspace])

  useEffect(() => {
    if (mode === 'open') {
      setListLoading(true)
      wsApi.list()
        .then(data => { setWorkspaceList(data.workspaces); setListRoot(data.root) })
        .catch(() => setWorkspaceList([]))
        .finally(() => setListLoading(false))
    }
    if (!mode) {
      setWorkspaceList([])
      setError('')
    }
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
    await wsApi.close(); await refresh(); setStats(null); setRetention(null)
  }

  const saveRetention = async () => {
    if (!retention) return
    try {
      const saved = await lakehouseApi.saveRetention(retention)
      setRetention(saved)
      setRetentionMessage('Retention settings saved.')
    } catch (err) { setError(errMsg(err)) }
  }

  const cleanupRetention = async () => {
    try {
      const result = await lakehouseApi.cleanupRetention()
      setRetention(result.settings)
      setRetentionMessage(`Cleanup completed. Deleted ${result.deleted_files} files.`)
    } catch (err) { setError(errMsg(err)) }
  }

  const statVal = (key: string | null): string => {
    if (!stats || !key) return ''
    const v = (stats as Record<string, unknown>)[key]
    return v != null ? String(v) : ''
  }

  return (
    <div>
      <div className="page-header">
        <h1>Workspace</h1>
        <p>The portable data platform folder — connections, pipelines, and lakehouse tables.</p>
      </div>
      <div className="page-body">
        {workspace ? (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>{workspace.name}</h2>
                  {workspace.description && <p style={{ color: 'var(--text-muted)', marginBottom: 10 }}>{workspace.description}</p>}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span className="tag">Format v{workspace.format_version}</span>
                    <span className="tag" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }} title={workspace.path}>{workspace.path}</span>
                    {workspace.created_at && <span className="tag">Created {new Date(workspace.created_at).toLocaleDateString()}</span>}
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handleClose}>Close</button>
              </div>
            </div>

            {stats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: 10, marginBottom: 20 }}>
                {[
                  { label: 'Tables', value: stats.tables, detail: Object.entries(stats.tables_by_layer).map(([l, c]) => `${l}: ${c}`).join(' · ') },
                  { label: 'Pipelines', value: stats.pipelines, detail: '' },
                  { label: 'Connections', value: stats.connections, detail: '' },
                  { label: 'Runs', value: stats.runs, detail: stats.last_run ? `Last: ${stats.last_run.pipeline} (${stats.last_run.status})` : 'No runs yet' },
                ].map(s => (
                  <div key={s.label} className="card" style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent)', lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{s.label}</div>
                    {s.detail && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.detail}</div>}
                  </div>
                ))}
              </div>
            )}

            {retention && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Lakehouse Retention</h3>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      Bronze run files are append-only. Scheduled cleanup removes old <span style={{ fontFamily: 'var(--font-mono)' }}>part-*.parquet</span> files.
                    </div>
                    {retention.last_cleanup_at && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                        Last cleanup {new Date(retention.last_cleanup_at).toLocaleString()}
                      </div>
                    )}
                    {retentionMessage && <div style={{ color: 'var(--success)', fontSize: 12, marginTop: 6 }}>{retentionMessage}</div>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 110px 130px auto auto', gap: 10, alignItems: 'end' }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)', fontSize: 12, paddingBottom: 8 }}>
                      <input type="checkbox" checked={retention.enabled} onChange={e => setRetention({ ...retention, enabled: e.target.checked })} style={{ width: 'auto' }} />
                      Enabled
                    </label>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Keep Bronze days</label>
                      <input type="number" min={1} value={retention.bronze_days} onChange={e => setRetention({ ...retention, bronze_days: Number(e.target.value) })} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Cleanup interval hours</label>
                      <input type="number" min={1} value={retention.cleanup_interval_hours} onChange={e => setRetention({ ...retention, cleanup_interval_hours: Number(e.target.value) })} />
                    </div>
                    <button className="btn btn-primary" onClick={saveRetention}>Save</button>
                    <button className="btn btn-secondary" onClick={cleanupRetention}>Run cleanup</button>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 14 }}>
              {NAV_SECTIONS.map(item => (
                <NavLink key={item.to} to={item.to} style={{ textDecoration: 'none' }}>
                  <div className="card" style={{ cursor: 'pointer', transition: 'border-color .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                    <div style={{ fontSize: 22, marginBottom: 8 }}>{item.icon}</div>
                    <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{item.label}</span>
                      {item.stat && statVal(item.stat) && (
                        <span style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 700 }}>{statVal(item.stat)}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.desc}</div>
                  </div>
                </NavLink>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h3>No workspace open</h3>
            <p style={{ marginBottom: 24 }}>Open an existing workspace or create a new one to get started.</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => setMode('open')}>Open Workspace</button>
              <button className="btn btn-secondary" onClick={() => { setMode('create'); setName(''); setDescription('') }}>New Workspace</button>
            </div>
          </div>
        )}

        {/* Open modal */}
        {mode === 'open' && (
          <div className="modal-overlay" onClick={() => setMode(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2>Open Workspace</h2>
              {error && <div className="alert alert-error">{error}</div>}
              {listRoot && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Workspaces in <span style={{ fontFamily: 'var(--font-mono)' }}>{listRoot}</span>
                </p>
              )}
              {listLoading && <div style={{ color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>Loading...</div>}
              {!listLoading && workspaceList.length === 0 && (
                <div style={{ color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
                  No workspaces yet — create one to get started.
                </div>
              )}
              {!listLoading && workspaceList.length > 0 && (
                <div className="workspace-scan-list">
                  {workspaceList.map(ws => (
                    <button
                      key={ws.path}
                      type="button"
                      className="workspace-scan-row"
                      onClick={() => handleOpen(ws.path)}
                      disabled={loading}
                    >
                      <div style={{ fontWeight: 600 }}>{ws.name}</div>
                      {ws.description && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ws.description}</div>}
                      {ws.created_at && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Created {new Date(ws.created_at).toLocaleDateString()}</div>}
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

        {/* Create modal */}
        {mode === 'create' && (
          <div className="modal-overlay" onClick={() => setMode(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2>New Workspace</h2>
              {error && <div className="alert alert-error">{error}</div>}
              <form onSubmit={handleCreate}>
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" placeholder="My Data Platform" value={name} onChange={e => setName(e.target.value)} required autoFocus />
                </div>
                <div className="form-group">
                  <label>Description (optional)</label>
                  <input type="text" placeholder="What is this workspace for?" value={description} onChange={e => setDescription(e.target.value)} />
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

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'An error occurred'
  }
  return String(e)
}
