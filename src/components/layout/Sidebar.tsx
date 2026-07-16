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
import { useReportConfig } from '@/lib/reportConfig'
import {
  PAID_TAB_TO_CONNECTION,
  SEO_TAB_TO_CONNECTION,
  SOCIAL_TAB_TO_CONNECTION,
} from '@/data/catalog'

type Category = 'paid' | 'seo' | 'social'

interface NavItem {
  suffix: string
  label: string
  icon: LucideIcon
  /** Si se indica, el item solo se muestra si esa categoría tiene al menos
   * una fuente activada en Configuración (el cliente la tiene contratada). */
  category?: Category
}

const NAV_ITEMS: NavItem[] = [
  { suffix: '', label: 'Overview', icon: LayoutDashboard },
  { suffix: '/paid', label: 'Paid Media', icon: DollarSign, category: 'paid' },
  { suffix: '/seo', label: 'SEO', icon: Search, category: 'seo' },
  { suffix: '/social', label: 'Redes Sociales', icon: Smartphone, category: 'social' },
]

interface SidebarProps {
  clientSlug: string
  /** Nombre real del cliente (tabla `clients`); mientras carga, se usa el slug. */
  clientName?: string
  logoUrl?: string | null
  /** Estado del overlay en móvil. */
  open: boolean
  onClose: () => void
}

export default function Sidebar({ clientSlug, clientName, logoUrl, open, onClose }: SidebarProps) {
  const base = `/c/${clientSlug}`
  const displayName = clientName || clientSlug.replace(/-/g, ' ')
  const { isVisible } = useReportConfig()

  const categoryHasSource: Record<Category, boolean> = {
    paid: Object.values(PAID_TAB_TO_CONNECTION).some(isVisible),
    seo: Object.values(SEO_TAB_TO_CONNECTION).some(isVisible),
    social: Object.values(SOCIAL_TAB_TO_CONNECTION).some(isVisible),
  }
  const navItems = NAV_ITEMS.filter(
    (item) => !item.category || categoryHasSource[item.category],
  )

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
        {/* Cabecera / logo del cliente */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div>
            <div className="flex items-center gap-2">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={displayName}
                  className="h-7 w-7 rounded-control object-cover"
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-control bg-accent">
                  <span className="text-sm font-extrabold text-black">
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                </span>
              )}
              <span className="truncate text-base font-extrabold capitalize tracking-tight text-white">
                {displayName}
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
          {navItems.map(({ suffix, label, icon: Icon }) => (
            <NavLink
              key={suffix}
              to={`${base}${suffix}`}
              end={suffix === ''}
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

        {/* Pie: acceso directo a la configuración del informe (solo icono) */}
        <div className="border-t border-border p-4">
          <NavLink
            to={`${base}/settings`}
            onClick={onClose}
            aria-label="Configuración del informe"
            title="Configuración del informe"
            className={({ isActive }) =>
              cn(
                'flex h-9 w-9 items-center justify-center rounded-control transition-colors',
                isActive
                  ? 'bg-accent/10 text-white'
                  : 'text-text-secondary hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Settings className="h-[18px] w-[18px] shrink-0" />
          </NavLink>
        </div>
      </aside>
    </>
  )
}
