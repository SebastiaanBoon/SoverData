import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  connApi,
  Connection,
  orchestrationApi,
  Orchestration,
  OrchestrationEdge,
  OrchestrationNode,
  OrchestrationRun,
  OrchestrationTrigger,
  Pipeline,
  pipeApi,
  queryApi,
  QueryResult,
} from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

type StageKey = 'bronze' | 'silver' | 'gold'
type StageActivity = { value: string; retries: number }
type ConnectionType = 'postgres' | 'mysql' | 'mssql'

const STAGES: Array<{ key: StageKey; title: string; description: string }> = [
  { key: 'bronze', title: 'Run Bronze', description: 'Load raw data exactly as it arrives.' },
  { key: 'silver', title: 'Run Silver', description: 'Clean, join, and model Bronze data.' },
  { key: 'gold', title: 'Run Gold', description: 'Create reporting-ready tables.' },
]

const EMPTY_STAGE_ACTIVITIES: Record<StageKey, StageActivity[]> = { bronze: [], silver: [], gold: [] }

export default function OrchestrationsPage() {
  const { workspace } = useWorkspace()
  if (!workspace) {
    return (
      <div>
        <div className="page-header"><h1>Flow</h1></div>
        <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
      </div>
    )
  }
  return <StandardPipelinePage />
}

function StandardPipelinePage() {
  const [flows, setFlows] = useState<Orchestration[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedName, setSelectedName] = useState('')
  const [isNew, setIsNew] = useState(true)
  const [flowName, setFlowName] = useState('standard_pipeline')
  const [description, setDescription] = useState('Bronze to Silver to Gold')
  const [stageActivities, setStageActivities] = useState<Record<StageKey, StageActivity[]>>(EMPTY_STAGE_ACTIVITIES)
  const [triggers, setTriggers] = useState<OrchestrationTrigger[]>([])
  const [runResult, setRunResult] = useState<OrchestrationRun | null>(null)
  const [activityModal, setActivityModal] = useState<{ stage: StageKey; type: 'python' | 'sql' } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async (preferName?: string) => {
    setLoading(true)
    setError('')
    try {
      const [nextFlows, nextPipelines] = await Promise.all([orchestrationApi.list(), pipeApi.list()])
      setFlows(nextFlows)
      setPipelines(nextPipelines)
      const next = nextFlows.find(flow => flow.name === preferName)
        ?? nextFlows.find(flow => flow.name === selectedName)
        ?? nextFlows.find(flow => flow.name === 'standard_pipeline')
        ?? nextFlows[0]
      if (next) applyFlow(next)
      else startNew()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [selectedName])

  useEffect(() => { load() }, [])

  const pipelineMap = useMemo(() => {
    const map: Record<string, Pipeline> = {}
    for (const pipeline of pipelines) map[pipelineValue(pipeline)] = pipeline
    return map
  }, [pipelines])

  const applyFlow = (flow: Orchestration) => {
    setSelectedName(flow.name)
    setIsNew(false)
    setFlowName(flow.name)
    setDescription(flow.description ?? '')
    setStageActivities(nodesToStages(flow.nodes ?? []))
    setTriggers(normalizeTriggers(flow.triggers ?? []))
    setRunResult(null)
    setMessage('')
    setError('')
  }

  const startNew = () => {
    setSelectedName('')
    setIsNew(true)
    setFlowName('standard_pipeline')
    setDescription('Bronze to Silver to Gold')
    setStageActivities({ ...EMPTY_STAGE_ACTIVITIES })
    setTriggers([])
    setRunResult(null)
    setMessage('')
    setError('')
  }

  const addExistingActivity = (stage: StageKey, value: string) => {
    if (!value) return
    setStageActivities(prev => ({
      ...prev,
      [stage]: prev[stage].some(item => item.value === value) ? prev[stage] : [...prev[stage], { value, retries: 1 }],
    }))
  }

  const removeActivity = (stage: StageKey, value: string) => {
    setStageActivities(prev => ({ ...prev, [stage]: prev[stage].filter(item => item.value !== value) }))
  }

  const updateActivityRetries = (stage: StageKey, value: string, retries: number) => {
    setStageActivities(prev => ({
      ...prev,
      [stage]: prev[stage].map(item => item.value === value ? { ...item, retries } : item),
    }))
  }

  const moveActivity = (stage: StageKey, value: string, direction: -1 | 1) => {
    setStageActivities(prev => {
      const items = [...prev[stage]]
      const index = items.findIndex(item => item.value === value)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return prev
      const [item] = items.splice(index, 1)
      items.splice(nextIndex, 0, item)
      return { ...prev, [stage]: items }
    })
  }

  const save = async (): Promise<string | null> => {
    setError('')
    setMessage('')
    const name = flowName.trim()
    if (!name) {
      setError('Give the pipeline a name.')
      return null
    }

    const selected = flattenStages(stageActivities)
    if (selected.length === 0) {
      setError('Add at least one activity to Bronze, Silver, or Gold.')
      return null
    }

    const nodes: OrchestrationNode[] = []
    for (const item of selected) {
      const pipeline = pipelineMap[item.value]
      if (!pipeline) continue
      nodes.push({
        id: `${item.stage}_${item.stageIndex + 1}`,
        name: pipeline.name,
        type: pipeline.type,
        x: 120 + nodes.length * 240,
        y: 140,
        retries: item.activity.retries,
      })
    }

    if (nodes.length === 0) {
      setError('The selected activities no longer exist. Add activities again.')
      return null
    }

    const edges: OrchestrationEdge[] = nodes.slice(0, -1).map((node, index) => ({
      id: `${node.id}->${nodes[index + 1].id}`,
      source: node.id,
      target: nodes[index + 1].id,
      condition: 'success',
    }))

    setSaving(true)
    try {
      const payload = {
        name,
        description: description.trim(),
        retries: 0,
        nodes,
        edges,
        steps: [],
        triggers,
      }
      const saved = isNew
        ? await orchestrationApi.create(payload)
        : await orchestrationApi.update(selectedName, payload)
      setSelectedName(saved.name)
      setIsNew(false)
      setMessage('Pipeline saved.')
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
    const runName = await save()
    if (!runName) return
    setRunning(true)
    setError('')
    setMessage('')
    setRunResult(null)
    try {
      const result = await orchestrationApi.run(runName)
      setRunResult(result)
      setMessage(result.status === 'success' ? 'Pipeline completed.' : 'Pipeline finished with failures.')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setRunning(false)
    }
  }

  const deleteCurrent = async () => {
    if (isNew || !selectedName) return
    if (!confirm(`Delete pipeline "${selectedName}"?`)) return
    try {
      await orchestrationApi.delete(selectedName)
      await load()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const addTrigger = (type: OrchestrationTrigger['type']) => setTriggers(prev => [...prev, defaultTrigger(type)])
  const updateTrigger = (index: number, patch: Partial<OrchestrationTrigger>) =>
    setTriggers(prev => prev.map((trigger, i) => i === index ? { ...trigger, ...patch } : trigger))
  const removeTrigger = (index: number) => setTriggers(prev => prev.filter((_, i) => i !== index))

  const handleActivityCreated = async (stage: StageKey, pipeline: Pipeline) => {
    const value = pipelineValue(pipeline)
    setPipelines(prev => {
      const withoutExisting = prev.filter(item => pipelineValue(item) !== value)
      return [...withoutExisting, pipeline].sort((a, b) => a.name.localeCompare(b.name))
    })
    setStageActivities(prev => ({ ...prev, [stage]: [...prev[stage], { value, retries: 1 }] }))
    setActivityModal(null)
  }

  return (
    <div className="standard-flow-page">
      <div className="page-header">
        <h1>Flow</h1>
        <p>Standard pipeline: Run Bronze, then Silver, then Gold.</p>
      </div>
      <div className="page-body standard-flow-body">
        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className={message.includes('fail') ? 'alert alert-error' : 'alert alert-success'}>{message}</div>}

        <section className="std-panel std-controls">
          <div className="form-group">
            <label>Pipeline</label>
            <select value={selectedName} onChange={e => {
              const flow = flows.find(item => item.name === e.target.value)
              if (flow) applyFlow(flow)
            }}>
              {flows.length === 0 && <option value="">Standard pipeline</option>}
              {flows.map(flow => <option key={flow.name} value={flow.name}>{flow.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Name</label>
            <input value={flowName} onChange={e => setFlowName(e.target.value)} disabled={!isNew} />
          </div>
          <div className="std-actions">
            <button className="btn btn-secondary" onClick={startNew} disabled={saving || running}>New</button>
            <button className="btn btn-secondary" onClick={save} disabled={saving || running}>{saving ? <span className="spinner" /> : 'Save'}</button>
            <button className="btn btn-success" onClick={run} disabled={saving || running}>{running ? <span className="spinner" /> : 'Run'}</button>
            <button className="btn btn-danger" onClick={deleteCurrent} disabled={isNew || running}>Delete</button>
          </div>
        </section>

        <section className="std-panel">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} />
          </div>
        </section>

        <section className="std-stages">
          {STAGES.map(stage => (
            <StageCard
              key={stage.key}
              stage={stage.key}
              title={stage.title}
              description={stage.description}
              activities={stageActivities[stage.key]}
              pipelines={pipelines}
              onAddExisting={value => addExistingActivity(stage.key, value)}
              onCreate={type => setActivityModal({ stage: stage.key, type })}
              onRemove={value => removeActivity(stage.key, value)}
              onRetryChange={(value, retries) => updateActivityRetries(stage.key, value, retries)}
              onMove={(value, direction) => moveActivity(stage.key, value, direction)}
            />
          ))}
        </section>

        <section className="std-panel">
          <div className="std-section-head">
            <div>
              <h2>Schedule</h2>
              <p>Optional. Leave empty for manual runs.</p>
            </div>
            <div className="std-inline-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => addTrigger('daily')}>Daily</button>
              <button className="btn btn-secondary btn-sm" onClick={() => addTrigger('interval')}>Interval</button>
            </div>
          </div>
          {triggers.length === 0 ? (
            <div className="std-empty">No schedule set.</div>
          ) : (
            <div className="std-trigger-list">
              {triggers.map((trigger, index) => (
                <TriggerRow
                  key={trigger.id ?? index}
                  trigger={trigger}
                  onChange={patch => updateTrigger(index, patch)}
                  onRemove={() => removeTrigger(index)}
                />
              ))}
            </div>
          )}
        </section>

        {runResult && <RunResultPanel run={runResult} />}
        {loading && <div className="std-empty">Loading...</div>}

        {activityModal && (
          <ActivityModal
            stage={activityModal.stage}
            type={activityModal.type}
            onClose={() => setActivityModal(null)}
            onCreated={pipeline => handleActivityCreated(activityModal.stage, pipeline)}
          />
        )}
      </div>
    </div>
  )
}

function StageCard({ stage, title, description, activities, pipelines, onAddExisting, onCreate, onRemove, onRetryChange, onMove }: {
  stage: StageKey
  title: string
  description: string
  activities: StageActivity[]
  pipelines: Pipeline[]
  onAddExisting: (value: string) => void
  onCreate: (type: 'python' | 'sql') => void
  onRemove: (value: string) => void
  onRetryChange: (value: string, retries: number) => void
  onMove: (value: string, direction: -1 | 1) => void
}) {
  const available = pipelines.filter(pipeline => !activities.some(activity => activity.value === pipelineValue(pipeline)))
  return (
    <div className={`std-stage std-stage-${stage}`}>
      <div className="std-stage-head">
        <div>
          <span className={`badge badge-${stage}`}>{stage}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="std-stage-buttons">
          <button className="btn btn-secondary btn-sm" onClick={() => onCreate('python')}>Python</button>
          <button className="btn btn-primary btn-sm" onClick={() => onCreate('sql')}>SQL</button>
        </div>
      </div>

      <div className="std-add-existing">
        <select defaultValue="" onChange={e => { onAddExisting(e.target.value); e.currentTarget.value = '' }}>
          <option value="">Add existing activity</option>
          {available.map(pipeline => (
            <option key={`${stage}-${pipelineValue(pipeline)}`} value={pipelineValue(pipeline)}>
              {pipeline.name} ({pipeline.type})
            </option>
          ))}
        </select>
      </div>

      {activities.length === 0 ? (
        <div className="std-empty">No activities yet. Add Python or SQL.</div>
      ) : (
        <div className="std-activity-list">
          {activities.map((activity, index) => {
            const pipeline = pipelines.find(item => pipelineValue(item) === activity.value)
            return (
              <div key={activity.value} className="std-activity">
                <div className="std-activity-index">{index + 1}</div>
                <div>
                  <strong>{pipeline?.name ?? activity.value}</strong>
                  <span>{pipeline?.type ?? 'missing'}</span>
                </div>
                <label className="std-activity-retry">
                  Retry
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={activity.retries}
                    onChange={e => onRetryChange(activity.value, Number(e.target.value))}
                  />
                </label>
                <div className="std-activity-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => onMove(activity.value, -1)} disabled={index === 0}>Up</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => onMove(activity.value, 1)} disabled={index === activities.length - 1}>Down</button>
                  <button className="btn btn-danger btn-sm" onClick={() => onRemove(activity.value)}>Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ActivityModal({ stage, type, onClose, onCreated }: {
  stage: StageKey
  type: 'python' | 'sql'
  onClose: () => void
  onCreated: (pipeline: Pipeline) => void
}) {
  const [name, setName] = useState(`${stage}_${type}_activity`)
  const [code, setCode] = useState(type === 'python' ? defaultPython(stage) : defaultSql(stage))
  const [targetTable, setTargetTable] = useState('new_table')
  const [connections, setConnections] = useState<Connection[]>([])
  const [connection, setConnection] = useState('')
  const [showConnectionForm, setShowConnectionForm] = useState(false)
  const [connectionForm, setConnectionForm] = useState(defaultConnectionForm())
  const [connectionTest, setConnectionTest] = useState<{ status: string; message: string } | null>(null)
  const [connectionSaving, setConnectionSaving] = useState(false)
  const [connectionTesting, setConnectionTesting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (type === 'sql') connApi.list().then(setConnections).catch(() => setConnections([]))
  }, [type])

  const saveConnection = async () => {
    setError('')
    setConnectionTest(null)
    if (!connectionForm.name.trim()) {
      setError('Connection name is required.')
      return
    }
    setConnectionSaving(true)
    try {
      const payload = connectionPayload(connectionForm)
      const saved = await connApi.create(payload)
      const next = await connApi.list()
      setConnections(next)
      setConnection(saved.name)
      setShowConnectionForm(false)
      setConnectionForm(defaultConnectionForm())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setConnectionSaving(false)
    }
  }

  const testConnection = async () => {
    setError('')
    setConnectionTest(null)
    setConnectionTesting(true)
    try {
      const result = await connApi.testDraft(connectionPayload(connectionForm))
      setConnectionTest(result)
    } catch (e) {
      setConnectionTest({ status: 'error', message: errMsg(e) })
    } finally {
      setConnectionTesting(false)
    }
  }

  const saveActivity = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (type === 'sql' && /SELECT\s+\*/i.test(code)) {
      setError('Name the columns. SELECT * is not allowed.')
      return
    }
    if (type === 'sql' && !targetTable.trim()) {
      setError('Output table is required.')
      return
    }
    setSaving(true)
    try {
      const finalCode = type === 'sql'
        ? setDirective(setDirective(code, 'target', `${stage}.${cleanName(targetTable)}`), 'connection', connection)
        : code
      const pipeline = await pipeApi.create({ name: name.trim(), type, code: finalCode })
      onCreated({ ...pipeline, name: name.trim(), type })
    } catch (e2) {
      setError(errMsg(e2))
    } finally {
      setSaving(false)
    }
  }

  const testSql = async () => {
    setTesting(true)
    setError('')
    setTestResult(null)
    try {
      const finalCode = setDirective(code, 'connection', connection)
      const result = connection
        ? await connApi.query(connection, finalCode, 50)
        : await queryApi.execute(finalCode, 50)
      setTestResult(result)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
        <h2>{type === 'python' ? 'Python activity' : 'SQL activity'} for {stage}</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={saveActivity}>
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} required />
            </div>
            {type === 'sql' && (
              <div className="form-group">
                <label>External connection</label>
                <select value={showConnectionForm ? '__new__' : connection} onChange={e => {
                  if (e.target.value === '__new__') {
                    setConnection('')
                    setShowConnectionForm(true)
                    setConnectionTest(null)
                  } else {
                    setConnection(e.target.value)
                    setShowConnectionForm(false)
                    setConnectionTest(null)
                  }
                }}>
                  <option value="">No external connection</option>
                    {connections.filter(item => ['postgres', 'mysql', 'mssql'].includes(item.type)).length > 0 && (
                    <optgroup label="Saved connections">
                      {connections.filter(item => ['postgres', 'mysql', 'mssql'].includes(item.type)).map(item => (
                        <option key={item.name} value={item.name}>{item.name} ({connectionTypeLabel(item.type)})</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Connection setup">
                    <option value="__new__">Add new connection...</option>
                  </optgroup>
                </select>
              </div>
            )}
            {type === 'sql' && (
              <div className="form-group">
                <label>Run query in</label>
                <input
                  value={connection ? `External database: ${connection}` : 'Lakehouse'}
                  disabled
                />
              </div>
            )}
            {type === 'sql' && (
              <div className="form-group">
                <label>Output table</label>
                <input value={targetTable} onChange={e => setTargetTable(e.target.value)} placeholder="new_table" />
              </div>
            )}
          </div>
          {type === 'sql' && showConnectionForm && (
            <div className="inline-connection-form">
              <div className="std-section-head">
                <div>
                  <h2>New connection</h2>
                  <p>Saved in the workspace. Secret fields are hidden after saving.</p>
                </div>
                {connectionTest && (
                  <span className={`badge badge-${connectionTest.status === 'ok' ? 'success' : 'failed'}`} title={connectionTest.message}>
                    {connectionTest.status}
                  </span>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Name</label>
                  <input value={connectionForm.name} onChange={e => setConnectionForm(prev => ({ ...prev, name: cleanOptionalName(e.target.value) }))} placeholder="source_database" />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select value={connectionForm.type} onChange={e => setConnectionForm(prev => ({ ...prev, type: e.target.value as ConnectionType }))}>
                    <option value="postgres">Postgres</option>
                    <option value="mysql">MySQL</option>
                    <option value="mssql">SQL Server</option>
                  </select>
                </div>
              </div>
              {['postgres', 'mysql', 'mssql'].includes(connectionForm.type) ? (
                <div className="form-group">
                  <label>Connection string</label>
                  <input
                    type="password"
                    value={connectionForm.connectionString}
                    onChange={e => setConnectionForm(prev => ({ ...prev, connectionString: e.target.value }))}
                    placeholder={connectionStringPlaceholder(connectionForm.type)}
                  />
                </div>
              ) : null}
              <div className="form-group">
                <label>Description</label>
                <input value={connectionForm.description} onChange={e => setConnectionForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Optional" />
              </div>
              {connectionTest && <div className={connectionTest.status === 'ok' ? 'alert alert-success' : 'alert alert-error'}>{connectionTest.message}</div>}
              <div className="std-inline-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={testConnection} disabled={connectionTesting}>
                  {connectionTesting ? <span className="spinner" /> : 'Test connection'}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={saveConnection} disabled={connectionSaving}>
                  {connectionSaving ? <span className="spinner" /> : 'Save connection'}
                </button>
              </div>
            </div>
          )}
          <div className="form-group">
            <label>Script</label>
            <textarea
              value={code}
              onChange={e => { setCode(e.target.value); setTestResult(null) }}
              rows={14}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}
            />
          </div>
          {type === 'sql' && (
            <>
              <div className="toolbar" style={{ marginBottom: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={testSql} disabled={testing}>
                  {testing ? <span className="spinner" /> : 'Test SQL'}
                </button>
              </div>
              {testResult && <SqlPreview result={testResult} />}
            </>
          )}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <span className="spinner" /> : 'Add activity'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SqlPreview({ result }: { result: QueryResult }) {
  return (
    <div className="act-test-result">
      <div className="act-test-result-head">
        <span className="badge badge-success">Query OK</span>
        <span className="act-test-rows">{result.row_count} rows / {result.columns.length} columns</span>
      </div>
      {result.columns.length > 0 && (
        <div className="act-test-table-wrap">
          <table>
            <thead><tr>{result.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {result.rows.slice(0, 50).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => <td key={j} className="act-test-cell">{cell == null ? <span className="act-null">null</span> : String(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TriggerRow({ trigger, onChange, onRemove }: {
  trigger: OrchestrationTrigger
  onChange: (patch: Partial<OrchestrationTrigger>) => void
  onRemove: () => void
}) {
  return (
    <div className={!trigger.enabled ? 'std-trigger std-trigger-muted' : 'std-trigger'}>
      <label>
        <input type="checkbox" checked={trigger.enabled} onChange={e => onChange({ enabled: e.target.checked })} />
        Enabled
      </label>
      <span className="tag">{trigger.type}</span>
      {trigger.type === 'daily' ? (
        <input type="time" value={trigger.at_time ?? '08:00'} onChange={e => onChange({ at_time: e.target.value })} />
      ) : (
        <input type="number" min={1} value={trigger.every_minutes ?? 60} onChange={e => onChange({ every_minutes: Number(e.target.value) })} />
      )}
      <button className="btn btn-danger btn-sm" onClick={onRemove}>Remove</button>
    </div>
  )
}

function RunResultPanel({ run }: { run: OrchestrationRun }) {
  return (
    <section className="std-panel">
      <div className="std-section-head">
        <div>
          <h2>Latest run</h2>
          <p>Activity attempts are shown per row.</p>
        </div>
        <span className={`badge badge-${run.status}`}>{run.status}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Activity</th><th>Status</th><th>Attempts</th><th>Duration</th><th>Note</th></tr></thead>
          <tbody>
            {(run.steps ?? []).map((step, index) => (
              <tr key={step.node_id ?? index}>
                <td><strong>{step.name}</strong></td>
                <td><span className={`badge badge-${step.status}`}>{step.status}</span></td>
                <td style={{ color: 'var(--text-muted)' }}>{step.attempts ?? 0}/{(step.retries ?? 0) + 1}</td>
                <td style={{ color: 'var(--text-muted)' }}>{step.duration_seconds != null ? `${step.duration_seconds}s` : '-'}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{step.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function flattenStages(stages: Record<StageKey, StageActivity[]>) {
  return STAGES.flatMap(stage => stages[stage.key].map((activity, stageIndex) => ({ stage: stage.key, activity, value: activity.value, stageIndex })))
}

function nodesToStages(nodes: OrchestrationNode[]): Record<StageKey, StageActivity[]> {
  const result: Record<StageKey, StageActivity[]> = { bronze: [], silver: [], gold: [] }
  nodes.forEach((node, index) => {
    const stage = STAGES.find(item => node.id.startsWith(`${item.key}_`))?.key ?? STAGES[Math.min(index, 2)].key
    result[stage].push({ value: nodeValue(node), retries: node.retries ?? 1 })
  })
  return result
}

function nodeValue(node: OrchestrationNode): string {
  return `${node.type}/${node.name}`
}

function pipelineValue(pipeline: Pick<Pipeline, 'type' | 'name'>): string {
  return `${pipeline.type}/${pipeline.name}`
}

function defaultPython(stage: StageKey): string {
  return `import os
from pathlib import Path
import pandas as pd
from server.engine.lakehouse import write_table

workspace = Path(os.environ.get("SOVERDATA_WORKSPACE", "."))
lakehouse = Path(os.environ.get("SOVERDATA_LAKEHOUSE", workspace / "lakehouse"))

df = pd.DataFrame({
    "id": [1, 2, 3],
    "value": [100, 200, 300],
})

out_file = write_table(df, lakehouse, "${stage}", "new_table")
print(f"Written {len(df)} rows to {out_file}")
`
}

function defaultSql(stage: StageKey): string {
  const source = stage === 'bronze' ? 'source_table' : stage === 'silver' ? 'bronze.new_table' : 'silver.new_table'
  return `SELECT
    id,
    value
FROM ${source}
LIMIT 100;
`
}

function setDirective(code: string, key: string, value: string): string {
  const regex = new RegExp(`^\\s*--\\s*${key}\\s*:[^\\n]*\\n?`, 'gim')
  const line = value ? `-- ${key}: ${value}\n` : ''
  if (regex.test(code)) return value ? code.replace(regex, line) : code.replace(regex, '')
  return value ? `${line}${code}` : code
}

function cleanName(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'new_table'
}

function cleanOptionalName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
}

function defaultConnectionForm() {
  return {
    name: '',
    type: 'postgres' as ConnectionType,
    description: '',
    connectionString: '',
  }
}

function connectionPayload(form: ReturnType<typeof defaultConnectionForm>) {
  return {
    name: cleanOptionalName(form.name),
    type: form.type,
    description: form.description,
    config: { connection_string: form.connectionString },
  }
}

function connectionStringPlaceholder(type: ConnectionType): string {
  if (type === 'postgres') return 'postgresql://user:password@host:5432/database'
  if (type === 'mysql') return 'mysql+pymysql://user:password@host:3306/database'
  if (type === 'mssql') return 'mssql+pyodbc://user:password@server/database?driver=ODBC+Driver+17+for+SQL+Server'
  return ''
}

function connectionTypeLabel(type: string): string {
  if (type === 'mssql') return 'SQL Server'
  if (type === 'postgres') return 'Postgres'
  if (type === 'mysql') return 'MySQL'
  return type
}

function defaultTrigger(type: OrchestrationTrigger['type']): OrchestrationTrigger {
  const id = makeId()
  if (type === 'daily') return { id, type, enabled: true, at_time: '08:00' }
  return { id, type: 'interval', enabled: true, every_minutes: 60 }
}

function normalizeTriggers(triggers: OrchestrationTrigger[]): OrchestrationTrigger[] {
  return triggers.map(trigger => ({
    id: trigger.id ?? makeId(),
    type: trigger.type,
    enabled: trigger.enabled ?? true,
    every_minutes: trigger.every_minutes ?? null,
    at_time: trigger.at_time ?? null,
    last_fired_at: trigger.last_fired_at ?? null,
  }))
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response
    return r?.data?.detail ?? 'Error'
  }
  return String(e)
}
