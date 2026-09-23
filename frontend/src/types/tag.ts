export interface TagOut {
  id: number
  name: string
  created_at?: string | null
  /** Last time the tag was added to a transaction; null if never used. */
  last_used_at?: string | null
}

