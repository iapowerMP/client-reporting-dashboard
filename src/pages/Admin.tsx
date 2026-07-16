import { useEffect, useState, type FormEvent } from 'react'
import { Lock, ExternalLink, Settings as SettingsIcon, ShieldCheck } from 'lucide-react'
import { Loading, ErrorState } from '@/components/shared/AsyncState'

interface AdminClient {
  id: string
  name: string
  slug: string
  sector: string | null
  website: string | null
  createdAt: string
  hasPassword: boolean
  platforms: string[]
}

const ADMIN_TOKEN_KEY = 'mp-admin-token'

function getStoredAdminToken(): string | null {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY)
  if (!token) return null
  const [expiryStr] = token.split('.')
  const expiry = Number(expiryStr)
  if (!expiry || Date.now() > expiry) {
    localStorage.removeItem(ADMIN_TOKEN_KEY)
    return null
  }
  return token
}

/** Panel de administración general: lista todos los informes/clientes
 * configurados, protegido por una contraseña de equipo (no ligada a ningún
 * cliente). */
export default function Admin() {
  const [token, setToken] = useState<string | null>(() => getStoredAdminToken())
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [clients, setClients] = useState<AdminClient[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadClients = async (authToken: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const resp = await fetch('/api/admin?action=clients', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (resp.status === 401) {
        localStorage.removeItem(ADMIN_TOKEN_KEY)
        setToken(null)
        return
      }
      if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`)
      const body = await resp.json()
      setClients(body.clients ?? [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'No se pudieron cargar los clientes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) loadClients(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return
    setLoggingIn(true)
    setLoginError(null)
    try {
      const resp = await fetch('/api/admin?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok || !body.token) {
        setLoginError(body.error ?? 'Contraseña incorrecta.')
        return
      }
      localStorage.setItem(ADMIN_TOKEN_KEY, body.token)
      setToken(body.token)
    } catch {
      setLoginError('No se pudo comprobar la contraseña.')
    } finally {
      setLoggingIn(false)
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base px-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-card border border-border bg-card p-6"
        >
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent">
              <Lock className="h-4 w-4 text-black" />
            </span>
            <span className="text-base font-bold text-white">Panel de administración</span>
          </div>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña de administrador"
            className="mb-3 w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
          {loginError && <p className="mb-3 text-xs text-negative">{loginError}</p>}
          <button
            type="submit"
            disabled={loggingIn || !password}
            className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loggingIn ? 'Comprobando...' : 'Entrar'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-base px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-content">
        <h1 className="mb-6 text-2xl font-bold text-white">Todos los informes</h1>

        {loading && <Loading />}
        {loadError && <ErrorState message={loadError} />}

        {clients && (
          <div className="overflow-x-auto rounded-card border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-text-secondary">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Sector</th>
                  <th className="px-4 py-3 font-medium">Integraciones</th>
                  <th className="px-4 py-3 font-medium">Creado</th>
                  <th className="px-4 py-3 font-medium">Acceso</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">{c.name}</p>
                      <p className="text-xs text-text-secondary">/c/{c.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{c.sector ?? '—'}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {c.platforms.length ? c.platforms.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {new Date(c.createdAt).toLocaleDateString('es-ES')}
                    </td>
                    <td className="px-4 py-3">
                      {c.hasPassword ? (
                        <span className="inline-flex items-center gap-1 text-xs text-accent">
                          <ShieldCheck className="h-3.5 w-3.5" /> Con contraseña
                        </span>
                      ) : (
                        <span className="text-xs text-text-secondary">Libre</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`/c/${c.slug}`}
                          className="inline-flex items-center gap-1 rounded-control border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-white/5"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Ver
                        </a>
                        <a
                          href={`/c/${c.slug}/settings`}
                          className="inline-flex items-center gap-1 rounded-control border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-white/5"
                        >
                          <SettingsIcon className="h-3.5 w-3.5" /> Configurar
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-text-secondary">
                      Todavía no hay clientes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
