import { useState, useEffect } from 'react'
import { runsApi, Run } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

export default function RunsPage() {
  const { workspace } = useWorkspace()
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Run | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    if (!workspace) return
    setLoading(true)
    try {
      setRuns(await runsApi.list())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspace])

  const handleSelect = async (run: Run) => {
    try {
      const full = await runsApi.get(run.id)
      setSelected(full)
    } catch (e) { setError(errMsg(e)) }
  }

  if (!workspace) return (
    <div>
      <div className="page-header"><h1>Runs</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <h1>Runs</h1>
        <p>Pipeline execution history and logs.</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={load}>↻ Refresh</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
        ) : runs.length === 0 ? (
          <div className="empty-state">
            <h3>No runs yet</h3>
            <p>Run a pipeline to see execution history here.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pipeline</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Logs</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id}>
                    <td><strong>{run.pipeline}</strong></td>
                    <td><span className={`badge badge-${run.type}`}>{run.type}</span></td>
                    <td><span className={`badge badge-${run.status}`}>{run.status}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {new Date(run.started_at).toLocaleString()}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {run.duration_seconds != null ? `${run.duration_seconds}s` : '—'}
                    </td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleSelect(run)}>
                        View logs
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selected && (
          <div className="modal-overlay" onClick={() => setSelected(null)}>
            <div className="modal" style={{ maxWidth: 740, width: '90vw' }} onClick={e => e.stopPropagation()}>
              <h2>Run: {selected.pipeline}</h2>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <span className={`badge badge-${selected.status}`}>{selected.status}</span>
                <span className="tag">{selected.type}</span>
                <span className="tag">{new Date(selected.started_at).toLocaleString()}</span>
                {selected.duration_seconds != null && (
                  <span className="tag">{selected.duration_seconds}s</span>
                )}
              </div>
              {selected.stdout && (
                <>
                  <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>STDOUT</div>
                  <div className="log-box" style={{ marginBottom: 12 }}>{selected.stdout}</div>
                </>
              )}
              {selected.stderr && (
                <>
                  <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--danger)' }}>STDERR</div>
                  <div className="log-box" style={{ color: 'var(--danger)' }}>{selected.stderr}</div>
                </>
              )}
              {!selected.stdout && !selected.stderr && (
                <div style={{ color: 'var(--text-muted)' }}>No output captured.</div>
              )}
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setSelected(null)}>Close</button>
              </div>
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
    return r?.data?.detail ?? 'Error'
  }
  return String(e)
}
