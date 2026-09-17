import { useEffect, useState } from 'react'
import { Plus, X, Copy, Check, KeyRound } from 'lucide-react'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import { authHeaders } from '@/lib/authToken'
import { cn } from '@/lib/utils'

type UserRole = 'admin' | 'project_manager' | 'cliente'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  cliente: 'Cliente',
}

interface AdminUserClient {
  id: string
  slug: string
  name: string
  lastViewedAt: string | null
}

interface AdminUser {
  id: string
  email: string
  name: string | null
  role: UserRole
  lastLoginAt: string | null
  createdAt: string
  clients: AdminUserClient[]
}

interface AdminClientOption {
  id: string
  name: string
  slug: string
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Nunca'
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function fetchUsers(): Promise<AdminUser[]> {
  const resp = await fetch('/api/admin?action=users', { headers: authHeaders() })
  if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`)
  const body = await resp.json()
  return body.users ?? []
}

async function fetchClientOptions(): Promise<AdminClientOption[]> {
  const resp = await fetch('/api/admin?action=clients', { headers: authHeaders() })
  if (!resp.ok) throw new Error(`El servidor respondió ${resp.status}`)
  const body = await resp.json()
  return (body.clients ?? []).map((c: { id: string; name: string; slug: string }) => ({ id: c.id, name: c.name, slug: c.slug }))
}

/** Admin → Usuarios: lista de cuentas, con último login y, por cliente
 * asignado, última visita — para saber qué clientes/proyectos usa más o
 * menos cada persona. Crear/editar usuarios y sus informes asignados. */
export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [clientOptions, setClientOptions] = useState<AdminClientOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [resettingId, setResettingId] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<{ email: string; tempPassword: string } | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [u, c] = await Promise.all([fetchUsers(), fetchClientOptions()])
      setUsers(u)
      setClientOptions(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los usuarios.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleReset = async (u: AdminUser) => {
    if (!window.confirm(`¿Restablecer la contraseña de ${u.name || u.email}? La contraseña actual dejará de funcionar.`)) {
      return
    }
    setResettingId(u.id)
    setError(null)
    try {
      const resp = await fetch('/api/admin?action=reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: u.id }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(body.error ?? 'No se pudo restablecer la contraseña.')
      setResetResult({ email: u.email, tempPassword: body.tempPassword })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo restablecer la contraseña.')
    } finally {
      setResettingId(null)
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} />
  if (!users) return null

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => {
            setEditingUser(null)
            setFormOpen(true)
          }}
          className="inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Nuevo usuario
        </button>
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase text-text-secondary">
              <th className="px-4 py-3 font-medium">Usuario</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Informes (último uso)</th>
              <th className="px-4 py-3 font-medium">Último login</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-3">
                  <p className="font-semibold text-white">{u.name || u.email}</p>
                  <p className="text-xs text-text-secondary">{u.email}</p>
                </td>
                <td className="px-4 py-3 text-text-secondary">{ROLE_LABELS[u.role]}</td>
                <td className="px-4 py-3 text-text-secondary">
                  {u.role === 'admin' ? (
                    <span className="text-xs">Todos (acceso de administrador)</span>
                  ) : u.clients.length === 0 ? (
                    <span className="text-xs">Sin informes asignados</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {u.clients.map((c) => (
                        <li key={c.id} className="text-xs">
                          <span className="text-text-primary">{c.name}</span>{' '}
                          <span className="text-text-secondary">· {formatDate(c.lastViewedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">{formatDate(u.lastLoginAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleReset(u)}
                      disabled={resettingId === u.id}
                      className="inline-flex items-center gap-1 rounded-control border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-white/5 disabled:opacity-60"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      {resettingId === u.id ? 'Restableciendo...' : 'Restablecer contraseña'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingUser(u)
                        setFormOpen(true)
                      }}
                      className="rounded-control border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-white/5"
                    >
                      Editar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-secondary">
                  Todavía no hay usuarios.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <UserForm
          user={editingUser}
          clientOptions={clientOptions}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            load()
          }}
        />
      )}

      {resetResult && (
        <ResetPasswordResult result={resetResult} onClose={() => setResetResult(null)} />
      )}
    </div>
  )
}

/** Muestra la contraseña temporal generada por "Restablecer contraseña",
 * una sola vez (igual que al crear un usuario) — no se puede volver a
 * consultar después de cerrar este modal. */
function ResetPasswordResult({
  result,
  onClose,
}: {
  result: { email: string; tempPassword: string }
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Contraseña restablecida</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-sm text-text-secondary">
          Nueva contraseña temporal para <span className="text-white">{result.email}</span>. Cópiala y
          compártela — no se volverá a mostrar. Al iniciar sesión tendrá que cambiarla.
        </p>
        <div className="mb-4 flex items-center gap-2 rounded-control border border-border bg-base px-3 py-2">
          <code className="flex-1 text-sm text-white">{result.tempPassword}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(result.tempPassword).catch(() => {})
              setCopied(true)
            }}
            className="text-text-secondary hover:text-white"
            aria-label="Copiar contraseña"
          >
            {copied ? <Check className="h-4 w-4 text-positive" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <button
          onClick={onClose}
          className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          Hecho
        </button>
      </div>
    </div>
  )
}

function UserForm({
  user,
  clientOptions,
  onClose,
  onSaved,
}: {
  user: AdminUser | null
  clientOptions: AdminClientOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const [email, setEmail] = useState(user?.email ?? '')
  const [name, setName] = useState(user?.name ?? '')
  const [role, setRole] = useState<UserRole>(user?.role ?? 'cliente')
  const [clientIds, setClientIds] = useState<string[]>(user?.clients.map((c) => c.id) ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const toggleClient = (id: string) => {
    setClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)
    try {
      if (user) {
        const resp = await fetch('/api/admin?action=update-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ id: user.id, role, name: name.trim(), clientIds: role === 'admin' ? [] : clientIds }),
        })
        const body = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(body.error ?? 'No se pudo actualizar el usuario.')
        onSaved()
      } else {
        if (!email.trim()) {
          setError('Falta el email.')
          setSaving(false)
          return
        }
        const resp = await fetch('/api/admin?action=create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ email: email.trim(), name: name.trim(), role, clientIds }),
        })
        const body = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(body.error ?? 'No se pudo crear el usuario.')
        setTempPassword(body.tempPassword)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-card border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">{user ? 'Editar usuario' : 'Nuevo usuario'}</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {tempPassword ? (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Usuario creado. Copia esta contraseña temporal y compártela con la persona — no se
              volverá a mostrar. Al iniciar sesión tendrá que cambiarla.
            </p>
            <div className="flex items-center gap-2 rounded-control border border-border bg-base px-3 py-2">
              <code className="flex-1 text-sm text-white">{tempPassword}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(tempPassword).catch(() => {})
                  setCopied(true)
                }}
                className="text-text-secondary hover:text-white"
                aria-label="Copiar contraseña"
              >
                {copied ? <Check className="h-4 w-4 text-positive" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <button
              onClick={() => {
                onSaved()
              }}
              className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              Hecho
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {!user && (
              <>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                  className={inputClass}
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nombre (opcional)"
                  className={inputClass}
                />
              </>
            )}
            {user && (
              <>
                <p className="text-xs text-text-secondary">{user.email}</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nombre"
                  className={inputClass}
                />
              </>
            )}

            <div>
              <p className="mb-1.5 text-xs font-medium text-text-secondary">Rol</p>
              <div className="flex gap-2">
                {(['admin', 'project_manager', 'cliente'] as UserRole[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={cn(
                      'rounded-control border px-3 py-1.5 text-xs font-medium transition-colors',
                      role === r
                        ? 'border-accent/60 bg-accent/10 text-accent'
                        : 'border-border text-text-secondary hover:text-white',
                    )}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            {role !== 'admin' && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-text-secondary">Informes con acceso</p>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-control border border-border bg-base p-2">
                  {clientOptions.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-text-primary hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={clientIds.includes(c.id)}
                        onChange={() => toggleClient(c.id)}
                        className="accent-accent"
                      />
                      {c.name}
                    </label>
                  ))}
                  {clientOptions.length === 0 && <p className="px-1.5 py-1 text-xs text-text-secondary">No hay clientes todavía.</p>}
                </div>
              </div>
            )}

            {error && <p className="text-xs text-negative">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={saving}
              className="w-full rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Guardando...' : user ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
