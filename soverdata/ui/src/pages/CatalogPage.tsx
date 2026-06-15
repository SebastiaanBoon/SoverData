import { useState, useEffect } from 'react'
import { catalogApi, CatalogTable, QueryResult } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

export default function CatalogPage() {
  const { workspace } = useWorkspace()
  const [tables, setTables] = useState<CatalogTable[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<CatalogTable | null>(null)
  const [schema, setSchema] = useState<{ name: string; type: string; nullable: boolean }[]>([])
  const [preview, setPreview] = useState<QueryResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!workspace) return
    setLoading(true)
    try { setTables(await catalogApi.tables()) }
    catch (e) { setError(errMsg(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [workspace])

  const handleSelect = async (table: CatalogTable) => {
    setSelected(table); setPreview(null)
    try {
      const data = await catalogApi.schema(table.layer, table.name)
      setSchema(data.schema || [])
    } catch { setSchema([]) }
  }

  const handlePreview = async () => {
    if (!selected) return
    setPreviewLoading(true)
    try { setPreview(await catalogApi.preview(selected.layer, selected.name, 50)) }
    catch (e) { setError(errMsg(e)) }
    finally { setPreviewLoading(false) }
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
          <button className="btn btn-secondary" onClick={load}>↻ Refresh</button>
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
          <div style={{ display: 'grid', gridTemplateColumns: selected ? '260px 1fr' : '1fr', gap: 20 }}>
            {/* Table list */}
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
                          cursor: 'pointer', marginBottom: 8, padding: '12px 14px',
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
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            {/* Detail panel */}
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
                    <button className="btn btn-secondary btn-sm" onClick={() => { setSelected(null); setPreview(null) }}>✕</button>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{selected.path}</div>
                  {selected.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{selected.description}</div>}
                  {(selected as Record<string, unknown>).lineage && (
                    <div style={{ fontSize: 11, background: 'var(--bg-3)', borderRadius: 4, padding: '6px 10px', marginBottom: 10 }}>
                      <strong>Lineage:</strong> {JSON.stringify((selected as Record<string, unknown>).lineage)}
                    </div>
                  )}

                  {schema.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>SCHEMA</div>
                      <div className="table-wrap" style={{ marginBottom: 14 }}>
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
                  )}

                  <button className="btn btn-secondary btn-sm" onClick={handlePreview} disabled={previewLoading}>
                    {previewLoading ? <span className="spinner" /> : 'Preview data'}
                  </button>
                </div>

                {preview && (
                  <div className="card">
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>
                      PREVIEW — {preview.rows.length} rows
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

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'Error'
  }
  return String(e)
}
