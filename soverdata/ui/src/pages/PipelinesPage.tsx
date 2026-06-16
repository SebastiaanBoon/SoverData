import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { pipeApi, connApi, queryApi, Pipeline, Run, Connection, QueryResult } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

// ── Default templates ─────────────────────────────────────────────

const DEFAULT_PYTHON = `"""
Activity — fetches data and writes to the Bronze lakehouse.
Available env vars:
  SOVERDATA_WORKSPACE  - workspace folder path
  SOVERDATA_LAKEHOUSE  - lakehouse folder path
"""
import os
import pandas as pd
from server.engine.lakehouse import write_table

workspace = os.environ.get('SOVERDATA_WORKSPACE', '.')
lakehouse = os.environ.get('SOVERDATA_LAKEHOUSE', 'lakehouse')

df = pd.DataFrame({
    'id': [1, 2, 3],
    'name': ['Alice', 'Bob', 'Charlie'],
    'value': [100, 200, 300],
})

out_file = write_table(df, lakehouse, 'bronze', 'example')
print(f"Written {len(df)} rows to {out_file}")
`

const DEFAULT_SQL = `-- SQL activity
-- Optional: write results to lakehouse with "-- target: silver.table_name"
-- Add an external connection from Flow when this SQL should run outside the lakehouse.
-- Available lakehouse tables: bronze.<name>, silver.<name>, gold.<name>

SELECT
    id,
    name,
    value
FROM bronze.example
LIMIT 10;
`

// ── Directive helpers ─────────────────────────────────────────────

function expandSelectStar(code: string, columns: string[]): string {
  if (!columns.length) return code
  const colList = '\n    ' + columns.join(',\n    ') + '\n'
  return code.replace(/SELECT\s+\*/gi, `SELECT${colList}`)
}

function hasSelectStar(code: string): boolean {
  return /SELECT\s+\*/i.test(code)
}

function getDirective(code: string, key: string): string {
  const m = code.match(new RegExp(`^\\s*--\\s*${key}\\s*:\\s*([^\\n]+)\\s*$`, 'im'))
  return m ? m[1].trim() : ''
}

function setDirective(code: string, key: string, value: string): string {
  const regex = new RegExp(`^\\s*--\\s*${key}\\s*:[^\\n]*\\n?`, 'gim')
  const line = value ? `-- ${key}: ${value}\n` : ''
  if (regex.test(code)) {
    return value ? code.replace(regex, line) : code.replace(regex, '')
  }
  return value ? `-- ${key}: ${value}\n${code}` : code
}

// ── Page ──────────────────────────────────────────────────────────

export default function PipelinesPage() {
  const { workspace } = useWorkspace()
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Pipeline | null>(null)
  const [runResult, setRunResult] = useState<Record<string, Run>>({})
  const [running, setRunning] = useState<string | null>(null)

  const load = async () => {
    if (!workspace) return
    setLoading(true)
    try {
      setPipelines(await pipeApi.list())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspace])

  const handleDelete = async (type: string, name: string) => {
    if (!confirm(`Delete activity "${name}"?`)) return
    try {
      await pipeApi.delete(type, name)
      await load()
    } catch (e) { setError(errMsg(e)) }
  }

  const handleRun = async (type: string, name: string) => {
    setRunning(`${type}/${name}`)
    setError('')
    try {
      const result = await pipeApi.run(type, name)
      setRunResult(prev => ({ ...prev, [`${type}/${name}`]: result }))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setRunning(null)
    }
  }

  const handleEdit = async (p: Pipeline) => {
    try {
      const full = await pipeApi.get(p.type, p.name)
      setEditing(full)
      setShowModal(true)
    } catch (e) { setError(errMsg(e)) }
  }

  if (!workspace) return (
    <div>
      <div className="page-header"><h1>Activities</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
    </div>
  )

  const pythonPipes = pipelines.filter(p => p.type === 'python')
  const sqlPipes = pipelines.filter(p => p.type === 'sql')

  return (
    <div>
      <div className="page-header">
        <h1>Activities</h1>
        <p>Python scripts and SQL transforms that load and process data.</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
            + New Activity
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Loading…</div>
        ) : pipelines.length === 0 ? (
          <div className="empty-state">
            <h3>No activities yet</h3>
            <p>Create a Python or SQL activity to start loading and transforming data.</p>
          </div>
        ) : (
          <>
            {pythonPipes.length > 0 && (
              <ActivityTable
                label="Python"
                items={pythonPipes}
                runResult={runResult}
                running={running}
                onRun={handleRun}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            )}
            {sqlPipes.length > 0 && (
              <ActivityTable
                label="SQL"
                items={sqlPipes}
                runResult={runResult}
                running={running}
                onRun={handleRun}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            )}
          </>
        )}

        {showModal && (
          <ActivityModal
            initial={editing}
            onClose={() => { setShowModal(false); setEditing(null) }}
            onSaved={() => { setShowModal(false); setEditing(null); load() }}
          />
        )}
      </div>
    </div>
  )
}

// ── Activity table ────────────────────────────────────────────────

function ActivityTable({ label, items, runResult, running, onRun, onEdit, onDelete }: {
  label: string
  items: Pipeline[]
  runResult: Record<string, Run>
  running: string | null
  onRun: (type: string, name: string) => void
  onEdit: (p: Pipeline) => void
  onDelete: (type: string, name: string) => void
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
        {label}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Modified</th>
              <th>Last run</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(p => {
              const key = `${p.type}/${p.name}`
              const run = runResult[key]
              const isRunning = running === key
              return (
                <tr key={key}>
                  <td><strong>{p.name}</strong></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {p.modified ? new Date(p.modified).toLocaleString() : '—'}
                  </td>
                  <td>
                    {run && <span className={`badge badge-${run.status}`}>{run.status}</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => onRun(p.type, p.name)}
                        disabled={!!running}
                      >
                        {isRunning ? <span className="spinner" /> : '▶ Run'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onEdit(p)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => onDelete(p.type, p.name)}>Delete</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Activity modal ────────────────────────────────────────────────

function ActivityModal({ initial, onClose, onSaved }: {
  initial: Pipeline | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<'python' | 'sql'>(initial?.type ?? 'python')
  const [code, setCode] = useState(initial?.code ?? DEFAULT_PYTHON)
  const [connections, setConnections] = useState<Connection[]>([])
  const [selectedConn, setSelectedConn] = useState('')
  const [testResult, setTestResult] = useState<QueryResult | null>(null)
  const [testError, setTestError] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Load connections for the SQL picker
  useEffect(() => {
    connApi.list().then(setConnections).catch(() => {})
  }, [])

  // When the modal opens for an existing SQL activity, read the connection directive
  useEffect(() => {
    if (initial?.type === 'sql' && initial.code) {
      setCode(initial.code)
      setSelectedConn(getDirective(initial.code, 'connection'))
    } else if (!initial) {
      setCode(type === 'python' ? DEFAULT_PYTHON : DEFAULT_SQL)
    }
  }, [initial])

  const handleTypeChange = (t: 'python' | 'sql') => {
    setType(t)
    if (!initial) {
      setCode(t === 'python' ? DEFAULT_PYTHON : DEFAULT_SQL)
      setSelectedConn('')
      setTestResult(null)
    }
  }

  const handleConnChange = (conn: string) => {
    setSelectedConn(conn)
    setCode(prev => setDirective(prev, 'connection', conn))
    setTestResult(null)
    setTestError('')
  }

  const handleTest = useCallback(async () => {
    setTesting(true); setTestResult(null); setTestError('')
    try {
      let result: QueryResult
      if (selectedConn) {
        result = await connApi.query(selectedConn, code, 50)
      } else {
        result = await queryApi.execute(code, 50)
      }
      setTestResult(result)
    } catch (e) {
      setTestError(errMsg(e))
    } finally {
      setTesting(false)
    }
  }, [code, selectedConn])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    if (type === 'sql' && hasSelectStar(code)) { setError('Name the columns in SQL. SELECT * is not allowed.'); return }
    setError(''); setSaving(true)
    try {
      if (initial) {
        await pipeApi.update(initial.type, initial.name, { name, type, code })
      } else {
        await pipeApi.create({ name, type, code })
      }
      onSaved()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const dbConnections = connections.filter(c => ['postgres', 'mysql', 'mssql', 'duckdb'].includes(c.type))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
        <h2>{initial ? 'Edit' : 'New'} Activity</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          {/* Name + Type row */}
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="ingest_sales"
                disabled={!!initial}
              />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={type} onChange={e => handleTypeChange(e.target.value as 'python' | 'sql')} disabled={!!initial}>
                <option value="python">Python</option>
                <option value="sql">SQL</option>
              </select>
            </div>
            {type === 'sql' && (
              <div className="form-group">
                <label>External connection</label>
                <select value={selectedConn} onChange={e => handleConnChange(e.target.value)}>
                  <option value="">Lakehouse (DuckDB)</option>
                  {dbConnections.map(c => (
                    <option key={c.name} value={c.name}>{c.name} ({c.type})</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Code editor */}
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ margin: 0 }}>Code</label>
              {type === 'sql' && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleTest} disabled={testing}>
                  {testing ? <><span className="spinner" /> Running…</> : '▶ Test query'}
                </button>
              )}
            </div>
            <div className="editor-wrap">
              <Editor
                height="320px"
                language={type === 'python' ? 'python' : 'sql'}
                value={code}
                onChange={val => { setCode(val ?? ''); setTestResult(null) }}
                theme="vs-dark"
                options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, lineNumbers: 'on', wordWrap: 'on' }}
              />
            </div>
          </div>

          {/* Test results */}
          {testError && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>{testError}</div>
          )}
          {testResult && (
            <div className="act-test-result">
              <div className="act-test-result-head">
                <span className="badge badge-success">✓ Query OK</span>
                <span className="act-test-rows">
                  {testResult.row_count} row{testResult.row_count !== 1 ? 's' : ''} · {testResult.columns.length} column{testResult.columns.length !== 1 ? 's' : ''}
                </span>
                {testResult.columns.length > 0 && hasSelectStar(code) && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    title="Replace SELECT * with the actual column names"
                    onClick={() => setCode(prev => expandSelectStar(prev, testResult.columns))}
                  >
                    ↔ Name columns
                  </button>
                )}
              </div>
              {testResult.columns.length > 0 && (
                <div className="act-test-table-wrap">
                  <table>
                    <thead>
                      <tr>{testResult.columns.map(c => <th key={c}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {testResult.rows.slice(0, 50).map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j} className="act-test-cell">
                              {cell === null
                                ? <span className="act-null">null</span>
                                : typeof cell === 'number'
                                  ? <span className="act-num">{String(cell)}</span>
                                  : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner" /> : (initial ? 'Save' : 'Create')}
            </button>
          </div>
        </form>
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
