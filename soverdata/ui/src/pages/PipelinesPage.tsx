import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { pipeApi, Pipeline, Run } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

const DEFAULT_PYTHON = `"""
Ingestion pipeline — fetches data and writes to the Bronze lakehouse.
Environment variables available:
  SOVERDATA_WORKSPACE  - path to the workspace folder
  SOVERDATA_LAKEHOUSE  - path to the lakehouse folder
"""
import os
import pandas as pd

workspace = os.environ.get('SOVERDATA_WORKSPACE', '.')
lakehouse = os.environ.get('SOVERDATA_LAKEHOUSE', 'lakehouse')

# Example: create a sample table
df = pd.DataFrame({
    'id': [1, 2, 3],
    'name': ['Alice', 'Bob', 'Charlie'],
    'value': [100, 200, 300],
})

out_path = os.path.join(lakehouse, 'bronze', 'example')
os.makedirs(out_path, exist_ok=True)
df.to_parquet(os.path.join(out_path, 'data.parquet'), index=False)
print(f"Written {len(df)} rows to {out_path}")
`

const DEFAULT_SQL = `-- SQL transform pipeline
-- Add "-- target: silver.table_name" to write results to the lakehouse.
-- Without target, results are logged but not persisted.
--
-- Example:
-- target: silver.my_table
--
-- Available bronze tables: bronze__<name>, silver__<name>, gold__<name>

SELECT *
FROM bronze__example
LIMIT 10;
`

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
    if (!confirm(`Delete pipeline "${name}"?`)) return
    try {
      await pipeApi.delete(type, name)
      await load()
    } catch (e) { setError(errMsg(e)) }
  }

  const handleRun = async (type: string, name: string) => {
    setRunning(`${type}/${name}`)
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

  if (!workspace) return <NoWorkspace />

  return (
    <div>
      <div className="page-header">
        <h1>Pipelines</h1>
        <p>Python ingestion scripts and SQL transforms.</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowModal(true) }}>
            + New Pipeline
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Loading...</div>
        ) : pipelines.length === 0 ? (
          <div className="empty-state">
            <h3>No pipelines yet</h3>
            <p>Create a Python or SQL pipeline to start loading data.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Modified</th>
                  <th>Last Run</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pipelines.map(p => {
                  const key = `${p.type}/${p.name}`
                  const run = runResult[key]
                  const isRunning = running === key
                  return (
                    <tr key={key}>
                      <td><strong>{p.name}</strong></td>
                      <td><span className={`badge badge-${p.type}`}>{p.type}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {p.modified ? new Date(p.modified).toLocaleString() : '—'}
                      </td>
                      <td>
                        {run && (
                          <span className={`badge badge-${run.status}`}>{run.status}</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => handleRun(p.type, p.name)}
                            disabled={isRunning}
                          >
                            {isRunning ? <span className="spinner" /> : '▶ Run'}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(p)}>Edit</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.type, p.name)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {showModal && (
          <PipelineModal
            initial={editing}
            onClose={() => { setShowModal(false); setEditing(null) }}
            onSaved={() => { setShowModal(false); setEditing(null); load() }}
          />
        )}
      </div>
    </div>
  )
}

function PipelineModal({ initial, onClose, onSaved }: {
  initial: Pipeline | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<'python' | 'sql'>(initial?.type ?? 'python')
  const [code, setCode] = useState(initial?.code ?? (type === 'python' ? DEFAULT_PYTHON : DEFAULT_SQL))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleTypeChange = (t: 'python' | 'sql') => {
    setType(t)
    if (!initial) setCode(t === 'python' ? DEFAULT_PYTHON : DEFAULT_SQL)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
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
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 800, width: '90vw' }} onClick={e => e.stopPropagation()}>
        <h2>{initial ? 'Edit' : 'New'} Pipeline</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} required placeholder="ingest_sales" disabled={!!initial} />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={type} onChange={e => handleTypeChange(e.target.value as 'python' | 'sql')} disabled={!!initial}>
                <option value="python">Python</option>
                <option value="sql">SQL</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Code</label>
            <div className="editor-wrap">
              <Editor
                height="360px"
                language={type === 'python' ? 'python' : 'sql'}
                value={code}
                onChange={val => setCode(val ?? '')}
                theme="vs-dark"
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                }}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : (initial ? 'Save' : 'Create')}
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
      <div className="page-header"><h1>Pipelines</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
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
