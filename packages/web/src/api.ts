export interface PluginImage {
  url: string
  caption?: string
}

export interface PluginView {
  id: string
  name: string
  description: string
  categories: string[]
  tags: string[]
  author?: string
  homepage?: string
  license?: string
  verified: boolean
  source:
    | { type: 'npm'; package: string }
    | { type: 'git'; url: string; ref?: string; subdir?: string; private?: boolean }
    | { type: 'path'; path: string; link?: boolean }
  images: PluginImage[]
  downloads: number
}

export interface CategoryView {
  id: string
  name: { zh?: string; en?: string }
  parent: string | null
  description?: string
  count: number
}

export interface DownloadStats {
  total: number
  top: Array<{ id: string; name: string; downloads: number }>
  byClient: Array<{ client: string; downloads: number }>
  bySource: Array<{ source_type: string; downloads: number }>
}

const TOKEN_KEY = 'dshm_admin_token'

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAdminToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminToken()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers['authorization'] = `Bearer ${token}`
  const response = await fetch(path, { ...init, headers })
  if (response.status === 401 && path.startsWith('/api/v1/admin')) {
    setAdminToken(null)
    window.location.href = '/admin/login'
    throw new Error('unauthorized')
  }
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw new Error(text || `HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export interface ListResult {
  total: number
  items: PluginView[]
}

export const api = {
  listPlugins: (params: {
    q?: string
    category?: string
    limit?: number
    offset?: number
  }) => {
    const query = new URLSearchParams()
    if (params.q) query.set('q', params.q)
    if (params.category) query.set('category', params.category)
    query.set('limit', String(params.limit ?? 24))
    query.set('offset', String(params.offset ?? 0))
    return request<ListResult>(`/api/v1/plugins?${query.toString()}`)
  },
  getPlugin: (id: string) => request<PluginView>(`/api/v1/plugins/${id}`),
  categories: () => request<CategoryView[]>('/api/v1/categories'),
  stats: () => request<DownloadStats>('/api/v1/stats/downloads'),
  reportInstall: (id: string, version?: string) =>
    request<{ ok: boolean }>(`/api/v1/plugins/${id}/report-install`, {
      method: 'POST',
      body: JSON.stringify({ client: 'web', version }),
    }),
  exportYaml: async () => {
    const response = await fetch('/api/v1/export')
    return response.text()
  },
  // Admin
  upsertPlugin: (id: string, entry: Partial<PluginView> & { name: string }) =>
    request<{ ok: boolean }>(`/api/v1/admin/plugins/${id}`, {
      method: 'PUT',
      body: JSON.stringify(entry),
    }),
  deletePlugin: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/admin/plugins/${id}`, { method: 'DELETE' }),
  upsertCategory: (id: string, category: Partial<CategoryView>) =>
    request<{ ok: boolean }>(`/api/v1/admin/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(category),
    }),
  importRegistry: (yaml: string, mode: 'replace' | 'merge') =>
    request<{ ok: boolean; plugins: number }>(`/api/v1/admin/import?mode=${mode}`, {
      method: 'POST',
      body: yaml,
    }),
  tokens: () =>
    request<
      Array<{
        name: string
        admin: boolean
        created_at: string
        last_used_at: string | null
      }>
    >('/api/v1/admin/tokens'),
  createToken: (name: string, admin: boolean) =>
    request<{ token: string }>('/api/v1/admin/tokens', {
      method: 'POST',
      body: JSON.stringify({ name, admin }),
    }),
  revokeToken: (name: string) =>
    request<{ ok: boolean }>(`/api/v1/admin/tokens/${name}`, { method: 'DELETE' }),
  audit: (limit = 50) =>
    request<
      Array<{ id: number; at: string; actor: string; action: string; target: string; detail?: string | null }>
    >(`/api/v1/admin/audit?limit=${limit}`),
  health: () => request<{ ok: boolean; plugins: number }>('/health'),
}
