import { Routes, Route } from 'react-router-dom'
import ClientLayout from './components/layout/ClientLayout'
import ClientPicker from './pages/ClientPicker'
import Admin from './pages/Admin'
import Overview from './pages/Overview'
import PaidMedia from './pages/PaidMedia'
import Programmatic from './pages/Programmatic'
import Seo from './pages/Seo'
import Social from './pages/Social'
import Settings from './pages/Settings'
import PrivacyPolicy from './pages/PrivacyPolicy'
import DataDeletion from './pages/DataDeletion'
import TermsOfService from './pages/TermsOfService'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ClientPicker />} />
      <Route path="/politica-privacidad" element={<PrivacyPolicy />} />
      <Route path="/eliminacion-datos" element={<DataDeletion />} />
      <Route path="/condiciones-servicio" element={<TermsOfService />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/c/:clientSlug" element={<ClientLayout />}>
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
