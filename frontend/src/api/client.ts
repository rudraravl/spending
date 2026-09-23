const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(detail: unknown, status: number): string {
  if (typeof detail === 'string' && detail) return detail
  if (detail && typeof detail === 'object' && 'detail' in detail) {
    const d = (detail as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (d != null) return JSON.stringify(d)
  }
  return `HTTP ${status}`
}

/** Sends a request and throws an Error carrying the API's `detail` on a non-2xx response. */
async function request(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE_URL}${path}`, init)
  if (!res.ok) {
    throw new Error(errorMessage(await parseJsonSafe(res), res.status))
  }
  return res
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await request(path, { method: 'GET', headers: { Accept: 'application/json' } })
  return (await res.json()) as T
}

export async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await request(path, jsonInit('POST', body))
  return (await res.json()) as T
}

export async function apiPostJsonNoContent(path: string, body: unknown): Promise<void> {
  await request(path, jsonInit('POST', body))
}

export async function apiPatchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await request(path, jsonInit('PATCH', body))
  return (await res.json()) as T
}

export async function apiPutJson<T>(path: string, body: unknown): Promise<T> {
  const res = await request(path, jsonInit('PUT', body))
  return (await res.json()) as T
}

export async function apiDelete(path: string): Promise<void> {
  await request(path, { method: 'DELETE', headers: { Accept: 'application/json' } })
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await request(path, { method: 'POST', body: form })
  return (await res.json()) as T
}
