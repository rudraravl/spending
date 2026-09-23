import { apiDelete, apiGet, apiPatchJson, apiPostJson } from './client'

import type { TagOut } from '../types'

export const getTags = () => apiGet<TagOut[]>('/api/tags')

export const createTag = (payload: { name: string }) => apiPostJson<TagOut>('/api/tags', payload)

export const deleteTag = (id: number) => apiDelete(`/api/tags/${id}`)

/** Rename in place; tagged transactions stay linked by id. */
export const renameTag = (id: number, name: string) => apiPatchJson<TagOut>(`/api/tags/${id}`, { name })
