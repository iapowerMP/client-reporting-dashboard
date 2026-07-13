import { Navigate, Outlet, useParams } from 'react-router-dom'
import Layout from './Layout'
import { ReportConfigProvider } from '@/lib/reportConfig'

/** Envuelve las rutas de un cliente concreto (/c/:clientSlug/...), aportando
 * el slug al layout y reiniciando la configuración de visibilidad por cliente. */
export default function ClientLayout() {
  const { clientSlug } = useParams<{ clientSlug: string }>()

  if (!clientSlug) return <Navigate to="/" replace />

  return (
    <ReportConfigProvider key={clientSlug} clientSlug={clientSlug}>
      <Layout clientSlug={clientSlug}>
        <Outlet />
      </Layout>
    </ReportConfigProvider>
  )
}
