import { useState } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import Layout from './Layout'
import { ReportConfigProvider } from '@/lib/reportConfig'
import { DateRangeProvider } from '@/lib/dateRange'
import { useClientInfo } from '@/lib/useClientInfo'
import { getStoredToken } from '@/lib/authToken'
import PasswordGate from '@/pages/PasswordGate'
import { Loading } from '@/components/shared/AsyncState'

/** Envuelve las rutas de un cliente concreto (/c/:clientSlug/...), aportando
 * el slug al layout y reiniciando la configuración de visibilidad por cliente.
 * También carga los datos reales del cliente (nombre/logo) para el branding
 * del sidebar, y los expone a las páginas hijas vía contexto de ruta.
 * Si el informe tiene contraseña activada, bloquea el acceso hasta que se
 * introduce correctamente (PasswordGate). */
export default function ClientLayout() {
  const { clientSlug } = useParams<{ clientSlug: string }>()
  const { pathname } = useLocation()
  const clientInfo = useClientInfo(clientSlug ?? '')
  const [unlocked, setUnlocked] = useState(
    () => (clientSlug ? !!getStoredToken(clientSlug) : false),
  )

  if (!clientSlug) return <Navigate to="/" replace />

  // Solo bloqueamos mientras se resuelve si el informe tiene contraseña; un
  // fallo de red no debe tumbar todo el dashboard (igual que antes, cuando
  // esta llamada solo alimentaba el branding del sidebar).
  if (clientInfo.loading) return <Loading />

  if (clientInfo.data?.hasPassword && !unlocked) {
    return (
      <PasswordGate
        slug={clientSlug}
        clientName={clientInfo.data?.name}
        onUnlock={() => setUnlocked(true)}
      />
    )
  }

  // Informes especiales (report_template = 'programmatic'): las secciones
  // habituales (Overview/Paid/SEO/Social) no aplican, solo Configuración.
  const reportTemplate = clientInfo.data?.reportTemplate ?? 'standard'
  const suffix = pathname.replace(`/c/${clientSlug}`, '')
  if (reportTemplate === 'programmatic' && suffix !== '/programatica' && suffix !== '/settings') {
    return <Navigate to={`/c/${clientSlug}/programatica`} replace />
  }

  return (
    <ReportConfigProvider key={clientSlug} clientSlug={clientSlug}>
      <DateRangeProvider key={clientSlug}>
        <Layout
          clientSlug={clientSlug}
          clientName={clientInfo.data?.name}
          logoUrl={clientInfo.data?.logoUrl}
          reportTemplate={reportTemplate}
        >
          <Outlet context={clientInfo} />
        </Layout>
      </DateRangeProvider>
    </ReportConfigProvider>
  )
}
