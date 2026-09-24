import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../types'
import { getCurrentUser, logIn, logOut, signUp, type CurrentUser } from '../api/auth'

type AuthContextValue = {
  user: CurrentUser | null
  loading: boolean
  refreshUser: () => Promise<CurrentUser | null>
  signUp: (email: string, password: string) => Promise<CurrentUser>
  logIn: (email: string, password: string) => Promise<void>
  logOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
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
    function onSessionExpired() {
      setUser(null)
      setLoading(false)
      const { pathname, search, hash } = window.location
      if (pathname !== '/login' && pathname !== '/signup') {
        const returnPath = `${pathname}${search}${hash}`
        navigate(`/login?next=${encodeURIComponent(returnPath)}`, { replace: true })
      }
    }

    window.addEventListener('yum-review:session-expired', onSessionExpired)
    return () => window.removeEventListener('yum-review:session-expired', onSessionExpired)
  }, [navigate])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    refreshUser,
    signUp,
    logIn: async (email, password) => {
      await logIn(email, password)
      await refreshUser()
    },
    logOut: async () => {
      // Keep the authenticated UI until the server confirms session invalidation.
      // If the request fails, the server may still consider this session valid.
      await logOut()
      setUser(null)
    },
  }), [user, loading, refreshUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
