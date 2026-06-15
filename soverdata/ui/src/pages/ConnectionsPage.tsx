import { useState, useEffect } from 'react'
import { connApi, Connection } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

const CONNECTION_TYPES = ['csv', 'parquet', 'delta', 'duckdb', 'postgres', 'mysql', 'mssql', 'rest']

export default function ConnectionsPage() {
  const { workspace } = useWorkspace()
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { status: string; message: string }>>({})

  const load = async () => {
    if (!workspace) return
    setLoading(true)
    try {
      setConnections(await connApi.list())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspace])

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete connection "${name}"?`)) return
    try {
      await connApi.delete(name)
      await load()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const handleTest = async (name: string) => {
    try {
      const result = await connApi.test(name)
      setTestResult(prev => ({ ...prev, [name]: result }))
    } catch (e) {
      setTestResult(prev => ({ ...prev, [name]: { status: 'error', message: errMsg(e) } }))
    }
  }

  if (!workspace) {
    return <NoWorkspace />
  }

  return (
    <div>
      <div className="page-header">
        <h1>Connections</h1>
        <p>Define data sources — CSV files, databases, REST APIs, and more.</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
            + Add Connection
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Loading...</div>
        ) : connections.length === 0 ? (
          <div className="empty-state">
            <h3>No connections yet</h3>
            <p>Add a connection to start pulling data into your lakehouse.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Test</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {connections.map(conn => (
                  <tr key={conn.name}>
                    <td><strong>{conn.name}</strong></td>
                    <td><span className="tag">{conn.type}</span></td>
                    <td style={{ color: 'var(--text-muted)' }}>{conn.description || '—'}</td>
                    <td>
                      {testResult[conn.name] && (
                        <span className={`badge badge-${testResult[conn.name].status === 'ok' ? 'success' : 'failed'}`}
                          title={testResult[conn.name].message}>
                          {testResult[conn.name].status}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleTest(conn.name)}>Test</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(conn); setShowModal(true) }}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(conn.name)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showModal && (
          <ConnectionModal
            initial={editing}
            onClose={() => setShowModal(false)}
            onSaved={() => { setShowModal(false); load() }}
          />
        )}
      </div>
    </div>
  )
}

function ConnectionModal({ initial, onClose, onSaved }: {
  initial: Connection | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState(initial?.type ?? 'csv')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [configStr, setConfigStr] = useState(initial ? JSON.stringify(initial.config, null, 2) : '{}')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const configPlaceholder = type === 'csv' ? '{"path": "data/sales.csv"}'
    : type === 'postgres' ? '{"connection_string": "postgresql://user:pass@host/db"}'
    : type === 'rest' ? '{"base_url": "https://api.example.com", "headers": {}}'
    : '{}'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    let config: Record<string, unknown>
    try {
      config = JSON.parse(configStr)
    } catch {
      setError('Config is not valid JSON')
      return
    }
    setLoading(true)
    try {
      const data = { name, type, description, config }
      if (initial) {
        await connApi.update(initial.name, data)
      } else {
        await connApi.create(data)
      }
      onSaved()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{initial ? 'Edit' : 'Add'} Connection</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} required placeholder="my_connection" disabled={!!initial} />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={type} onChange={e => setType(e.target.value)}>
                {CONNECTION_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
          </div>
          <div className="form-group">
            <label>Config (JSON)</label>
            <textarea
              rows={6}
              value={configStr}
              onChange={e => setConfigStr(e.target.value)}
              placeholder={configPlaceholder}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : (initial ? 'Save' : 'Add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function NoWorkspace() {
  return (
    <div>
      <div className="page-header"><h1>Connections</h1></div>
      <div className="page-body">
        <div className="alert alert-info">Open a workspace first to manage connections.</div>
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
