import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useSession } from '@/lib/session'
import Login from '@/pages/Login'
import { Loading, ErrorState } from '@/components/shared/AsyncState'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/admin', label: 'Clientes', end: true },
  { to: '/admin/usuarios', label: 'Usuarios' },
  { to: '/admin/incidencias', label: 'Incidencias' },
  { to: '/admin/monitorizacion', label: 'Monitorización' },
]

/** Envuelve todas las rutas /admin/*: exige sesión con role='admin'. Nadie
 * más ve nada de este panel, ni siquiera un Project Manager. */
export default function AdminLayout() {
  const session = useSession()

  if (session.loading) return <Loading />
  if (!session.user) return <Login subtitle="Inicia sesión para entrar al panel de administración." />
  if (session.user.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base px-4">
        <ErrorState message="No tienes acceso al panel de administración." />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-base px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-content">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Panel de administración</h1>
          <button
            onClick={session.logout}
            className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Cerrar sesión
          </button>
        </div>

        <nav className="mb-6 flex items-center gap-1 border-b border-border">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-accent text-white'
                    : 'border-transparent text-text-secondary hover:text-white',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <Outlet />
      </div>
    </div>
  )
}
