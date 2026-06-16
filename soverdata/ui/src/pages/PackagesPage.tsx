import { useEffect, useRef, useState } from 'react'
import { packagesApi, PackageInfo } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

// ── Parse requirements.txt into structured rows ───────────────────

interface PkgRow {
  id: string
  raw: string        // original line (package spec or comment/option)
  kind: 'package' | 'comment' | 'option' | 'blank'
  name: string       // parsed package name (packages only)
  version: string    // version constraint (packages only, e.g. ">=2.32.0")
}

function parseRequirements(text: string): PkgRow[] {
  return text.split('\n').map((raw, i) => {
    const trimmed = raw.trim()
    const id = `row-${i}-${Math.random().toString(36).slice(2)}`
    if (!trimmed) return { id, raw, kind: 'blank', name: '', version: '' }
    if (trimmed.startsWith('#')) return { id, raw, kind: 'comment', name: trimmed, version: '' }
    if (trimmed.startsWith('-')) return { id, raw, kind: 'option', name: trimmed, version: '' }
    const m = trimmed.match(/^([A-Za-z0-9_.\-]+)(.*)$/)
    if (!m) return { id, raw, kind: 'comment', name: trimmed, version: '' }
    return { id, raw, kind: 'package', name: m[1], version: m[2].trim() }
  })
}

function rowsToText(rows: PkgRow[]): string {
  return rows.map(r => {
    if (r.kind === 'package') return r.version ? `${r.name}${r.version}` : r.name
    return r.raw
  }).join('\n')
}

function makeId() {
  return `row-new-${Math.random().toString(36).slice(2)}`
}

// ── Component ─────────────────────────────────────────────────────

export default function PackagesPage() {
  const { workspace } = useWorkspace()
  const [info, setInfo] = useState<PackageInfo | null>(null)
  const [rows, setRows] = useState<PkgRow[]>([])
  const [rawText, setRawText] = useState('')
  const [activeTab, setActiveTab] = useState<'list' | 'raw'>('list')
  const [addInput, setAddInput] = useState('')
  const [showLogs, setShowLogs] = useState(false)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const addRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    if (!workspace) return
    setLoading(true); setError('')
    try {
      const data = await packagesApi.get()
      applyInfo(data)
    } catch (e) { setError(errMsg(e)) }
    finally { setLoading(false) }
  }

  const applyInfo = (data: PackageInfo) => {
    setInfo(data)
    const parsed = parseRequirements(data.requirements ?? '')
    setRows(parsed)
    setRawText(data.requirements ?? '')
    setDirty(false)
  }

  useEffect(() => { load() }, [workspace])

  // ── Sync between list and raw ─────────────────────────────────

  const switchToRaw = () => {
    setRawText(rowsToText(rows))
    setActiveTab('raw')
  }
  const switchToList = () => {
    const parsed = parseRequirements(rawText)
    setRows(parsed)
    setActiveTab('list')
  }

  const markDirty = () => setDirty(true)

  const updateRow = (id: string, patch: Partial<PkgRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    markDirty()
  }

  const removeRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id))
    markDirty()
  }

  const addPackage = () => {
    const spec = addInput.trim()
    if (!spec) return
    const m = spec.match(/^([A-Za-z0-9_.\-]+)(.*)$/)
    if (!m) return
    const newRow: PkgRow = { id: makeId(), raw: spec, kind: 'package', name: m[1], version: m[2].trim() }
    setRows(prev => {
      // remove trailing blanks, add row, add trailing blank
      const trimmed = [...prev].filter((r, i) => !(r.kind === 'blank' && i === prev.length - 1))
      return [...trimmed, newRow]
    })
    setAddInput('')
    markDirty()
    addRef.current?.focus()
  }

  const currentRequirements = (): string =>
    activeTab === 'raw' ? rawText : rowsToText(rows)

  // ── Save & Install ────────────────────────────────────────────

  const save = async (): Promise<boolean> => {
    setError(''); setMessage('')
    try {
      const data = await packagesApi.saveRequirements(currentRequirements())
      applyInfo(data)
      setMessage('Saved.')
      return true
    } catch (e) { setError(errMsg(e)); return false }
  }

  const install = async () => {
    setError(''); setMessage('')
    setInstalling(true)
    try {
      const saved = await packagesApi.saveRequirements(currentRequirements())
      applyInfo(saved)
      const result = await packagesApi.install(true)
      applyInfo(result)
      setShowLogs(true)
      if (result.status === 'installed') setMessage('All packages installed successfully.')
      else if (result.status === 'empty') setMessage('No packages to install.')
      else setError('Installation failed — check the logs below.')
    } catch (e) { setError(errMsg(e)) }
    finally { setInstalling(false) }
  }

  if (!workspace) return (
    <div>
      <div className="page-header"><h1>Packages</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
    </div>
  )

  const pkgRows = rows.filter(r => r.kind === 'package')
  const status = info?.status

  return (
    <div>
      <div className="page-header">
        <h1>Packages</h1>
        <p>Python packages available to all pipelines in this workspace.</p>
      </div>
      <div className="page-body">

        {/* Status bar */}
        <div className="pkg-status-bar">
          <div className="pkg-status-left">
            <span className={`badge ${statusBadge(status)}`}>{statusLabel(status)}</span>
            <span className="pkg-pkg-count">{pkgRows.length} package{pkgRows.length !== 1 ? 's' : ''} defined</span>
            {info?.last_installed_at && (
              <span className="pkg-meta">Last install: {new Date(info.last_installed_at).toLocaleString()}</span>
            )}
            {info?.last_exit_code != null && info.last_exit_code !== 0 && (
              <span className="pkg-meta pkg-meta-error">exit code {info.last_exit_code}</span>
            )}
          </div>
          <div className="pkg-status-right">
            {dirty && <span className="pkg-unsaved">unsaved changes</span>}
            <button className="btn btn-secondary" onClick={load} disabled={installing || loading}>
              Refresh
            </button>
            <button className="btn btn-secondary" onClick={save} disabled={installing || loading}>
              Save
            </button>
            <button className="btn btn-primary" onClick={install} disabled={installing || loading}>
              {installing ? <><span className="spinner" /> Installing…</> : '↓ Install'}
            </button>
          </div>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
        {message && <div className="alert alert-success" style={{ marginBottom: 12 }}>{message}</div>}

        {loading ? (
          <div className="pkg-loading">Loading workspace packages…</div>
        ) : (
          <>
            {/* Tab switcher */}
            <div className="pkg-tabs">
              <button
                className={`pkg-tab ${activeTab === 'list' ? 'pkg-tab-active' : ''}`}
                onClick={switchToList}
              >Package list</button>
              <button
                className={`pkg-tab ${activeTab === 'raw' ? 'pkg-tab-active' : ''}`}
                onClick={switchToRaw}
              >requirements.txt</button>
            </div>

            {/* List view */}
            {activeTab === 'list' && (
              <div className="pkg-list-panel">
                {/* Add package row */}
                <div className="pkg-add-row">
                  <input
                    ref={addRef}
                    value={addInput}
                    onChange={e => setAddInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addPackage()}
                    placeholder="Add package, e.g. requests>=2.32.0"
                    className="pkg-add-input"
                  />
                  <button className="btn btn-secondary" onClick={addPackage} disabled={!addInput.trim()}>
                    + Add
                  </button>
                </div>

                {pkgRows.length === 0 ? (
                  <div className="pkg-empty">
                    No packages yet. Type a package name above and press Enter.
                  </div>
                ) : (
                  <div className="pkg-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Package</th>
                          <th>Version constraint</th>
                          <th style={{ width: 40 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {pkgRows.map(row => (
                          <PkgTableRow
                            key={row.id}
                            row={row}
                            onChangeName={name => updateRow(row.id, { name })}
                            onChangeVersion={version => updateRow(row.id, { version })}
                            onRemove={() => removeRow(row.id)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Status hint */}
                {status === 'stale' && (
                  <div className="alert alert-warning" style={{ marginTop: 12 }}>
                    Requirements changed since last install. Press Install to update.
                  </div>
                )}
                {status === 'not_installed' && pkgRows.length > 0 && (
                  <div className="alert alert-warning" style={{ marginTop: 12 }}>
                    Packages are defined but not yet installed. Press Install to install them.
                  </div>
                )}
              </div>
            )}

            {/* Raw editor */}
            {activeTab === 'raw' && (
              <div className="pkg-raw-panel">
                <div className="pkg-raw-hint">
                  Standard pip requirements format — one package per line. Comments start with #.
                </div>
                <textarea
                  value={rawText}
                  onChange={e => { setRawText(e.target.value); markDirty() }}
                  spellCheck={false}
                  placeholder={'requests>=2.32.0\npandas==2.2.0\n# a comment'}
                  className="pkg-raw-editor"
                />
              </div>
            )}

            {/* Install logs */}
            {(info?.stdout || info?.stderr) && (
              <div className="pkg-logs">
                <button className="pkg-logs-toggle" onClick={() => setShowLogs(v => !v)}>
                  {showLogs ? '▾' : '▸'} Install logs
                  {info.last_exit_code != null && (
                    <span className={`badge ${info.last_exit_code === 0 ? 'badge-success' : 'badge-failed'}`}
                      style={{ marginLeft: 8, fontSize: 11 }}>
                      exit {info.last_exit_code}
                    </span>
                  )}
                </button>
                {showLogs && (
                  <div className="pkg-logs-body">
                    {info.stdout && (
                      <>
                        <div className="pkg-logs-label">stdout</div>
                        <pre className="log-box">{info.stdout}</pre>
                      </>
                    )}
                    {info.stderr && (
                      <>
                        <div className="pkg-logs-label" style={{ color: 'var(--danger)' }}>stderr</div>
                        <pre className="log-box" style={{ color: 'var(--danger)', opacity: 0.9 }}>{info.stderr}</pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Package table row ─────────────────────────────────────────────

function PkgTableRow({ row, onChangeName, onChangeVersion, onRemove }: {
  row: PkgRow
  onChangeName: (v: string) => void
  onChangeVersion: (v: string) => void
  onRemove: () => void
}) {
  return (
    <tr className="pkg-row">
      <td>
        <input
          className="pkg-inline-input"
          value={row.name}
          onChange={e => onChangeName(e.target.value)}
          spellCheck={false}
        />
      </td>
      <td>
        <input
          className="pkg-inline-input pkg-version-input"
          value={row.version}
          onChange={e => onChangeVersion(e.target.value)}
          placeholder="any"
          spellCheck={false}
        />
      </td>
      <td>
        <button className="pkg-remove-btn" onClick={onRemove} title="Remove">✕</button>
      </td>
    </tr>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

function statusLabel(s?: PackageInfo['status']): string {
  switch (s) {
    case 'installed':     return 'Installed'
    case 'failed':        return 'Failed'
    case 'stale':         return 'Outdated'
    case 'not_installed': return 'Not installed'
    case 'empty':         return 'No packages'
    default:              return 'Unknown'
  }
}

function statusBadge(s?: PackageInfo['status']): string {
  switch (s) {
    case 'installed': return 'badge-success'
    case 'failed':    return 'badge-failed'
    case 'stale':     return 'badge-running'
    case 'empty':     return 'badge-sql'
    default:          return 'badge-running'
  }
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'Error'
  }
  return String(e)
}
