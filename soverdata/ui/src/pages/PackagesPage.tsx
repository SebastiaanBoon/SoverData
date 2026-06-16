import { useEffect, useState } from 'react'
import { packagesApi, PackageInfo } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

export default function PackagesPage() {
  const { workspace } = useWorkspace()
  const [info, setInfo] = useState<PackageInfo | null>(null)
  const [requirements, setRequirements] = useState('')
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    if (!workspace) return
    setLoading(true)
    setError('')
    try {
      const data = await packagesApi.get()
      setInfo(data)
      setRequirements(data.requirements)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspace])

  const handleSave = async () => {
    setError('')
    setMessage('')
    try {
      const data = await packagesApi.saveRequirements(requirements)
      setInfo(data)
      setRequirements(data.requirements)
      setMessage('Requirements saved.')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const handleInstall = async () => {
    setInstalling(true)
    setError('')
    setMessage('')
    try {
      const saved = await packagesApi.saveRequirements(requirements)
      setInfo(saved)
      const installed = await packagesApi.install(true)
      setInfo(installed)
      setRequirements(installed.requirements)
      if (installed.status === 'installed') {
        setMessage('Packages installed.')
      } else if (installed.status === 'empty') {
        setMessage('No packages configured.')
      } else {
        setError('Package installation failed.')
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setInstalling(false)
    }
  }

  if (!workspace) return (
    <div>
      <div className="page-header"><h1>Packages</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <h1>Packages</h1>
        <p>Workspace Python packages for pipeline runs.</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <button className="btn btn-primary" onClick={handleInstall} disabled={installing || loading}>
            {installing ? <span className="spinner" /> : 'Install Packages'}
          </button>
          <button className="btn btn-secondary" onClick={handleSave} disabled={installing || loading}>
            Save
          </button>
          <button className="btn btn-secondary" onClick={load} disabled={installing || loading}>
            Refresh
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <span className={`badge ${statusClass(info?.status)}`}>{statusLabel(info?.status)}</span>
                {info && <span className="tag">{info.requirements_path}</span>}
                {info && <span className="tag">{info.packages_path}</span>}
                {info?.last_installed_at && (
                  <span className="tag">Last install {new Date(info.last_installed_at).toLocaleString()}</span>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>requirements.txt</label>
                <textarea
                  value={requirements}
                  onChange={e => setRequirements(e.target.value)}
                  spellCheck={false}
                  placeholder="requests>=2.32.0"
                  style={{
                    minHeight: 260,
                    resize: 'vertical',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                />
              </div>
            </div>

            {(info?.stdout || info?.stderr) ? (
              <div className="card">
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Install Logs</h3>
                {info.stdout && (
                  <>
                    <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>STDOUT</div>
                    <div className="log-box" style={{ marginBottom: 12 }}>{info.stdout}</div>
                  </>
                )}
                {info.stderr && (
                  <>
                    <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--danger)' }}>STDERR</div>
                    <div className="log-box" style={{ color: 'var(--danger)' }}>{info.stderr}</div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No package install logs yet.</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function statusLabel(status?: PackageInfo['status']): string {
  switch (status) {
    case 'installed': return 'installed'
    case 'failed': return 'failed'
    case 'stale': return 'stale'
    case 'not_installed': return 'not installed'
    case 'empty': return 'empty'
    default: return 'unknown'
  }
}

function statusClass(status?: PackageInfo['status']): string {
  switch (status) {
    case 'installed': return 'badge-success'
    case 'failed': return 'badge-failed'
    case 'stale': return 'badge-running'
    case 'not_installed': return 'badge-running'
    case 'empty': return 'badge-sql'
    default: return 'badge-running'
  }
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'Error'
  }
  return String(e)
}
