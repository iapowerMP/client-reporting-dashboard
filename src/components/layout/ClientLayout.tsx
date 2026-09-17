import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import Layout from './Layout'
import { ReportConfigProvider } from '@/lib/reportConfig'
import { DateRangeProvider } from '@/lib/dateRange'
import { useClientInfo } from '@/lib/useClientInfo'
import { useSession } from '@/lib/session'
import Login from '@/pages/Login'
import { Loading, ErrorState } from '@/components/shared/AsyncState'

/** Envuelve las rutas de un cliente concreto (/c/:clientSlug/...), aportando
 * el slug al layout y reiniciando la configuración de visibilidad por cliente.
 * También carga los datos reales del cliente (nombre/logo) para el branding
 * del sidebar, y los expone a las páginas hijas vía contexto de ruta.
 *
 * Acceso: exige sesión (Login) y que el usuario tenga ese informe asignado
 * (o sea admin, con acceso implícito a todos) — ya no existe la contraseña
 * compartida por informe. El rol determina si puede ver la pestaña
 * Settings (admin/project_manager sí, cliente no). */
export default function ClientLayout() {
  const { clientSlug } = useParams<{ clientSlug: string }>()
  const { pathname } = useLocation()
  const clientInfo = useClientInfo(clientSlug ?? '')
  const session = useSession()

  // /api/clients?slug= ahora exige sesión: la primera carga (antes de que
  // se resuelva el login) devuelve 401, así que en cuanto hay usuario hay
  // que volver a pedir los datos del cliente.
  useEffect(() => {
    if (session.user) clientInfo.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user, clientSlug])

  if (!clientSlug) return <Navigate to="/" replace />

  if (session.loading || clientInfo.loading) return <Loading />

  if (!session.user) {
    return <Login subtitle="Inicia sesión para ver este informe." />
  }

  const access = session.user.role === 'admin' ? null : session.user.clients.find((c) => c.slug === clientSlug)
  const hasAccess = session.user.role === 'admin' || !!access
  if (!hasAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base px-4">
        <ErrorState message="No tienes acceso a este informe. Contacta con tu Project Manager si crees que es un error." />
      </div>
    )
  }

  const canEditSettings = session.user.role === 'admin' || session.user.role === 'project_manager'
  const suffix = pathname.replace(`/c/${clientSlug}`, '')
  if (suffix === '/settings' && !canEditSettings) {
    return <Navigate to={`/c/${clientSlug}`} replace />
  }

  // Informes especiales (report_template = 'programmatic'): las secciones
  // habituales (Overview/Paid/SEO/Social) no aplican, solo Configuración.
  const reportTemplate = clientInfo.data?.reportTemplate ?? 'standard'
  if (reportTemplate === 'programmatic' && suffix !== '/programatica' && suffix !== '/settings') {
    return <Navigate to={`/c/${clientSlug}/programatica`} replace />
  }

  return (
    <ClientVisitTracker clientSlug={clientSlug} clientId={clientInfo.data?.id}>
      <ReportConfigProvider
        key={clientSlug}
        clientSlug={clientSlug}
        initialVisibility={clientInfo.data?.reportVisibility ?? null}
      >
        <DateRangeProvider key={clientSlug}>
          <Layout
            clientSlug={clientSlug}
            clientId={clientInfo.data?.id}
            clientName={clientInfo.data?.name}
            logoUrl={clientInfo.data?.logoUrl}
            reportTemplate={reportTemplate}
            group={clientInfo.data?.group ?? null}
            showSettings={canEditSettings}
          >
            <Outlet context={clientInfo} />
          </Layout>
        </DateRangeProvider>
      </ReportConfigProvider>
    </ClientVisitTracker>
  )
}

/** Registra la visita a este informe (Admin → Usuarios: "último uso" por
 * cliente) una vez por carga de página, no en cada cambio de pestaña. */
function ClientVisitTracker({
  clientSlug,
  clientId,
  children,
}: {
  clientSlug: string
  clientId?: string
  children: React.ReactNode
}) {
  const { touch } = useSession()
  useEffect(() => {
    if (clientId) touch(clientId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSlug, clientId])
  return <>{children}</>
}
