import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import ClientLayout from './components/layout/ClientLayout'
import AdminLayout from './components/layout/AdminLayout'
import ClientPicker from './pages/ClientPicker'
import Profile from './pages/Profile'
import AdminClients from './pages/admin/AdminClients'
import AdminUsers from './pages/admin/AdminUsers'
import AdminIncidencias from './pages/admin/AdminIncidencias'
import AdminMonitorizacion from './pages/admin/AdminMonitorizacion'
import Overview from './pages/Overview'
import PaidMedia from './pages/PaidMedia'
import Programmatic from './pages/Programmatic'
import Seo from './pages/Seo'
import Social from './pages/Social'
import Settings from './pages/Settings'
import PrivacyPolicy from './pages/PrivacyPolicy'
import DataDeletion from './pages/DataDeletion'
import TermsOfService from './pages/TermsOfService'

/** Enlaces antiguos guardados con el prefijo /c/ (eliminado): redirige a la
 * misma ruta sin el prefijo, conservando el resto del path y la query. */
function LegacyClientRedirect() {
  const { clientSlug, '*': rest } = useParams<{ clientSlug: string; '*': string }>()
  const { search } = useLocation()
  return <Navigate to={`/${clientSlug}${rest ? `/${rest}` : ''}${search}`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ClientPicker />} />
      <Route path="/perfil" element={<Profile />} />
      <Route path="/politica-privacidad" element={<PrivacyPolicy />} />
      <Route path="/eliminacion-datos" element={<DataDeletion />} />
      <Route path="/condiciones-servicio" element={<TermsOfService />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminClients />} />
        <Route path="usuarios" element={<AdminUsers />} />
        <Route path="incidencias" element={<AdminIncidencias />} />
        <Route path="monitorizacion" element={<AdminMonitorizacion />} />
      </Route>
      <Route path="/c/:clientSlug/*" element={<LegacyClientRedirect />} />
      <Route path="/:clientSlug" element={<ClientLayout />}>
        <Route index element={<Overview />} />
        <Route path="paid" element={<PaidMedia />} />
        <Route path="programatica" element={<Programmatic />} />
        <Route path="seo" element={<Seo />} />
        <Route path="social" element={<Social />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
