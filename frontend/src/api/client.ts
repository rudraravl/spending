const API_BASE_URL =
  (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000'

type Json = any

async function parseJsonSafe(res: Response): Promise<Json> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const detail = await parseJsonSafe(res)
    throw new Error(
      typeof detail === 'string' ? detail : detail?.detail ?? `HTTP ${res.status}`,
    )
  }
  return (await res.json()) as T
}

export async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await parseJsonSafe(res)
    throw new Error(
      typeof detail === 'string' ? detail : detail?.detail ?? `HTTP ${res.status}`,
    )
  }
  return (await res.json()) as T
}

export async function apiPostJsonNoContent(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await parseJsonSafe(res)
    throw new Error(
      typeof detail === 'string' ? detail : detail?.detail ?? `HTTP ${res.status}`,
    )
  }
}

export async function apiPatchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await parseJsonSafe(res)
    throw new Error(
      typeof detail === 'string' ? detail : detail?.detail ?? `HTTP ${res.status}`,
    )
  }
  return (await res.json()) as T
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const detail = await parseJsonSafe(res)
    throw new Error(
      typeof detail === 'string' ? detail : detail?.detail ?? `HTTP ${res.status}`,
    )
  }
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const detail = await parseJsonSafe(res)
    throw new Error(
      typeof detail === 'string' ? detail : detail?.detail ?? `HTTP ${res.status}`,
    )
  }
  return (await res.json()) as T
}

export async function apiPutJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await parseJsonSafe(res)
    throw new Error(
      typeof detail === 'string' ? detail : detail?.detail ?? `HTTP ${res.status}`,
    )
  }
  return (await res.json()) as T
}

