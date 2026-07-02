import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  DollarSign,
  Search,
  Smartphone,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/paid', label: 'Paid Media', icon: DollarSign },
  { to: '/seo', label: 'SEO', icon: Search },
  { to: '/social', label: 'Redes Sociales', icon: Smartphone },
  { to: '/settings', label: 'Configuración', icon: Settings },
]

interface SidebarProps {
  /** Estado del overlay en móvil. */
  open: boolean
  onClose: () => void
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {/* Backdrop en móvil */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-border bg-card transition-transform duration-200 md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Cabecera / logo */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-control bg-accent">
                <span className="text-sm font-extrabold text-black">M</span>
              </span>
              <span className="text-base font-extrabold tracking-tight text-white">
                MEDIA POWER
              </span>
            </div>
            <p className="mt-1 pl-9 text-xs text-text-secondary">
              Reporting Dashboard
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-control p-1 text-text-secondary hover:bg-white/10 md:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navegación */}
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-l-[3px] border-accent bg-accent/10 pl-[9px] text-white'
                    : 'border-l-[3px] border-transparent text-text-secondary hover:bg-white/5 hover:text-white',
                )
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Pie: perfil del cliente */}
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
              CD
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                Cliente Demo
              </p>
              <p className="truncate text-xs text-text-secondary">E-commerce</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
