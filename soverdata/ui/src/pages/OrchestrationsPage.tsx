import { useEffect, useMemo, useState } from 'react'
import {
  orchestrationApi,
  Orchestration,
  OrchestrationRun,
  OrchestrationStep,
  OrchestrationTrigger,
  pipeApi,
  Pipeline,
} from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

export default function OrchestrationsPage() {
  const { workspace } = useWorkspace()
  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedName, setSelectedName] = useState('')
  const [isNew, setIsNew] = useState(true)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<OrchestrationStep[]>([])
  const [triggers, setTriggers] = useState<OrchestrationTrigger[]>([])
  const [runResult, setRunResult] = useState<OrchestrationRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const pipelineGroups = useMemo(() => ({
    python: pipelines.filter(p => p.type === 'python'),
    sql: pipelines.filter(p => p.type === 'sql'),
  }), [pipelines])

  const load = async (preferredName?: string) => {
    if (!workspace) return
    setLoading(true)
    setError('')
    try {
      const [items, pipelineItems] = await Promise.all([
        orchestrationApi.list(),
        pipeApi.list(),
      ])
      setOrchestrations(items)
      setPipelines(pipelineItems)

      const next = items.find(item => item.name === preferredName)
        ?? items.find(item => item.name === selectedName)
        ?? items[0]

      if (next) {
        openDraft(next)
      } else {
        startNew()
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspace])

  const startNew = () => {
    setSelectedName('')
    setIsNew(true)
    setName('')
    setDescription('')
    setSteps([])
    setTriggers([])
    setRunResult(null)
    setMessage('')
    setError('')
  }

  const openDraft = (item: Orchestration) => {
    setSelectedName(item.name)
    setIsNew(false)
    setName(item.name)
    setDescription(item.description ?? '')
    setSteps(item.steps ?? [])
    setTriggers(normalizeTriggers(item.triggers ?? []))
    setRunResult(null)
    setMessage('')
    setError('')
  }

  const handleSelect = (value: string) => {
    const item = orchestrations.find(o => o.name === value)
    if (item) openDraft(item)
  }

  const addStep = (pipeline: Pipeline) => {
    setSteps(prev => [...prev, { name: pipeline.name, type: pipeline.type }])
    setMessage('')
  }

  const addTrigger = (type: OrchestrationTrigger['type']) => {
    setTriggers(prev => [...prev, defaultTrigger(type)])
    setMessage('')
  }

  const updateTrigger = (index: number, patch: Partial<OrchestrationTrigger>) => {
    setTriggers(prev => prev.map((trigger, i) => (i === index ? { ...trigger, ...patch } : trigger)))
  }

  const removeTrigger = (index: number) => {
    setTriggers(prev => prev.filter((_, i) => i !== index))
  }

  const removeStep = (index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    setSteps(prev => {
      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const save = async () => {
    setError('')
    setMessage('')
    const cleanName = name.trim()
    if (!cleanName) { setError('Name the orchestration first.'); return null }
    if (steps.length === 0) { setError('Add at least one pipeline block.'); return null }

    setSaving(true)
    try {
      const payload = { name: cleanName, description: description.trim(), steps, triggers }
      const saved = isNew
        ? await orchestrationApi.create(payload)
        : await orchestrationApi.update(selectedName, payload)
      setMessage('Saved.')
      setIsNew(false)
      setSelectedName(saved.name)
      await load(saved.name)
      return saved.name
    } catch (e) {
      setError(errMsg(e))
      return null
    } finally {
      setSaving(false)
    }
  }

  const run = async () => {
    setError('')
    setMessage('')
    const runName = isNew ? await save() : selectedName
    if (!runName) return
    setRunning(true)
    setRunResult(null)
    try {
      const result = await orchestrationApi.run(runName)
      setRunResult(result)
      setMessage(result.status === 'success' ? 'Run completed.' : 'Run failed.')
      await load(runName)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setRunning(false)
    }
  }

  const deleteCurrent = async () => {
    if (isNew || !selectedName) return
    if (!confirm(`Delete orchestration "${selectedName}"?`)) return
    try {
      await orchestrationApi.delete(selectedName)
      await load()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  if (!workspace) return (
    <div>
      <div className="page-header"><h1>Orchestrations</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
    </div>
  )

  return (
    <div className="orchestration-page">
      <div className="page-header">
        <h1>Orchestrations</h1>
        <p>Build and run a pipeline flow.</p>
      </div>

      <div className="page-body orchestration-body">
        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className={message.includes('failed') ? 'alert alert-error' : 'alert alert-success'}>{message}</div>}

        <div className="orchestration-shell">
          <aside className="orchestration-side">
            <div className="orchestration-side-header">
              <span>Flows</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={startNew}>New</button>
            </div>

            {orchestrations.length > 0 ? (
              <select value={selectedName} onChange={e => handleSelect(e.target.value)}>
                {orchestrations.map(item => (
                  <option key={item.name} value={item.name}>{item.name}</option>
                ))}
              </select>
            ) : (
              <div className="orchestration-empty-note">No saved flows yet.</div>
            )}

            <div className="orchestration-side-header" style={{ marginTop: 18 }}>
              <span>Pipelines</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => load(selectedName)}>Refresh</button>
            </div>

            {loading ? (
              <div className="orchestration-empty-note">Loading...</div>
            ) : pipelines.length === 0 ? (
              <div className="orchestration-empty-note">Create a pipeline first.</div>
            ) : (
              <>
                <PipelineGroup title="Python" items={pipelineGroups.python} onAdd={addStep} />
                <PipelineGroup title="SQL" items={pipelineGroups.sql} onAdd={addStep} />
              </>
            )}
          </aside>

          <main className="orchestration-workspace">
            <div className="orchestration-topbar">
              <div className="orchestration-fields">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="daily_load"
                  disabled={!isNew}
                  className="orchestration-name-input"
                />
                <input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Description"
                />
              </div>
              <div className="orchestration-actions">
                <button type="button" className="btn btn-secondary" onClick={save} disabled={saving || running}>
                  {saving ? <span className="spinner" /> : 'Save'}
                </button>
                <button type="button" className="btn btn-success" onClick={run} disabled={saving || running || steps.length === 0}>
                  {running ? <span className="spinner" /> : 'Run'}
                </button>
                <button type="button" className="btn btn-danger" onClick={deleteCurrent} disabled={isNew || running}>Delete</button>
              </div>
            </div>

            <section className="trigger-panel">
              <div className="trigger-panel-head">
                <div>
                  <strong>Triggers</strong>
                  <div className="trigger-panel-note">Manual runs stay available from the Run button. Scheduled triggers fire automatically while the app is running.</div>
                </div>
                <div className="trigger-panel-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => addTrigger('interval')}>Add interval</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => addTrigger('daily')}>Add daily</button>
                </div>
              </div>

              {triggers.length === 0 ? (
                <div className="trigger-empty">No scheduled triggers configured.</div>
              ) : (
                <div className="trigger-list">
                  {triggers.map((trigger, index) => (
                    <TriggerEditor
                      key={trigger.id ?? `${trigger.type}-${index}`}
                      trigger={trigger}
                      index={index}
                      onChange={patch => updateTrigger(index, patch)}
                      onRemove={() => removeTrigger(index)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="flow-canvas">
              {steps.length === 0 ? (
                <div className="flow-empty">
                  <div className="flow-empty-title">Start by adding a pipeline</div>
                  <div>Click a pipeline on the left. Blocks run from left to right.</div>
                </div>
              ) : (
                <div className="flow-row">
                  {steps.map((step, index) => (
                    <FlowBlock
                      key={`${step.type}/${step.name}/${index}`}
                      step={step}
                      index={index}
                      total={steps.length}
                      runStep={runResult?.steps.find(s => s.index === index + 1)}
                      onMove={moveStep}
                      onRemove={removeStep}
                    />
                  ))}
                </div>
              )}
            </section>

            {runResult && (
              <section className="run-summary">
                <div className="run-summary-header">
                  <strong>Last run</strong>
                  <span className={`badge badge-${runResult.status}`}>{runResult.status}</span>
                  {runResult.duration_seconds != null && <span className="tag">{runResult.duration_seconds}s</span>}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Pipeline</th>
                        <th>Status</th>
                        <th>Run ID</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runResult.steps.map(step => (
                        <tr key={step.index}>
                          <td>{step.index}</td>
                          <td><strong>{step.type}/{step.name}</strong></td>
                          <td><span className={`badge badge-${step.status}`}>{step.status}</span></td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{step.run_id ?? '-'}</td>
                          <td style={{ color: 'var(--text-muted)' }}>
                            {step.duration_seconds != null ? `${step.duration_seconds}s` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

function PipelineGroup({
  title,
  items,
  onAdd,
}: {
  title: string
  items: Pipeline[]
  onAdd: (pipeline: Pipeline) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="pipeline-group">
      <div className="pipeline-group-title">{title}</div>
      {items.map(item => (
        <button type="button" key={`${item.type}/${item.name}`} className="pipeline-tool" onClick={() => onAdd(item)}>
          <span className={`badge badge-${item.type}`}>{item.type}</span>
          <span>{item.name}</span>
        </button>
      ))}
    </div>
  )
}

function FlowBlock({
  step,
  index,
  total,
  runStep,
  onMove,
  onRemove,
}: {
  step: OrchestrationStep
  index: number
  total: number
  runStep?: { status?: string }
  onMove: (index: number, direction: -1 | 1) => void
  onRemove: (index: number) => void
}) {
  const status = runStep?.status
  return (
    <>
      <div className={`flow-block ${status ? `flow-block-${status}` : ''}`}>
        <div className="flow-block-top">
          <span className="tag">Step {index + 1}</span>
          <span className={`badge badge-${step.type}`}>{step.type}</span>
        </div>
        <div className="flow-block-name">{step.name}</div>
        {status && <span className={`badge badge-${status}`}>{status}</span>}
        <div className="flow-block-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMove(index, -1)} disabled={index === 0}>Left</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMove(index, 1)} disabled={index === total - 1}>Right</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => onRemove(index)}>Remove</button>
        </div>
      </div>
      {index < total - 1 && <div className="flow-arrow">-&gt;</div>}
    </>
  )
}

function TriggerEditor({
  trigger,
  index,
  onChange,
  onRemove,
}: {
  trigger: OrchestrationTrigger
  index: number
  onChange: (patch: Partial<OrchestrationTrigger>) => void
  onRemove: () => void
}) {
  return (
    <div className="trigger-card">
      <div className="trigger-card-head">
        <div className="trigger-card-title">
          <span className="tag">Trigger {index + 1}</span>
          <span className={`badge badge-${trigger.type === 'daily' ? 'running' : 'python'}`}>{trigger.type}</span>
        </div>
        <div className="trigger-card-actions">
          <label className="trigger-toggle">
            <input
              type="checkbox"
              checked={trigger.enabled}
              onChange={e => onChange({ enabled: e.target.checked })}
            />
            Enabled
          </label>
          <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>Remove</button>
        </div>
      </div>

      {trigger.type === 'interval' ? (
        <div className="trigger-fields">
          <div className="form-group">
            <label>Every minutes</label>
            <input
              type="number"
              min={1}
              value={trigger.every_minutes ?? 60}
              onChange={e => onChange({ every_minutes: Number(e.target.value) })}
            />
          </div>
        </div>
      ) : (
        <div className="trigger-fields">
          <div className="form-group">
            <label>Daily at</label>
            <input
              type="time"
              value={trigger.at_time ?? '08:00'}
              onChange={e => onChange({ at_time: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function defaultTrigger(type: OrchestrationTrigger['type']): OrchestrationTrigger {
  return type === 'daily'
    ? { id: makeId(), type, enabled: true, at_time: '08:00' }
    : { id: makeId(), type, enabled: true, every_minutes: 60 }
}

function normalizeTriggers(triggers: OrchestrationTrigger[]): OrchestrationTrigger[] {
  if (!triggers.length) return []
  return triggers.map(trigger => ({
    id: trigger.id ?? makeId(),
    type: trigger.type,
    enabled: trigger.enabled ?? true,
    every_minutes: trigger.every_minutes ?? (trigger.type === 'interval' ? 60 : null),
    at_time: trigger.at_time ?? (trigger.type === 'daily' ? '08:00' : null),
    last_fired_at: trigger.last_fired_at ?? null,
  }))
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `trigger_${Math.random().toString(36).slice(2)}`
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'Error'
  }
  return String(e)
}
