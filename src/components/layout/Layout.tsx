import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import SupportForm from '@/components/shared/SupportForm'
import type { ClientInfo } from '@/lib/useClientInfo'

/** Título de la sección según el sufijo de ruta dentro de /:clientSlug/... */
const ROUTE_TITLES: Record<string, string> = {
  '': 'Overview',
  '/paid': 'Paid Media',
  '/programatica': 'Publicidad Programática',
  '/seo': 'SEO',
  '/social': 'Redes Sociales',
  '/settings': 'Configuración',
}

export default function Layout({
  children,
  clientSlug,
  clientId,
  clientName,
  logoUrl,
  reportTemplate = 'standard',
  group = null,
  showSettings = true,
}: {
  children: ReactNode
  clientSlug: string
  clientId?: string
  clientName?: string
  logoUrl?: string | null
  reportTemplate?: 'standard' | 'programmatic'
  group?: ClientInfo['group']
  /** Falso para el rol cliente: oculta el acceso a Configuración. */
  showSettings?: boolean
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { pathname } = useLocation()
  const suffix = pathname.replace(`/${clientSlug}`, '')
  const title = ROUTE_TITLES[suffix] ?? 'Overview'

  return (
    <div className="min-h-screen bg-base">
      <Sidebar
        clientSlug={clientSlug}
        clientName={clientName}
        logoUrl={logoUrl}
        reportTemplate={reportTemplate}
        group={group}
        currentSuffix={suffix}
        showSettings={showSettings}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Área de contenido: desplazada 260px en desktop por el sidebar fijo */}
      <div className="md:pl-[260px]">
        <TopBar title={title} onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="mx-auto max-w-content px-4 py-8 sm:px-8">
          {children}
        </main>
      </div>

      <SupportForm clientId={clientId} />
    </div>
  )
}
