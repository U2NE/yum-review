import { ApiError, type MenuCard } from '../types'
import { apiRequest, refreshCsrfToken } from './client'

export type CurrentUser = {
  id: number
  email: string
  systemRole: 'MEMBER' | 'SERVER_ADMIN'
  ownerRestaurantIds: number[]
  mustChangePassword: boolean
}

type LoginResult = { authenticated: true }
type LogoutResult = { authenticated: false }

export function getCurrentUser() {
  return apiRequest<CurrentUser>('/api/auth/me')
}

export async function signUp(email: string, password: string): Promise<CurrentUser> {
  try {
    const user = await apiRequest<CurrentUser>('/api/auth/signup', { method: 'POST', json: { email: email.trim(), password } })
    await refreshAfterTransition()
    return user
  } catch (error) {
    await refreshAfterTransition()
    throw safeAuthError(error, 'signup')
  }
}

export async function logIn(email: string, password: string): Promise<void> {
  const form = new URLSearchParams({ email: email.trim(), password })
  try {
    await apiRequest<LoginResult>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString(),
    })
  } catch (error) {
    await refreshAfterTransition()
    throw safeAuthError(error, 'login')
  }
  await refreshAfterTransition()
}

export async function logOut(): Promise<void> {
  try {
    await apiRequest<LogoutResult>('/api/auth/logout', { method: 'POST' })
  } catch (error) {
    throw safeAuthError(error, 'logout')
  } finally {
    await refreshAfterTransition()
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const result = await apiRequest<{ mustChangePassword: boolean }>('/api/auth/password', {
    method: 'PUT', json: { currentPassword, newPassword },
  })
  await refreshAfterTransition()
  return result
}

export async function discoverRestaurants() {
  const response = await apiRequest<{ menus: MenuCard[] }>('/api/menus?sort=overall')
  const seen = new Map<number, { id: number; name: string }>()
  for (const menu of response.menus) seen.set(menu.restaurantId, { id: menu.restaurantId, name: menu.restaurantName })
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

async function refreshAfterTransition() {
  await refreshCsrfToken().catch(() => undefined)
}

function safeAuthError(error: unknown, action: 'signup' | 'login' | 'logout'): Error {
  if (!(error instanceof ApiError)) return new Error('요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
  if (error.status === 0) return new Error('서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.')
  if (action === 'signup' && error.status === 409) return new Error('이미 가입된 이메일이에요. 로그인해 주세요.')
  if (action === 'login' && error.status === 401) return new Error('이메일 또는 비밀번호를 확인해 주세요.')
  if (error.status === 400) return new Error('입력한 내용을 확인해 주세요.')
  if (error.status === 403) return new Error('보안 확인이 만료됐어요. 다시 시도해 주세요.')
  return new Error('요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
}
