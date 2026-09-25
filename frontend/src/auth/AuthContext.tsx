import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../types'
import { getCurrentUser, logIn, logOut, signUp, type CurrentUser } from '../api/auth'

type AuthContextValue = {
  user: CurrentUser | null
  loading: boolean
  refreshUser: () => Promise<CurrentUser | null>
  signUp: (email: string, password: string) => Promise<CurrentUser>
  logIn: (email: string, password: string) => Promise<CurrentUser | null>
  logOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const current = await getCurrentUser()
      setUser(current)
      return current
    } catch (error) {
      setUser(null)
      if (error instanceof ApiError && error.status === 401) return null
      return null
    }
  }, [])

  useEffect(() => {
    let active = true
    getCurrentUser()
      .then((current) => { if (active) setUser(current) })
      .catch(() => { if (active) setUser(null) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    function onSessionExpired() { setUser(null) }
    window.addEventListener('yum-review:session-expired', onSessionExpired)
    return () => window.removeEventListener('yum-review:session-expired', onSessionExpired)
  }, [])

  useEffect(() => {
    if (loading || !user?.mustChangePassword || location.pathname === '/password-change') return
    navigate('/password-change', { replace: true, state: { from: location.pathname } })
  }, [loading, location.pathname, navigate, user])

  const value = useMemo<AuthContextValue>(() => ({
    user, loading, refreshUser,
    signUp: async (email, password) => signUp(email, password),
    logIn: async (email, password) => { await logIn(email, password); return refreshUser() },
    logOut: async () => { await logOut(); setUser(null) },
  }), [loading, refreshUser, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth는 AuthProvider 안에서 사용해야 해요.')
  return value
}
