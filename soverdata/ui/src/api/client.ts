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

// ── Workspace ────────────────────────────────────────────────────
export const wsApi = {
  get: () => api.get<Workspace | null>('/workspace').then(r => r.data),
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
  run: (type: string, name: string) => api.post<Run>(`/pipelines/${type}/${name}/run`).then(r => r.data),
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
