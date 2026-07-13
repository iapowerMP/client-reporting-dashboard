import { Navigate, Outlet, useParams } from 'react-router-dom'
import Layout from './Layout'
import { ReportConfigProvider } from '@/lib/reportConfig'
import { useClientInfo } from '@/lib/useClientInfo'

/** Envuelve las rutas de un cliente concreto (/c/:clientSlug/...), aportando
 * el slug al layout y reiniciando la configuración de visibilidad por cliente.
 * También carga los datos reales del cliente (nombre/logo) para el branding
 * del sidebar, y los expone a las páginas hijas vía contexto de ruta. */
export default function ClientLayout() {
  const { clientSlug } = useParams<{ clientSlug: string }>()
  const clientInfo = useClientInfo(clientSlug ?? '')

  if (!clientSlug) return <Navigate to="/" replace />

  return (
    <ReportConfigProvider key={clientSlug} clientSlug={clientSlug}>
      <Layout
        clientSlug={clientSlug}
        clientName={clientInfo.data?.name}
        logoUrl={clientInfo.data?.logoUrl}
      >
        <Outlet context={clientInfo} />
      </Layout>
    </ReportConfigProvider>
  )
}
