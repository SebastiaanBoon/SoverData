import { useCallback, useEffect, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Connection,
  MarkerType,
  Node,
  Edge,
  NodeProps,
  EdgeProps,
  Handle,
  Position,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from 'reactflow'
import 'reactflow/dist/style.css'

import {
  orchestrationApi,
  OrchestrationNode,
  OrchestrationEdge,
  OrchestrationTrigger,
  pipeApi,
  Pipeline,
} from '../api/client'
import type { Orchestration, OrchestrationRun } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'

// ── Edge conditions ───────────────────────────────────────────────

type Condition = 'success' | 'failure' | 'completion'

const CONDITION_CONFIG: Record<Condition, { color: string; label: string; title: string }> = {
  success:    { color: '#22c55e', label: '✓',  title: 'On success — runs when upstream succeeds' },
  failure:    { color: '#ef4444', label: '✗',  title: 'On failure — runs when upstream fails' },
  completion: { color: '#94a3b8', label: '◎',  title: 'On completion — always runs after upstream' },
}

const CONDITION_CYCLE: Condition[] = ['success', 'failure', 'completion']

// ── Custom edge with clickable condition badge ────────────────────

interface ConditionEdgeData { condition: Condition; onCycle: (id: string) => void }

function ConditionEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
}: EdgeProps<ConditionEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const condition: Condition = data?.condition ?? 'success'
  const cfg = CONDITION_CONFIG[condition]

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: cfg.color, strokeWidth: selected ? 3 : 2, transition: 'stroke-width 0.1s' }}
        markerEnd={`url(#marker-${condition})`}
      />
      <EdgeLabelRenderer>
        <button
          className="edge-condition-btn"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, background: cfg.color }}
          title={cfg.title}
          onClick={() => data?.onCycle(id)}
        >
          {cfg.label}
        </button>
      </EdgeLabelRenderer>
    </>
  )
}

// SVG marker defs (injected once into the DOM)
function EdgeMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        {CONDITION_CYCLE.map(c => (
          <marker key={c} id={`marker-${c}`} markerWidth="10" markerHeight="10"
            refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill={CONDITION_CONFIG[c].color} />
          </marker>
        ))}
      </defs>
    </svg>
  )
}

// ── Pipeline node ─────────────────────────────────────────────────

interface NodeData {
  label: string
  pipelineType: 'python' | 'sql'
  runStatus?: string
  onDelete: (id: string) => void
  nodeId: string
}

function PipelineNode({ data, selected }: NodeProps<NodeData>) {
  const { label, pipelineType, runStatus, onDelete, nodeId } = data
  const statusClass = runStatus && runStatus !== 'pending' ? `pnode-${runStatus}` : ''
  return (
    <div className={`pnode ${statusClass} ${selected ? 'pnode-selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="pnode-handle pnode-handle-in" />
      <div className="pnode-head">
        <span className={`badge badge-${pipelineType}`}>{pipelineType}</span>
        <button className="pnode-del" onClick={() => onDelete(nodeId)} title="Remove">✕</button>
      </div>
      <div className="pnode-name">{label}</div>
      {runStatus && runStatus !== 'pending' && (
        <div className="pnode-run-status">
          <span className={`badge badge-${runStatus}`}>{runStatus}</span>
        </div>
      )}
      <Handle type="source" position={Position.Right} className="pnode-handle pnode-handle-out" />
    </div>
  )
}

const nodeTypes = { pipelineNode: PipelineNode }
const edgeTypes = { conditionEdge: ConditionEdge }

// ── Main export ───────────────────────────────────────────────────

export default function OrchestrationsPage() {
  const { workspace } = useWorkspace()
  if (!workspace) return (
    <div>
      <div className="page-header"><h1>Orchestrations</h1></div>
      <div className="page-body"><div className="alert alert-info">Open a workspace first.</div></div>
    </div>
  )
  return (
    <ReactFlowProvider>
      <OrchestrationsEditor />
    </ReactFlowProvider>
  )
}

// ── Editor ────────────────────────────────────────────────────────

function OrchestrationsEditor() {
  const reactFlow = useReactFlow()
  const canvasRef = useRef<HTMLDivElement>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedName, setSelectedName] = useState('')
  const [isNew, setIsNew] = useState(true)
  const [flowName, setFlowName] = useState('')
  const [description, setDescription] = useState('')
  const [triggers, setTriggers] = useState<OrchestrationTrigger[]>([])
  const [runResult, setRunResult] = useState<OrchestrationRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showSteps, setShowSteps] = useState(false)

  const pipelinesByType = {
    python: pipelines.filter(p => p.type === 'python'),
    sql: pipelines.filter(p => p.type === 'sql'),
  }

  // ── Load ─────────────────────────────────────────────────────────

  const load = useCallback(async (preferName?: string) => {
    setLoading(true); setError('')
    try {
      const [items, pipes] = await Promise.all([orchestrationApi.list(), pipeApi.list()])
      setOrchestrations(items)
      setPipelines(pipes)
      const next = items.find(i => i.name === preferName)
        ?? items.find(i => i.name === selectedName)
        ?? items[0]
      if (next) applyFlow(next)
      else startNew()
    } catch (e) { setError(errMsg(e)) }
    finally { setLoading(false) }
  }, [selectedName])

  useEffect(() => { load() }, [])

  const applyFlow = (item: Orchestration) => {
    setSelectedName(item.name); setIsNew(false)
    setFlowName(item.name); setDescription(item.description ?? '')
    setTriggers(normalizeTriggers(item.triggers ?? []))
    setRunResult(null); setMessage(''); setError('')
    setNodes((item.nodes ?? []).map(n => toRfNode(n, deleteNode)))
    setEdges((item.edges ?? []).map(e => toRfEdge(e, cycleEdgeCondition)))
  }

  const startNew = () => {
    setSelectedName(''); setIsNew(true)
    setFlowName(''); setDescription(''); setTriggers([])
    setRunResult(null); setMessage(''); setError('')
    setNodes([]); setEdges([])
  }

  // ── Node & edge helpers ───────────────────────────────────────────

  const deleteNode = useCallback((id: string) => {
    setNodes(nds => nds.filter(n => n.id !== id))
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id))
  }, [setNodes, setEdges])

  const cycleEdgeCondition = useCallback((id: string) => {
    setEdges(eds => eds.map(e => {
      if (e.id !== id) return e
      const current: Condition = (e.data?.condition as Condition) ?? 'success'
      const next = CONDITION_CYCLE[(CONDITION_CYCLE.indexOf(current) + 1) % CONDITION_CYCLE.length]
      const cfg = CONDITION_CONFIG[next]
      return {
        ...e,
        data: { ...e.data, condition: next },
        style: { stroke: cfg.color, strokeWidth: 2 },
        markerEnd: `url(#marker-${next})`,
      }
    }))
  }, [setEdges])

  const onConnect = useCallback((conn: Connection) => {
    const id = `${conn.source}->${conn.target}`
    setEdges(eds => addEdge(makeEdge(id, conn.source!, conn.target!, 'success', cycleEdgeCondition), eds))
  }, [setEdges, cycleEdgeCondition])

  // ── Drag from palette ─────────────────────────────────────────────

  const onDragStart = (pipeline: Pipeline) => (e: React.DragEvent) => {
    e.dataTransfer.setData('application/soverdata-pipeline', JSON.stringify(pipeline))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/soverdata-pipeline')
    if (!raw) return
    const pipeline: Pipeline = JSON.parse(raw)
    const position = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const id = makeId()
    setNodes(nds => [...nds, {
      id, type: 'pipelineNode', position,
      data: { label: pipeline.name, pipelineType: pipeline.type as 'python' | 'sql',
               onDelete: deleteNode, nodeId: id },
    }])
  }, [reactFlow, deleteNode, setNodes])

  // ── Triggers ──────────────────────────────────────────────────────

  const addTrigger = (type: OrchestrationTrigger['type']) =>
    setTriggers(prev => [...prev, defaultTrigger(type)])
  const updateTrigger = (idx: number, patch: Partial<OrchestrationTrigger>) =>
    setTriggers(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t))
  const removeTrigger = (idx: number) =>
    setTriggers(prev => prev.filter((_, i) => i !== idx))

  // ── Save / Run / Delete ───────────────────────────────────────────

  const save = async (): Promise<string | null> => {
    setError(''); setMessage('')
    const name = flowName.trim()
    if (!name) { setError('Give the flow a name first.'); return null }
    if (nodes.length === 0) { setError('Add at least one pipeline block.'); return null }

    setSaving(true)
    try {
      const backendNodes: OrchestrationNode[] = nodes.map(n => ({
        id: n.id, name: n.data.label, type: n.data.pipelineType,
        x: Math.round(n.position.x), y: Math.round(n.position.y),
      }))
      const backendEdges: OrchestrationEdge[] = edges.map(e => ({
        id: e.id, source: e.source, target: e.target,
        condition: (e.data?.condition as Condition) ?? 'success',
      }))
      const payload = { name, description: description.trim(), nodes: backendNodes, edges: backendEdges, triggers }
      const saved = isNew
        ? await orchestrationApi.create(payload)
        : await orchestrationApi.update(selectedName, payload)
      setMessage('Saved.')
      setIsNew(false); setSelectedName(saved.name)
      await load(saved.name)
      return saved.name
    } catch (e) { setError(errMsg(e)); return null }
    finally { setSaving(false) }
  }

  const run = async () => {
    setError(''); setMessage('')
    const runName = isNew ? await save() : selectedName
    if (!runName) return

    setIsRunning(true); setRunResult(null)
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, runStatus: 'pending' } })))

    const poll = setInterval(async () => {
      try {
        const runs = await orchestrationApi.runs(runName)
        if (runs[0]) applyNodeStatuses(runs[0].steps ?? [])
      } catch { /* ignore */ }
    }, 2000)

    try {
      const result = await orchestrationApi.run(runName)
      setRunResult(result); setShowSteps(true)
      applyNodeStatuses(result.steps ?? [])
      setMessage(result.status === 'success' ? 'Run completed successfully.' : 'Run finished with failures.')
    } catch (e) { setError(errMsg(e)) }
    finally { clearInterval(poll); setIsRunning(false) }
  }

  const applyNodeStatuses = (steps: OrchestrationRun['steps']) => {
    const map: Record<string, string> = {}
    for (const s of steps ?? []) if (s.node_id) map[s.node_id] = s.status
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, runStatus: map[n.id] ?? n.data.runStatus } })))
  }

  const deleteCurrent = async () => {
    if (isNew || !selectedName) return
    if (!confirm(`Delete flow "${selectedName}"?`)) return
    try { await orchestrationApi.delete(selectedName); await load() }
    catch (e) { setError(errMsg(e)) }
  }

  return (
    <div className="orch-page">
      <EdgeMarkers />

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="orch-topbar">
        <div className="orch-topbar-left">
          <select value={selectedName} className="orch-flow-select"
            onChange={e => { const item = orchestrations.find(o => o.name === e.target.value); if (item) applyFlow(item) }}>
            {orchestrations.length === 0 && <option value="">No flows yet</option>}
            {orchestrations.map(o => <option key={o.name} value={o.name}>{o.name}</option>)}
          </select>
          <input value={flowName} onChange={e => setFlowName(e.target.value)}
            placeholder="flow_name" disabled={!isNew} className="orch-name-input" />
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Description" className="orch-desc-input" />
        </div>
        <div className="orch-topbar-right">
          <button className="btn btn-secondary" onClick={startNew} disabled={saving || isRunning}>New</button>
          <button className="btn btn-secondary" onClick={save} disabled={saving || isRunning}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
          <button className="btn btn-success" onClick={run} disabled={saving || isRunning || nodes.length === 0}>
            {isRunning ? <span className="spinner" /> : '▶ Run'}
          </button>
          <button className="btn btn-danger" onClick={deleteCurrent} disabled={isNew || isRunning}>Delete</button>
        </div>
      </div>

      {(error || message) && (
        <div className="orch-alerts">
          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className={`alert ${message.includes('fail') ? 'alert-error' : 'alert-success'}`}>{message}</div>}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="orch-body">
        {/* Sidebar */}
        <aside className="orch-sidebar">

          {/* Palette */}
          <div className="orch-section">
            <div className="orch-section-title">Pipelines</div>
            <div className="orch-palette-hint">Drag onto canvas →</div>
            {loading ? <div className="orch-muted">Loading…</div>
              : pipelines.length === 0 ? <div className="orch-muted">Create a pipeline first.</div>
              : (
                <>
                  {pipelinesByType.python.length > 0 && (
                    <div className="orch-palette-group">
                      <div className="orch-palette-label">Python</div>
                      {pipelinesByType.python.map(p => (
                        <div key={p.name} className="orch-palette-item" draggable onDragStart={onDragStart(p)}>
                          <span className="orch-drag-dot">⠿</span>
                          <span className="badge badge-python">py</span>
                          <span className="orch-palette-name">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {pipelinesByType.sql.length > 0 && (
                    <div className="orch-palette-group">
                      <div className="orch-palette-label">SQL</div>
                      {pipelinesByType.sql.map(p => (
                        <div key={p.name} className="orch-palette-item" draggable onDragStart={onDragStart(p)}>
                          <span className="orch-drag-dot">⠿</span>
                          <span className="badge badge-sql">sql</span>
                          <span className="orch-palette-name">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
          </div>

          {/* Edge condition legend */}
          <div className="orch-section">
            <div className="orch-section-title">Connection types</div>
            <div className="orch-legend">
              {CONDITION_CYCLE.map(c => (
                <div key={c} className="orch-legend-row">
                  <span className="orch-legend-dot" style={{ background: CONDITION_CONFIG[c].color }} />
                  <span className="orch-legend-label">{CONDITION_CONFIG[c].title.split('—')[0].trim()}</span>
                </div>
              ))}
              <div className="orch-muted" style={{ marginTop: 6, fontSize: 11 }}>
                Click a connection to cycle its condition.
              </div>
            </div>
          </div>

          {/* Triggers */}
          <div className="orch-section">
            <div className="orch-section-title">Schedule triggers</div>
            <div className="orch-trigger-btns">
              <button className="btn btn-secondary btn-sm" onClick={() => addTrigger('interval')}>+ Interval</button>
              <button className="btn btn-secondary btn-sm" onClick={() => addTrigger('daily')}>+ Daily</button>
            </div>
            {triggers.length === 0
              ? <div className="orch-muted" style={{ marginTop: 6 }}>No schedule set.</div>
              : (
                <div className="orch-trigger-list">
                  {triggers.map((t, i) => (
                    <TriggerRow key={t.id ?? i} trigger={t} index={i}
                      onChange={patch => updateTrigger(i, patch)}
                      onRemove={() => removeTrigger(i)} />
                  ))}
                </div>
              )}
          </div>
        </aside>

        {/* Canvas */}
        <div className="orch-canvas-wrap" ref={canvasRef}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onDrop={onDrop} onDragOver={onDragOver}
            nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            fitView fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode="Delete"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a2d3a" />
            <Controls />
            <MiniMap nodeColor={miniMapColor} maskColor="rgba(10,12,20,0.7)" />
            {nodes.length === 0 && (
              <div className="orch-canvas-empty">
                <div className="orch-canvas-empty-title">Drag a pipeline here to start</div>
                <div className="orch-canvas-empty-sub">
                  Connect blocks by dragging from the right ◉ of one block to the left ◉ of another.<br />
                  Click a connection to set its condition: success ✓ · failure ✗ · completion ◎
                </div>
              </div>
            )}
          </ReactFlow>
        </div>
      </div>

      {/* Run panel */}
      {runResult && (
        <div className="orch-run-panel">
          <div className="orch-run-panel-head">
            <div className="orch-run-summary">
              <span className={`badge badge-${runResult.status}`}>{runResult.status}</span>
              {runResult.duration_seconds != null && <span className="tag">{runResult.duration_seconds}s</span>}
              <span className="orch-muted" style={{ fontSize: 11 }}>{runResult.id}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowSteps(v => !v)}>
              {showSteps ? '▼ Hide steps' : '▶ Show steps'}
            </button>
          </div>
          {showSteps && (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Pipeline</th><th>Type</th><th>Status</th><th>Duration</th><th>Note</th></tr></thead>
                <tbody>
                  {(runResult.steps ?? []).map((s, i) => (
                    <tr key={s.node_id ?? i}>
                      <td><strong>{s.name}</strong></td>
                      <td><span className={`badge badge-${s.type}`}>{s.type}</span></td>
                      <td><span className={`badge badge-${s.status}`}>{s.status}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{s.duration_seconds != null ? `${s.duration_seconds}s` : '—'}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── TriggerRow ────────────────────────────────────────────────────

function TriggerRow({ trigger, index, onChange, onRemove }: {
  trigger: OrchestrationTrigger; index: number
  onChange: (p: Partial<OrchestrationTrigger>) => void; onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`orch-trigger-row ${!trigger.enabled ? 'orch-trigger-disabled' : ''}`}>
      <div className="orch-trigger-row-head">
        <button className="orch-trigger-expand" onClick={() => setOpen(v => !v)}>
          <span>{open ? '▾' : '▸'}</span>
          <span className="orch-trigger-type">{trigger.type}</span>
          <span className="orch-trigger-summary">{triggerSummary(trigger)}</span>
        </button>
        <div className="orch-trigger-row-actions">
          <label className="orch-trigger-toggle" title={trigger.enabled ? 'Enabled' : 'Disabled'}>
            <input type="checkbox" checked={trigger.enabled} onChange={e => onChange({ enabled: e.target.checked })} />
          </label>
          <button className="btn btn-danger btn-sm" onClick={onRemove}>✕</button>
        </div>
      </div>
      {open && (
        <div className="orch-trigger-fields">
          {trigger.type === 'interval' && (
            <div className="form-group">
              <label>Every (minutes)</label>
              <input type="number" min={1} value={trigger.every_minutes ?? 60}
                onChange={e => onChange({ every_minutes: Number(e.target.value) })} />
            </div>
          )}
          {trigger.type === 'daily' && (
            <div className="form-group">
              <label>Daily at</label>
              <input type="time" value={trigger.at_time ?? '08:00'}
                onChange={e => onChange({ at_time: e.target.value })} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

function makeEdge(id: string, source: string, target: string, condition: Condition, onCycle: (id: string) => void): Edge {
  const cfg = CONDITION_CONFIG[condition]
  return {
    id, source, target,
    type: 'conditionEdge',
    data: { condition, onCycle },
    style: { stroke: cfg.color, strokeWidth: 2 },
    markerEnd: `url(#marker-${condition})`,
  }
}

function toRfNode(n: OrchestrationNode, onDelete: (id: string) => void): Node<NodeData> {
  return {
    id: n.id, type: 'pipelineNode', position: { x: n.x, y: n.y },
    data: { label: n.name, pipelineType: n.type, onDelete, nodeId: n.id },
  }
}

function toRfEdge(e: OrchestrationEdge, onCycle: (id: string) => void): Edge {
  const condition: Condition = (e.condition as Condition) ?? 'success'
  return makeEdge(e.id, e.source, e.target, condition, onCycle)
}

function miniMapColor(n: Node<NodeData>) {
  const s = n.data?.runStatus
  if (s === 'success') return '#22c55e'
  if (s === 'failed') return '#ef4444'
  if (s === 'skipped') return '#f59e0b'
  if (s === 'running') return '#4a9eff'
  return '#2a2d3a'
}

function triggerSummary(t: OrchestrationTrigger) {
  if (t.type === 'interval') return `every ${t.every_minutes ?? 60} min`
  if (t.type === 'daily') return `at ${t.at_time ?? '08:00'}`
  return ''
}

function defaultTrigger(type: OrchestrationTrigger['type']): OrchestrationTrigger {
  const id = makeId()
  if (type === 'daily') return { id, type, enabled: true, at_time: '08:00' }
  return { id, type: 'interval', enabled: true, every_minutes: 60 }
}

function normalizeTriggers(triggers: OrchestrationTrigger[]): OrchestrationTrigger[] {
  return triggers.map(t => ({
    id: t.id ?? makeId(), type: t.type as 'interval' | 'daily',
    enabled: t.enabled ?? true,
    every_minutes: t.every_minutes ?? null,
    at_time: t.at_time ?? null,
    last_fired_at: t.last_fired_at ?? null,
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
