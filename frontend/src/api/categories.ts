import { apiDelete, apiGet, apiPostJson } from './client'

export type Category = { id: number; name: string }

export type Subcategory = { id: number; name: string; category_id: number }

export const getCategories = () => apiGet<Category[]>('/api/categories')

export const createCategory = (payload: { name: string }) => apiPostJson<Category>('/api/categories', payload)

export const deleteCategory = (id: number) => apiDelete(`/api/categories/${id}`)

export const getSubcategories = (categoryId: number) =>
  apiGet<Subcategory[]>(`/api/categories/${categoryId}/subcategories`)

// Settings creates/deletes subcategories via the `/api/subcategories` route.
export const createSubcategory = (payload: { category_id: number; name: string }) =>
  apiPostJson<Subcategory>('/api/subcategories', payload)

export const deleteSubcategory = (id: number) => apiDelete(`/api/subcategories/${id}`)

