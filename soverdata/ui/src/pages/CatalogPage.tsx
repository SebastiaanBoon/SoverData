import { useEffect, useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { catalogApi, CatalogTable, filesApi, queryApi, QueryResult, WorkspaceFileEntry, WorkspaceFileList } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

const SCHEMAS = ['bronze', 'silver', 'gold'] as const

type SchemaColumn = { name: string; type: string; nullable: boolean }
type DataView = 'tables' | 'files'

export default function CatalogPage() {
  const { workspace } = useWorkspace()
  const [tables, setTables] = useState<CatalogTable[]>([])
  const [view, setView] = useState<DataView>('tables')
  const [selected, setSelected] = useState<CatalogTable | null>(null)
  const [schema, setSchema] = useState<SchemaColumn[]>([])
  const [preview, setPreview] = useState<QueryResult | null>(null)
  const [sql, setSql] = useState('')
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState('')
  const [queryDuration, setQueryDuration] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ bronze: true, silver: true, gold: true })
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [fileList, setFileList] = useState<WorkspaceFileList | null>(null)
  const [filePath, setFilePath] = useState('lakehouse')
  const [fileLoading, setFileLoading] = useState(false)
  const [error, setError] = useState('')

  const bySchema = useMemo(() => {
    return tables.reduce<Record<string, CatalogTable[]>>((acc, table) => {
      const layer = table.layer || 'unknown'
      acc[layer] = acc[layer] || []
      acc[layer].push(table)
      return acc
    }, {})
  }, [tables])

  const totalRows = tables.reduce((sum, table) => sum + (table.row_count ?? 0), 0)

  const load = async () => {
    if (!workspace) return
    setLoading(true)
    setError('')
    try {
      const next = await catalogApi.tables()
      setTables(next)
      if (selected) {
        const refreshed = next.find(table => table.layer === selected.layer && table.name === selected.name)
        if (refreshed) await selectTable(refreshed)
        else {
          setSelected(null)
          setSchema([])
          setPreview(null)
        }
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspace])
  useEffect(() => { if (workspace && view === 'files') loadFiles(filePath) }, [workspace, view])

  const selectTable = async (table: CatalogTable) => {
    setSelected(table)
    setDetailLoading(true)
    setError('')
    try {
      const [schemaData, previewData] = await Promise.all([
        catalogApi.schema(table.layer, table.name),
        catalogApi.preview(table.layer, table.name, 100),
      ])
      const nextSchema = schemaData.schema || []
      setSchema(nextSchema)
      setPreview(previewData)
      setSql(selectTopSql(table, nextSchema.map((column: SchemaColumn) => column.name)))
      setQueryResult(null)
      setQueryError('')
      setQueryDuration(null)
    } catch (e) {
      setSchema([])
      setPreview(null)
      setError(errMsg(e))
    } finally {
      setDetailLoading(false)
    }
  }

  const toggleSchema = (schemaName: string) => {
    setExpanded(prev => ({ ...prev, [schemaName]: !prev[schemaName] }))
  }

  const runQuery = async () => {
    if (!sql.trim()) {
      setQueryError('Enter a SQL query.')
      return
    }
    setQueryLoading(true)
    setQueryError('')
    setQueryResult(null)
    const started = Date.now()
    try {
      const result = await queryApi.execute(sql)
      setQueryResult(result)
      setQueryDuration(Date.now() - started)
    } catch (e) {
      setQueryError(errMsg(e))
    } finally {
      setQueryLoading(false)
    }
  }

  const loadFiles = async (path = filePath) => {
    setFileLoading(true)
    setError('')
    try {
      const data = await filesApi.list(path)
      setFileList(data)
      setFilePath(data.path || path)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setFileLoading(false)
    }
  }

  if (!workspace) {
    return (
      <div>
        <div className="page-header"><h1>Data</h1></div>
        <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
      </div>
    )
  }

  return (
    <div className="data-page">
      <div className="page-header">
        <h1>Data</h1>
        <p>Table view for logical tables. File view for the physical lakehouse files.</p>
      </div>
      <div className="page-body data-body">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="data-view-tabs">
          <button className={view === 'tables' ? 'active' : ''} onClick={() => setView('tables')}>Table view</button>
          <button className={view === 'files' ? 'active' : ''} onClick={() => setView('files')}>File view</button>
        </div>
        {view === 'files' ? (
          <FileView
            fileList={fileList}
            loading={fileLoading}
            onOpen={entry => {
              if (entry.type === 'folder') loadFiles(entry.path)
            }}
            onUp={() => fileList?.parent != null && loadFiles(fileList.parent)}
            onRefresh={() => loadFiles(filePath)}
          />
        ) : (
        <div className="data-shell">
          <aside className="data-tree">
            <div className="data-tree-head">
              <div>
                <strong>Lakehouse</strong>
                <span>{tables.length} tables / {totalRows.toLocaleString()} rows</span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
                {loading ? <span className="spinner" /> : 'Refresh'}
              </button>
            </div>

            <div className="data-tree-list">
              {SCHEMAS.map(schemaName => {
                const schemaTables = (bySchema[schemaName] || []).slice().sort((a, b) => a.name.localeCompare(b.name))
                return (
                  <div key={schemaName} className="data-schema">
                    <button className="data-schema-row" onClick={() => toggleSchema(schemaName)}>
                      <span className="data-caret">{expanded[schemaName] ? 'v' : '>'}</span>
                      <span className={`badge badge-${schemaName}`}>{schemaName}</span>
                      <span className="data-count">{schemaTables.length}</span>
                    </button>
                    {expanded[schemaName] && (
                      <div className="data-table-list">
                        {schemaTables.length === 0 ? (
                          <div className="data-empty-node">No tables</div>
                        ) : schemaTables.map(table => {
                          const active = selected?.layer === table.layer && selected?.name === table.name
                          return (
                            <button
                              key={`${table.layer}.${table.name}`}
                              className={active ? 'data-table-row active' : 'data-table-row'}
                              onClick={() => selectTable(table)}
                              title={`${table.layer}.${table.name}`}
                            >
                              <span className="data-table-icon">T</span>
                              <span className="data-table-name">{table.name}</span>
                              {table.row_count != null && <span className="data-row-count">{table.row_count.toLocaleString()}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </aside>

          <main className="data-detail">
            {!selected ? (
              <div className="data-detail-empty">
                <h2>Select a table</h2>
                <p>Open a schema on the left and choose a table to inspect columns and data.</p>
              </div>
            ) : (
              <>
                <div className="data-detail-head">
                  <div>
                    <span className={`badge badge-${selected.layer}`}>{selected.layer}</span>
                    <h2>{selected.name}</h2>
                    <p>{viewName(selected)}</p>
                  </div>
                  <div className="data-detail-meta">
                    <span className="tag">{selected.format}</span>
                    {selected.row_count != null && <span className="tag">{selected.row_count.toLocaleString()} rows</span>}
                  </div>
                </div>

                {selected.description && <div className="data-description">{selected.description}</div>}
                {detailLoading && <div className="data-loading"><span className="spinner" /> Loading table...</div>}

                <div className="data-panels">
                  <section className="data-panel">
                    <div className="data-panel-head">
                      <h3>Columns</h3>
                      <span>{schema.length}</span>
                    </div>
                    {schema.length === 0 ? (
                      <div className="data-empty-node">No schema available</div>
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Name</th><th>Type</th><th>Nullable</th></tr></thead>
                          <tbody>
                            {schema.map(column => (
                              <tr key={column.name}>
                                <td className="data-mono">{column.name}</td>
                                <td><span className="tag">{column.type}</span></td>
                                <td>{column.nullable ? 'yes' : 'no'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="data-panel">
                    <div className="data-panel-head">
                      <h3>Preview</h3>
                      <span>{preview?.rows.length ?? 0} rows</span>
                    </div>
                    {preview && (preview as Record<string, unknown>).error ? (
                      <div className="alert alert-error">{String((preview as Record<string, unknown>).error)}</div>
                    ) : preview && preview.columns.length > 0 ? (
                      <div className="table-wrap data-preview">
                        <table>
                          <thead><tr>{preview.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
                          <tbody>
                            {preview.rows.map((row, i) => (
                              <tr key={i}>
                                {(row as unknown[]).map((value, j) => (
                                  <td key={j} className="data-cell">{value == null ? <span className="act-null">null</span> : String(value)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="data-empty-node">No preview available</div>
                    )}
                  </section>

                  <section className="data-panel">
                    <div className="data-panel-head">
                      <h3>Query</h3>
                      <div className="std-inline-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => setSql(selectTopSql(selected, schema.map(column => column.name)))}>
                          Select top
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={runQuery} disabled={queryLoading}>
                          {queryLoading ? <span className="spinner" /> : 'Run'}
                        </button>
                      </div>
                    </div>
                    <div className="editor-wrap" onKeyDown={e => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault()
                        runQuery()
                      }
                    }}>
                      <Editor
                        height="180px"
                        language="sql"
                        value={sql}
                        onChange={value => setSql(value ?? '')}
                        theme="vs-dark"
                        options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, lineNumbers: 'on', wordWrap: 'on' }}
                      />
                    </div>
                    {queryError && <div className="alert alert-error" style={{ marginTop: 12 }}>{queryError}</div>}
                    {queryResult && (
                      <div style={{ marginTop: 12 }}>
                        <div className="results-meta">
                          {queryResult.row_count ?? queryResult.rows.length} rows
                          {queryDuration != null ? ` / ${queryDuration}ms` : ''}
                        </div>
                        {queryResult.columns.length > 0 ? (
                          <div className="table-wrap data-preview">
                            <table>
                              <thead><tr>{queryResult.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
                              <tbody>
                                {queryResult.rows.map((row, i) => (
                                  <tr key={i}>
                                    {(row as unknown[]).map((value, j) => (
                                      <td key={j} className="data-cell">{value == null ? <span className="act-null">null</span> : String(value)}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="alert alert-success">Query executed.</div>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
          </main>
        </div>
        )}
      </div>
    </div>
  )
}

function FileView({ fileList, loading, onOpen, onUp, onRefresh }: {
  fileList: WorkspaceFileList | null
  loading: boolean
  onOpen: (entry: WorkspaceFileEntry) => void
  onUp: () => void
  onRefresh: () => void
}) {
  const entries = fileList?.entries ?? []
  return (
    <div className="data-file-view">
      <div className="data-file-toolbar">
        <div>
          <strong>{fileList?.path || 'lakehouse'}</strong>
          <span>Physical files and folders</span>
        </div>
        <div className="std-inline-actions">
          <button className="btn btn-secondary btn-sm" onClick={onUp} disabled={!fileList?.parent}>Up</button>
          <button className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading}>{loading ? <span className="spinner" /> : 'Refresh'}</button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>No files.</td></tr>
            ) : entries.map(entry => (
              <tr key={entry.path} className={entry.type === 'folder' ? 'data-file-folder' : ''} onClick={() => onOpen(entry)}>
                <td className="data-mono">{entry.type === 'folder' ? '[folder] ' : ''}{entry.name}</td>
                <td><span className="tag">{entry.type === 'folder' ? 'folder' : entry.extension || 'file'}</span></td>
                <td style={{ color: 'var(--text-muted)' }}>{entry.size != null ? formatBytes(entry.size) : '-'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{entry.modified ? new Date(entry.modified).toLocaleString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function viewName(table: CatalogTable): string {
  return `${table.layer}.${table.name}`
}

function selectTopSql(table: CatalogTable, columns: string[]): string {
  const columnList = columns.length
    ? columns.map(column => `    ${column}`).join(',\n')
    : '    -- choose columns'
  return `SELECT
${columnList}
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

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
