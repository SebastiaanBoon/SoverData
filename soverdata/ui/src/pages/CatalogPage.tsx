import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { catalogApi, CatalogTable, queryApi, QueryResult } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

type ActiveView = 'design' | 'query'

export default function CatalogPage() {
  const { workspace } = useWorkspace()
  const [tables, setTables] = useState<CatalogTable[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<CatalogTable | null>(null)
  const [activeView, setActiveView] = useState<ActiveView>('design')
  const [schema, setSchema] = useState<{ name: string; type: string; nullable: boolean }[]>([])
  const [preview, setPreview] = useState<QueryResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [sql, setSql] = useState('')
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState('')
  const [queryDuration, setQueryDuration] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    if (!workspace) return
    setLoading(true)
    try { setTables(await catalogApi.tables()) }
    catch (e) { setError(errMsg(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [workspace])

  const loadSchema = async (table: CatalogTable) => {
    try {
      const data = await catalogApi.schema(table.layer, table.name)
      setSchema(data.schema || [])
    } catch {
      setSchema([])
    }
  }

  const handleSelect = async (table: CatalogTable) => {
    setSelected(table)
    setActiveView('design')
    setPreview(null)
    setQueryError('')
    await loadSchema(table)
  }

  const handleSelectTop = async (table: CatalogTable) => {
    setSelected(table)
    setActiveView('query')
    setPreview(null)
    setQueryResult(null)
    setQueryError('')
    setQueryDuration(null)
    setSql(selectTopSql(table))
    await loadSchema(table)
  }

  const handlePreview = async (table = selected) => {
    if (!table) return
    setSelected(table)
    setActiveView('design')
    setQueryError('')
    setPreviewLoading(true)
    await loadSchema(table)
    try { setPreview(await catalogApi.preview(table.layer, table.name, 50)) }
    catch (e) { setError(errMsg(e)) }
    finally { setPreviewLoading(false) }
  }

  const runCatalogQuery = async () => {
    if (!workspace) { setQueryError('Open a workspace first.'); return }
    if (!sql.trim()) { setQueryError('Enter a SQL query.'); return }
    setQueryLoading(true)
    setQueryError('')
    setQueryResult(null)
    const t0 = Date.now()
    try {
      const res = await queryApi.execute(sql)
      setQueryResult(res)
      setQueryDuration(Date.now() - t0)
    } catch (e) {
      setQueryError(errMsg(e))
    } finally {
      setQueryLoading(false)
    }
  }

  const downloadCSV = () => {
    if (!queryResult) return
    const header = queryResult.columns.join(',')
    const rows = queryResult.rows.map(r => (r as unknown[]).map(v => {
      const s = v == null ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(','))
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected ? viewName(selected) : 'query'}_result.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!workspace) return (
    <div>
      <div className="page-header"><h1>Catalog</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
    </div>
  )

  const byLayer = tables.reduce<Record<string, CatalogTable[]>>((acc, t) => {
    (acc[t.layer] = acc[t.layer] || []).push(t); return acc
  }, {})

  const totalRows = tables.reduce((sum, t) => sum + (t.row_count ?? 0), 0)

  return (
    <div>
      <div className="page-header">
        <h1>Catalog</h1>
        <p>Browse Bronze, Silver, and Gold tables in the lakehouse.</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={load}>Refresh</button>
          {tables.length > 0 && (
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {tables.length} tables · {totalRows.toLocaleString()} total rows
            </span>
          )}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>Scanning lakehouse...</div>
        ) : tables.length === 0 ? (
          <div className="empty-state">
            <h3>No tables found</h3>
            <p>Run a pipeline to create tables in the lakehouse.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: selected ? '300px 1fr' : '1fr', gap: 20 }}>
            <div>
              {['bronze', 'silver', 'gold'].map(layer => {
                const layerTables = byLayer[layer] || []
                if (layerTables.length === 0) return null
                return (
                  <div key={layer} style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span className={`badge badge-${layer}`}>{layer}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{layerTables.length} tables</span>
                    </div>
                    {layerTables.map(t => (
                      <div
                        key={t.name}
                        className="card"
                        style={{
                          cursor: 'pointer',
                          marginBottom: 8,
                          padding: '12px 14px',
                          borderColor: selected?.name === t.name && selected?.layer === t.layer ? 'var(--accent)' : 'var(--border)',
                        }}
                        onClick={() => handleSelect(t)}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.name}</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span className="tag">{t.format}</span>
                          {t.row_count != null && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.row_count.toLocaleString()} rows</span>
                          )}
                        </div>
                        {t.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t.description}</div>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={e => { e.stopPropagation(); handleSelectTop(t) }}
                          >
                            Select Top
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={e => { e.stopPropagation(); handlePreview(t) }}
                            disabled={previewLoading && selected?.name === t.name && selected?.layer === t.layer}
                          >
                            {previewLoading && selected?.name === t.name && selected?.layer === t.layer ? <span className="spinner" /> : 'Preview'}
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={e => { e.stopPropagation(); handleSelect(t) }}
                          >
                            Design
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            {selected && (
              <div>
                <div className="card" style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <span className={`badge badge-${selected.layer}`} style={{ marginRight: 8 }}>{selected.layer}</span>
                      <strong style={{ fontSize: 16 }}>{selected.name}</strong>
                      {selected.row_count != null && (
                        <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text-muted)' }}>{selected.row_count.toLocaleString()} rows</span>
                      )}
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setSelected(null); setPreview(null); setQueryResult(null); setQueryError('') }}
                    >
                      Close
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{selected.path}</div>
                  {selected.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{selected.description}</div>}
                  {(selected as Record<string, unknown>).lineage && (
                    <div style={{ fontSize: 11, background: 'var(--bg-3)', borderRadius: 4, padding: '6px 10px', marginBottom: 10 }}>
                      <strong>Lineage:</strong> {JSON.stringify((selected as Record<string, unknown>).lineage)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button
                      className={activeView === 'query' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                      onClick={() => handleSelectTop(selected)}
                    >
                      Select Top
                    </button>
                    <button
                      className={activeView === 'design' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                      onClick={() => handleSelect(selected)}
                    >
                      Design
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handlePreview()} disabled={previewLoading}>
                      {previewLoading ? <span className="spinner" /> : 'Preview'}
                    </button>
                  </div>
                </div>

                {activeView === 'design' && (
                  <div className="card" style={{ marginBottom: 14 }}>
                    {schema.length > 0 ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>SCHEMA</div>
                        <div className="table-wrap">
                          <table>
                            <thead><tr><th>Column</th><th>Type</th><th>Nullable</th></tr></thead>
                            <tbody>
                              {schema.map(col => (
                                <tr key={col.name}>
                                  <td style={{ fontFamily: 'var(--font-mono)' }}>{col.name}</td>
                                  <td><span className="tag">{col.type}</span></td>
                                  <td style={{ color: 'var(--text-muted)' }}>{col.nullable ? 'yes' : 'no'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No schema available.</div>
                    )}
                  </div>
                )}

                {activeView === 'query' && (
                  <div className="card" style={{ marginBottom: 14 }}>
                    <div className="toolbar" style={{ marginBottom: 12 }}>
                      <span className="tag">{viewName(selected)}</span>
                      <div className="toolbar-right">
                        <button className="btn btn-primary btn-sm" onClick={runCatalogQuery} disabled={queryLoading}>
                          {queryLoading ? <span className="spinner" /> : 'Run'}
                        </button>
                      </div>
                    </div>

                    <div
                      className="editor-wrap"
                      onKeyDown={e => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          e.preventDefault()
                          runCatalogQuery()
                        }
                      }}
                    >
                      <Editor
                        height="180px"
                        language="sql"
                        value={sql}
                        onChange={val => setSql(val ?? '')}
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

                    {queryError && <div className="alert alert-error" style={{ marginTop: 12 }}>{queryError}</div>}

                    {queryResult && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div className="results-meta">
                            {queryResult.row_count ?? queryResult.rows.length} rows
                            {queryDuration != null ? ` · ${queryDuration}ms` : ''}
                          </div>
                          <button className="btn btn-secondary btn-sm" onClick={downloadCSV}>CSV</button>
                        </div>
                        {queryResult.columns.length === 0 ? (
                          <div className="alert alert-success">Query executed.</div>
                        ) : (
                          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
                            <table>
                              <thead><tr>{queryResult.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                              <tbody>
                                {queryResult.rows.map((row, i) => (
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
                )}

                {preview && (
                  <div className="card">
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>
                      PREVIEW - {preview.rows.length} rows
                    </div>
                    {(preview as Record<string, unknown>).error ? (
                      <div className="alert alert-error">{String((preview as Record<string, unknown>).error)}</div>
                    ) : (
                      <div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}>
                        <table>
                          <thead><tr>{preview.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                          <tbody>
                            {preview.rows.map((row, i) => (
                              <tr key={i}>
                                {(row as unknown[]).map((v, j) => (
                                  <td key={j} style={{ fontSize: 12 }}>
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
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function viewName(table: CatalogTable): string {
  return `${table.layer}__${table.name}`
}

function selectTopSql(table: CatalogTable): string {
  return `SELECT *
FROM ${viewName(table)}
LIMIT 100;`
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'Error'
  }
  return String(e)
}
