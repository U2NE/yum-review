import { apiRequest } from './client'
import type { CuisineCategory, MenuCard, MenuDetail, MenuManagementItem, MenuSearchInput, MenuSearchResponse, PublicReview, RestaurantDetail } from '../types'

export type { MenuSort } from '../types'

export async function searchMenus(input: MenuSearchInput = {}): Promise<MenuSearchResponse> {
  const sort = input.sort ?? 'overall'
  const hasRadius = input.latitude != null && input.longitude != null && input.radiusMeters != null
  if (hasRadius) {
    return apiRequest<MenuSearchResponse>('/api/menus/search', {
      method: 'POST',
      json: { ...input, sort },
    })
  }
  const params = new URLSearchParams({ sort })
  if (input.q?.trim()) params.set('q', input.q.trim())
  if (input.category) params.set('category', input.category)
  if (input.region?.trim()) params.set('region', input.region.trim())
  return apiRequest<MenuSearchResponse>(`/api/menus?${params.toString()}`)
}

export function getRestaurant(id: string | number) {
  return apiRequest<RestaurantDetail>(`/api/restaurants/${id}`)
}

export function getMenu(id: string | number) {
  return apiRequest<MenuDetail>(`/api/menus/${id}`)
}

export function getMenuReviews(id: string | number) {
  return apiRequest<PublicReview[]>(`/api/menus/${id}/reviews`)
}

export type MenuWriteInput = {
  name: string
  description: string
  priceKrw: number | null
  cuisineCategory: CuisineCategory
  photoMediaId: string | null
  active: boolean
}

export function getManagedMenus(restaurantId: number) {
  return apiRequest<MenuManagementItem[]>(`/api/restaurants/${restaurantId}/manage/menus`)
}

export function createMenu(restaurantId: number, input: MenuWriteInput) {
  return apiRequest<MenuManagementItem>(`/api/restaurants/${restaurantId}/menus`, { method: 'POST', json: input })
}

export function updateMenu(menuId: number, input: MenuWriteInput) {
  return apiRequest<MenuManagementItem>(`/api/menus/${menuId}`, { method: 'PUT', json: input })
}

export function deactivateMenu(menuId: number) {
  return apiRequest<{ message: string }>(`/api/menus/${menuId}`, { method: 'DELETE' })
}

export type PlaceSuggestion = {
  name: string
  category: string
  address: string
  roadAddress: string
  sourceUrl: string
  latitude: number | null
  longitude: number | null
}

export function searchPlaces(q: string) {
  const params = new URLSearchParams({ q })
  return apiRequest<{ configured: boolean; success: boolean; message: string | null; results: PlaceSuggestion[] }>(`/api/location/search?${params.toString()}`)
}

export function searchMenusAsList(input: MenuSearchInput = {}): Promise<MenuCard[]> {
  return searchMenus(input).then((result) => result.menus)
}
