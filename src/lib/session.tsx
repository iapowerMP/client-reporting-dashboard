import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getStoredToken, storeToken, clearToken, authHeaders } from './authToken'

export interface SessionClient {
  id: string
  slug: string
  name: string
  lastViewedAt: string | null
}

export type UserRole = 'admin' | 'project_manager' | 'cliente'

export interface SessionUser {
  id: string
  email: string
  name: string | null
  role: UserRole
  mustChangePassword: boolean
  clients: SessionClient[]
}

type Result = { ok: true } | { ok: false; error: string }

interface SessionContextValue {
  user: SessionUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<Result>
  changePassword: (newPassword: string) => Promise<Result>
  logout: () => void
  refresh: () => Promise<void>
  /** Marca un informe como visitado ahora — alimenta el "último uso" de
   * Admin → Usuarios. No bloqueante: si falla, no rompe la navegación. */
  touch: (clientId: string) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

async function fetchMe(): Promise<SessionUser | null> {
  const token = getStoredToken()
  if (!token) return null
  try {
    const resp = await fetch('/api/auth?action=me', { headers: authHeaders() })
    if (!resp.ok) {
      clearToken()
      return null
    }
    const body = await resp.json()
    return {
      id: body.id,
      email: body.email,
      name: body.name ?? null,
      role: body.role,
      mustChangePassword: !!body.mustChangePassword,
      clients: Array.isArray(body.clients) ? body.clients : [],
    }
  } catch {
    return null
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const u = await fetchMe()
    setUser(u)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string): Promise<Result> => {
      try {
        const resp = await fetch('/api/auth?action=login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const body = await resp.json().catch(() => ({}))
        if (!resp.ok || !body.token) {
          return { ok: false, error: body.error ?? 'Email o contraseña incorrectos.' }
        }
        storeToken(body.token)
        await refresh()
        return { ok: true }
      } catch {
        return { ok: false, error: 'No se pudo iniciar sesión. Inténtalo de nuevo.' }
      }
    },
    [refresh],
  )

  const changePassword = useCallback(
    async (newPassword: string): Promise<Result> => {
      try {
        const resp = await fetch('/api/auth?action=change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ newPassword }),
        })
        const body = await resp.json().catch(() => ({}))
        if (!resp.ok) return { ok: false, error: body.error ?? 'No se pudo cambiar la contraseña.' }
        await refresh()
        return { ok: true }
      } catch {
        return { ok: false, error: 'No se pudo cambiar la contraseña. Inténtalo de nuevo.' }
      }
    },
    [refresh],
  )

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const touch = useCallback((clientId: string) => {
    fetch('/api/auth?action=touch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ clientId }),
    }).catch(() => {})
  }, [])

  return (
    <SessionContext.Provider value={{ user, loading, login, changePassword, logout, refresh, touch }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession debe usarse dentro de SessionProvider')
  return ctx
}
