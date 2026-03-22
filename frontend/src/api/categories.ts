import { apiDelete, apiGet, apiPostJson } from './client'

import type { CategoryOut, SubcategoryOut } from '../types'

export type Category = CategoryOut

export type Subcategory = SubcategoryOut

export const getCategories = () => apiGet<Category[]>('/api/categories')

export const createCategory = (payload: { name: string }) => apiPostJson<Category>('/api/categories', payload)

export const deleteCategory = (id: number) => apiDelete(`/api/categories/${id}`)

export const getSubcategories = (categoryId: number) =>
  apiGet<Subcategory[]>(`/api/categories/${categoryId}/subcategories`)

// Settings creates/deletes subcategories via the `/api/subcategories` route.
export const createSubcategory = (payload: { category_id: number; name: string }) =>
  apiPostJson<Subcategory>('/api/subcategories', payload)

export const deleteSubcategory = (id: number) => apiDelete(`/api/subcategories/${id}`)

