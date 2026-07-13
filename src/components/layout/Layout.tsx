import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

/** Título de la sección según el sufijo de ruta dentro de /c/:clientSlug/... */
const ROUTE_TITLES: Record<string, string> = {
  '': 'Overview',
  '/paid': 'Paid Media',
  '/seo': 'SEO',
  '/social': 'Redes Sociales',
  '/settings': 'Configuración',
}

export default function Layout({
  children,
  clientSlug,
  clientName,
  logoUrl,
}: {
  children: ReactNode
  clientSlug: string
  clientName?: string
  logoUrl?: string | null
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { pathname } = useLocation()
  const suffix = pathname.replace(`/c/${clientSlug}`, '')
  const title = ROUTE_TITLES[suffix] ?? 'Overview'

  return (
    <div className="min-h-screen bg-base">
      <Sidebar
        clientSlug={clientSlug}
        clientName={clientName}
        logoUrl={logoUrl}
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
    </div>
  )
}
