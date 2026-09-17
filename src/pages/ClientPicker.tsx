import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, LayoutDashboard, LogOut, Plus } from 'lucide-react'
import { useSession } from '@/lib/session'
import { authHeaders } from '@/lib/authToken'
import Login from './Login'
import { Loading } from '@/components/shared/AsyncState'

/** Portada del dashboard: solo inicio de sesión. Una vez dentro, muestra los
 * informes a los que esa cuenta tiene acceso (todos, si es admin) — ya no
 * hay un listado público de clientes. Admin y Project Manager pueden crear
 * un cliente nuevo; el rol cliente no. */
export default function ClientPicker() {
  const session = useSession()

  if (session.loading) return <Loading />
  if (!session.user) return <Login />

  return <ClientList />
}

function ClientList() {
  const session = useSession()
  const user = session.user!
  const canCreate = user.role === 'admin' || user.role === 'project_manager'

  const [name, setName] = useState('')
  const [sector, setSector] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: name.trim(), sector: sector.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo crear el cliente.')
      setName('')
      setSector('')
      await session.refresh()
      window.location.href = `/${body.client.slug}`
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'No se pudo crear el cliente.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent">
              <span className="text-sm font-extrabold text-black">M</span>
            </span>
            <span className="text-lg font-extrabold tracking-tight text-white">MEDIA POWER</span>
          </div>
          <div className="flex items-center gap-4">
            {user.role === 'admin' && (
              <Link
                to="/admin"
                className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-white"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Panel de administración
              </Link>
            )}
            <button
              onClick={session.logout}
              className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              Cerrar sesión
            </button>
          </div>
        </div>

        <h1 className="mb-1 text-2xl font-bold text-white">
          {user.role === 'admin' ? 'Todos los clientes' : 'Tus informes'}
        </h1>
        <p className="mb-6 text-sm text-text-secondary">
          {user.email}
          {user.role !== 'admin' && ` · ${user.role === 'project_manager' ? 'Project Manager' : 'Cliente'}`}
        </p>

        <div className="mb-6 space-y-2">
          {user.clients.length === 0 && (
            <p className="rounded-card border border-dashed border-border p-4 text-sm text-text-secondary">
              Todavía no tienes ningún informe asignado.
            </p>
          )}
          {user.clients.map((c) => (
            <a
              key={c.id}
              href={`/${c.slug}`}
              className="flex items-center justify-between rounded-card border border-border bg-card p-4 transition-colors hover:bg-white/[0.03]"
            >
              <p className="text-sm font-semibold text-white">{c.name}</p>
              <ArrowRight className="h-4 w-4 text-text-secondary" />
            </a>
          ))}
        </div>

        {canCreate && (
          <div className="rounded-card border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">Crear cliente nuevo</h2>
            <div className="space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del cliente"
                className="w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
              />
              <input
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="Sector (opcional)"
                className="w-full rounded-control border border-border bg-base px-3 py-2 text-sm text-white placeholder:text-text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
              />
              {createError && <p className="text-xs text-negative">{createError}</p>}
              <button
                onClick={handleCreate}
                disabled={creating || !name.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {creating ? 'Creando...' : 'Crear cliente'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
