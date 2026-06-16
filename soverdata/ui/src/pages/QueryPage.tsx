import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { catalogApi, queryApi, QueryResult } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'
import api from '../api/client'

interface TableRef { name: string; layer: string; view_name: string }

const EXAMPLE_QUERIES = [
  { label: 'All views', sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY 1;" },
  { label: 'Sample Bronze sales', sql: 'SELECT\n    order_id,\n    order_date,\n    category,\n    product,\n    quantity,\n    unit_price,\n    revenue,\n    region,\n    channel\nFROM bronze.sales\nLIMIT 20;' },
  { label: 'Row count', sql: 'SELECT COUNT(*) AS total_rows FROM bronze.sales;' },
  { label: 'Revenue by category', sql: "SELECT category, COUNT(*) AS orders, ROUND(SUM(revenue),2) AS revenue\nFROM bronze.sales\nGROUP BY category\nORDER BY revenue DESC;" },
]

export default function QueryPage() {
  const { workspace } = useWorkspace()
  const [sql, setSql] = useState('-- Write SQL here. Tables are registered as bronze.<name>, silver.<name>, gold.<name>\nSELECT 1 + 1 AS answer;')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [duration, setDuration] = useState<number | null>(null)
  const [tables, setTables] = useState<TableRef[]>([])

  useEffect(() => {
    if (!workspace) return
    api.get<TableRef[]>('/query/tables').then(r => setTables(r.data)).catch(() => setTables([]))
  }, [workspace])

  const runQuery = async () => {
    if (!workspace) { setError('Open a workspace first.'); return }
    setLoading(true); setError(''); setResult(null)
    const t0 = Date.now()
    try {
      const res = await queryApi.execute(sql)
      setResult(res); setDuration(Date.now() - t0)
    } catch (e) { setError(errMsg(e)) }
    finally { setLoading(false) }
  }

  const insertTable = async (table: TableRef) => {
    let columns: string[] = []
    try {
      const schema = await catalogApi.schema(table.layer, table.name)
      columns = (schema.schema || []).map((col: { name: string }) => col.name)
    } catch {
      columns = []
    }
    const columnList = columns.length
      ? columns.map(c => `    ${c}`).join(',\n')
      : '    -- choose columns'
    setSql(prev => {
      const trimmed = prev.trim()
      const query = `SELECT\n${columnList}\nFROM ${table.view_name}\nLIMIT 50;`
      if (!trimmed || trimmed.startsWith('--')) return query
      return prev + `\n\n${query}\n`
    })
  }

  const downloadCSV = () => {
    if (!result) return
    const header = result.columns.join(',')
    const rows = result.rows.map(r => (r as unknown[]).map(v => {
      const s = v == null ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(','))
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'query_result.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const refreshTables = () => {
    if (!workspace) return
    api.get<TableRef[]>('/query/tables').then(r => setTables(r.data)).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-header">
        <h1>SQL Query</h1>
        <p>Ad-hoc DuckDB SQL over the lakehouse. Tables: <code>bronze.name</code>, <code>silver.name</code>, <code>gold.name</code>.</p>
      </div>
      <div className="page-body" style={{ flex: 1, display: 'flex', gap: 16, flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          {/* Table browser */}
          <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text-muted)' }}>Tables</div>
              <button style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }} onClick={refreshTables} title="Refresh">↻</button>
            </div>
            {tables.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No tables. Run a pipeline first.</div>
            ) : (
              ['bronze', 'silver', 'gold'].map(layer => {
                const layerTables = tables.filter(t => t.layer === layer)
                if (layerTables.length === 0) return null
                return (
                  <div key={layer}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{layer}</div>
                    {layerTables.map(t => (
                      <div
                        key={t.view_name}
                        title={`Click to insert: ${t.view_name}`}
                        onClick={() => insertTable(t)}
                        style={{
                          padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                          background: 'var(--bg-3)', marginBottom: 3, fontFamily: 'var(--font-mono)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-3)')}
                      >
                        {t.name}
                      </div>
                    ))}
                  </div>
                )
              })
            )}
          </div>

          {/* Editor + results */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div className="toolbar">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {EXAMPLE_QUERIES.map(q => (
                  <button key={q.label} className="btn btn-secondary btn-sm" onClick={() => setSql(q.sql)}>{q.label}</button>
                ))}
              </div>
              <div className="toolbar-right">
                <button className="btn btn-primary" onClick={runQuery} disabled={loading} title="Ctrl+Enter">
                  {loading ? <span className="spinner" /> : '▶ Run'}
                </button>
              </div>
            </div>

            <div className="editor-wrap" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery() } }}>
              <Editor
                height="200px"
                language="sql"
                value={sql}
                onChange={val => setSql(val ?? '')}
                theme="vs-dark"
                options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, lineNumbers: 'on', wordWrap: 'on' }}
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {result && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div className="results-meta">{result.row_count ?? result.rows.length} rows · {duration}ms</div>
                  <button className="btn btn-secondary btn-sm" onClick={downloadCSV}>↓ CSV</button>
                </div>
                {result.columns.length === 0 ? (
                  <div className="alert alert-success">Query executed (no rows returned).</div>
                ) : (
                  <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
                    <table>
                      <thead><tr>{result.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>
                        {result.rows.map((row, i) => (
                          <tr key={i}>
                            {(row as unknown[]).map((v, j) => (
                              <td key={j} style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                                {v == null ? <span style={{ color: 'var(--text-muted)' }}>null</span> : String(v)}
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
          </div>
        </div>
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
