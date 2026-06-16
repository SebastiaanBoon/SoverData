import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
})

// ── Types ────────────────────────────────────────────────────────
export interface Workspace {
  name: string
  path: string
  description?: string
  format_version: string
  created_at: string
}

export interface WorkspaceBrowserRoot {
  label: string
  path: string
}

export interface WorkspaceBrowserEntry {
  name: string
  path: string
  type: 'folder'
  modified: string
  is_workspace: boolean
}

export interface WorkspaceBrowserList {
  path: string
  parent?: string | null
  roots: WorkspaceBrowserRoot[]
  entries: WorkspaceBrowserEntry[]
  is_workspace: boolean
  error?: string | null
}

export interface Connection {
  name: string
  type: string
  description?: string
  config: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface Pipeline {
  name: string
  type: 'python' | 'sql'
  path: string
  code?: string
  size?: number
  modified?: string
}

export interface Run {
  id: string
  pipeline: string
  type: string
  status: 'running' | 'success' | 'failed'
  started_at: string
  finished_at?: string
  duration_seconds?: number
  exit_code?: number
  stdout?: string
  stderr?: string
}

export interface CatalogTable {
  name: string
  layer: string
  path: string
  format: string
  description?: string
  row_count?: number
  lineage?: Record<string, unknown>
}

export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  row_count: number
  error?: string
}

export interface BranchInfo {
  branches: string[]
  current: string | null
  git_available: boolean
  error?: string
}

export interface PackageInfo {
  requirements: string
  requirements_path: string
  packages_path: string
  status: 'empty' | 'not_installed' | 'stale' | 'installed' | 'failed'
  has_requirements: boolean
  installed: boolean
  stale: boolean
  current_hash: string
  last_hash?: string
  last_installed_at?: string
  last_finished_at?: string
  last_exit_code?: number
  stdout?: string
  stderr?: string
  installed_now?: boolean
}

export interface OrchestrationStep {
  name: string
  type: 'python' | 'sql'
}

export interface OrchestrationTrigger {
  id?: string
  type: 'interval' | 'daily'
  enabled: boolean
  every_minutes?: number | null
  at_time?: string | null
  last_fired_at?: string | null
}

export interface Orchestration {
  name: string
  description?: string
  steps: OrchestrationStep[]
  triggers: OrchestrationTrigger[]
  path?: string
  created_at?: string
  updated_at?: string
  modified?: string
}

export interface OrchestrationRunStep {
  index: number
  name: string
  type: 'python' | 'sql'
  status: 'pending' | 'running' | 'success' | 'failed'
  run_id?: string
  started_at?: string
  finished_at?: string
  duration_seconds?: number
  exit_code?: number
  error?: string
}

export interface OrchestrationRun {
  id: string
  orchestration: string
  status: 'running' | 'success' | 'failed'
  started_at: string
  finished_at?: string
  duration_seconds?: number
  steps: OrchestrationRunStep[]
  error?: string
}

export interface LakehouseRetentionSettings {
  enabled: boolean
  bronze_days: number
  cleanup_interval_hours: number
  last_cleanup_at?: string | null
}

export interface LakehouseCleanupResult {
  status: string
  deleted_files: number
  settings: LakehouseRetentionSettings
}

export interface WorkspaceFileEntry {
  name: string
  path: string
  type: 'folder' | 'file'
  size?: number | null
  modified: string
  extension: string
  previewable: boolean
}

export interface WorkspaceFileList {
  path: string
  parent?: string | null
  entries: WorkspaceFileEntry[]
}

export interface WorkspaceFileContent {
  path: string
  name: string
  size: number
  content: string
}

// ── Workspace ────────────────────────────────────────────────────
export interface ScannedWorkspace { path: string; name: string; description: string }

export const wsApi = {
  get: () => api.get<Workspace | null>('/workspace').then(r => r.data),
  scan: () => api.get<{ workspaces: ScannedWorkspace[] }>('/workspace/scan').then(r => r.data.workspaces),
  browse: (path?: string) =>
    api.get<WorkspaceBrowserList>('/workspace/browse', { params: path ? { path } : {} }).then(r => r.data),
  open: (path: string) => api.post<Workspace>('/workspace/open', { path }).then(r => r.data),
  create: (path: string, name: string, description = '') =>
    api.post<Workspace>('/workspace/create', { path, name, description }).then(r => r.data),
  close: () => api.post('/workspace/close').then(r => r.data),
}

// ── Connections ──────────────────────────────────────────────────
export const connApi = {
  list: () => api.get<Connection[]>('/connections').then(r => r.data),
  get: (name: string) => api.get<Connection>(`/connections/${name}`).then(r => r.data),
  create: (data: Omit<Connection, 'created_at' | 'updated_at'>) =>
    api.post<Connection>('/connections', data).then(r => r.data),
  update: (name: string, data: Omit<Connection, 'created_at' | 'updated_at'>) =>
    api.put<Connection>(`/connections/${name}`, data).then(r => r.data),
  delete: (name: string) => api.delete(`/connections/${name}`).then(r => r.data),
  test: (name: string) => api.post<{ status: string; message: string }>(`/connections/${name}/test`).then(r => r.data),
}

// ── Pipelines ────────────────────────────────────────────────────
export const pipeApi = {
  list: () => api.get<Pipeline[]>('/pipelines').then(r => r.data),
  get: (type: string, name: string) => api.get<Pipeline>(`/pipelines/${type}/${name}`).then(r => r.data),
  create: (data: { name: string; type: string; code: string }) =>
    api.post<Pipeline>('/pipelines', data).then(r => r.data),
  update: (type: string, name: string, data: { name: string; type: string; code: string }) =>
    api.put<Pipeline>(`/pipelines/${type}/${name}`, data).then(r => r.data),
  delete: (type: string, name: string) => api.delete(`/pipelines/${type}/${name}`).then(r => r.data),
  run: (type: string, name: string) =>
    api.post<Run>(`/pipelines/${type}/${name}/run`, undefined, { timeout: 10 * 60 * 1000 }).then(r => r.data),
}

export const packagesApi = {
  get: () => api.get<PackageInfo>('/packages').then(r => r.data),
  saveRequirements: (requirements: string) =>
    api.put<PackageInfo>('/packages/requirements', { requirements }).then(r => r.data),
  install: (force = false) =>
    api.post<PackageInfo>('/packages/install', { force }, { timeout: 10 * 60 * 1000 }).then(r => r.data),
}

export const orchestrationApi = {
  list: () => api.get<Orchestration[]>('/orchestrations').then(r => r.data),
  get: (name: string) => api.get<Orchestration>(`/orchestrations/${name}`).then(r => r.data),
  create: (data: { name: string; description?: string; steps: OrchestrationStep[]; triggers: OrchestrationTrigger[] }) =>
    api.post<Orchestration>('/orchestrations', data).then(r => r.data),
  update: (name: string, data: { name: string; description?: string; steps: OrchestrationStep[]; triggers: OrchestrationTrigger[] }) =>
    api.put<Orchestration>(`/orchestrations/${name}`, data).then(r => r.data),
  delete: (name: string) => api.delete(`/orchestrations/${name}`).then(r => r.data),
  run: (name: string) =>
    api.post<OrchestrationRun>(`/orchestrations/${name}/run`, undefined, { timeout: 30 * 60 * 1000 }).then(r => r.data),
  runs: (orchestration?: string) =>
    api.get<OrchestrationRun[]>('/orchestrations/runs', { params: orchestration ? { orchestration } : {} }).then(r => r.data),
  runInfo: (id: string) => api.get<OrchestrationRun>(`/orchestrations/runs/${id}`).then(r => r.data),
}

export const lakehouseApi = {
  retention: () => api.get<LakehouseRetentionSettings>('/lakehouse/retention').then(r => r.data),
  saveRetention: (settings: LakehouseRetentionSettings) =>
    api.put<LakehouseRetentionSettings>('/lakehouse/retention', settings).then(r => r.data),
  cleanupRetention: () =>
    api.post<LakehouseCleanupResult>('/lakehouse/retention/cleanup').then(r => r.data),
}

export const filesApi = {
  list: (path = '') =>
    api.get<WorkspaceFileList>('/files', { params: { path } }).then(r => r.data),
  content: (path: string) =>
    api.get<WorkspaceFileContent>('/files/content', { params: { path } }).then(r => r.data),
  downloadUrl: (path: string) => `/api/files/download?path=${encodeURIComponent(path)}`,
}

// ── Runs ─────────────────────────────────────────────────────────
export const runsApi = {
  list: (pipeline?: string) =>
    api.get<Run[]>('/runs', { params: pipeline ? { pipeline } : {} }).then(r => r.data),
  get: (id: string) => api.get<Run>(`/runs/${id}`).then(r => r.data),
}

// ── Catalog ──────────────────────────────────────────────────────
export const catalogApi = {
  tables: () => api.get<CatalogTable[]>('/catalog/tables').then(r => r.data),
  schema: (layer: string, name: string) =>
    api.get(`/catalog/tables/${layer}/${name}/schema`).then(r => r.data),
  preview: (layer: string, name: string, limit = 100) =>
    api.get<QueryResult>(`/catalog/tables/${layer}/${name}/preview`, { params: { limit } }).then(r => r.data),
}

// ── Query ────────────────────────────────────────────────────────
export const queryApi = {
  execute: (sql: string, limit = 1000) =>
    api.post<QueryResult>('/query', { sql, limit }).then(r => r.data),
}

// ── Branches ─────────────────────────────────────────────────────
export const branchApi = {
  list: () => api.get<BranchInfo>('/branches').then(r => r.data),
  create: (name: string) => api.post('/branches', { name }).then(r => r.data),
  checkout: (name: string) => api.post('/branches/checkout', { name }).then(r => r.data),
  init: () => api.post('/branches/init').then(r => r.data),
}

export default api
