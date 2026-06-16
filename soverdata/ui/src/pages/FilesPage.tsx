import { useEffect, useState } from 'react'
import { filesApi, WorkspaceFileContent, WorkspaceFileEntry, WorkspaceFileList } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

export default function FilesPage() {
  const { workspace } = useWorkspace()
  const [currentPath, setCurrentPath] = useState('')
  const [listing, setListing] = useState<WorkspaceFileList | null>(null)
  const [selected, setSelected] = useState<WorkspaceFileEntry | null>(null)
  const [content, setContent] = useState<WorkspaceFileContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async (path = currentPath) => {
    if (!workspace) return
    setLoading(true)
    setError('')
    try {
      const data = await filesApi.list(path)
      setListing(data)
      setCurrentPath(data.path)
      setSelected(null)
      setContent(null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load('') }, [workspace])

  const openEntry = async (entry: WorkspaceFileEntry) => {
    if (entry.type === 'folder') {
      await load(entry.path)
      return
    }

    setSelected(entry)
    setContent(null)
    setError('')
    if (!entry.previewable) return

    setPreviewLoading(true)
    try {
      setContent(await filesApi.content(entry.path))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setPreviewLoading(false)
    }
  }

  const crumbs = currentPath ? currentPath.split('/').filter(Boolean) : []

  if (!workspace) return (
    <div>
      <div className="page-header"><h1>Files</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <h1>Files</h1>
        <p>Browse files in the open workspace.</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={() => load(listing?.parent ?? '')} disabled={!listing?.parent}>
            Up
          </button>
          <button className="btn btn-secondary" onClick={() => load(currentPath)}>Refresh</button>
          <div className="file-crumbs">
            <button className="file-crumb" onClick={() => load('')}>{workspace.name}</button>
            {crumbs.map((part, index) => {
              const path = crumbs.slice(0, index + 1).join('/')
              return (
                <button key={path} className="file-crumb" onClick={() => load(path)}>
                  {part}
                </button>
              )
            })}
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="file-browser">
          <div className="file-list">
            {loading ? (
              <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
            ) : listing && listing.entries.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {listing.entries.map(entry => (
                    <tr
                      key={entry.path}
                      onClick={() => openEntry(entry)}
                      style={{
                        cursor: 'pointer',
                        background: selected?.path === entry.path ? 'var(--bg-3)' : undefined,
                      }}
                    >
                      <td>
                        <strong>{entry.type === 'folder' ? '[DIR]' : '[FILE]'} {entry.name}</strong>
                      </td>
                      <td><span className="tag">{entry.type === 'folder' ? 'folder' : entry.extension || 'file'}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{entry.type === 'folder' ? '-' : formatBytes(entry.size ?? 0)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{new Date(entry.modified).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-state">
                <h3>Folder is empty</h3>
                <p>No files found in this folder.</p>
              </div>
            )}
          </div>

          <aside className="file-preview">
            {selected ? (
              <>
                <div className="file-preview-header">
                  <div>
                    <strong>{selected.name}</strong>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>{selected.path}</div>
                  </div>
                  <a className="btn btn-secondary btn-sm" href={filesApi.downloadUrl(selected.path)}>
                    Download
                  </a>
                </div>
                {previewLoading ? (
                  <div style={{ color: 'var(--text-muted)' }}>Loading preview...</div>
                ) : content ? (
                  <pre className="file-content">{content.content}</pre>
                ) : (
                  <div className="file-preview-empty">
                    This file cannot be previewed as text.
                  </div>
                )}
              </>
            ) : (
              <div className="file-preview-empty">
                Select a file to preview it.
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'Error'
  }
  return String(e)
}
