export interface AccountOut {
  id: number
  name: string
  type: string
  currency: string
  // Present only if backend returns it; keep optional so existing API typings still work.
  created_at?: string | null
}

