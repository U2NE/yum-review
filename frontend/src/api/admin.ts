import { apiRequest } from './client'

export type OwnerAssignment = { userId: number; email: string; restaurantId: number }
export type UserOption = { userId: number; email: string }

export function searchUsers(q: string) {
  const params = new URLSearchParams({ q })
  return apiRequest<UserOption[]>(`/api/admin/users?${params.toString()}`)
}

export function listOwnerAssignments() {
  return apiRequest<OwnerAssignment[]>('/api/admin/owners')
}

export function assignOwner(restaurantId: number, userId: number) {
  return apiRequest<OwnerAssignment>(`/api/admin/restaurants/${restaurantId}/owners`, { method: 'POST', json: { userId } })
}

export function revokeOwner(restaurantId: number, userId: number) {
  return apiRequest<{ message: string }>(`/api/admin/restaurants/${restaurantId}/owners/${userId}`, { method: 'DELETE' })
}
