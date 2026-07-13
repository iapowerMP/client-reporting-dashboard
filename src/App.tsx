import { Routes, Route } from 'react-router-dom'
import ClientLayout from './components/layout/ClientLayout'
import ClientPicker from './pages/ClientPicker'
import Admin from './pages/Admin'
import Overview from './pages/Overview'
import PaidMedia from './pages/PaidMedia'
import Seo from './pages/Seo'
import Social from './pages/Social'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ClientPicker />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/c/:clientSlug" element={<ClientLayout />}>
        <Route index element={<Overview />} />
        <Route path="paid" element={<PaidMedia />} />
        <Route path="seo" element={<Seo />} />
        <Route path="social" element={<Social />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
