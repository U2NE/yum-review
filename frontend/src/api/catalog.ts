import { apiRequest } from './client'
import type { MenuCard, MenuDetail, PublicReview, RestaurantDetail } from '../types'

export type MenuSort = 'popular' | 'rating'

export function searchMenus(query = '', sort: MenuSort = 'popular') {
  const params = new URLSearchParams({ sort })
  if (query.trim()) params.set('q', query.trim())
  return apiRequest<MenuCard[]>(`/api/menus?${params.toString()}`)
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
