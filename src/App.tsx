import { Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Overview from './pages/Overview'
import PaidMedia from './pages/PaidMedia'
import Seo from './pages/Seo'
import Social from './pages/Social'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/paid" element={<PaidMedia />} />
        <Route path="/seo" element={<Seo />} />
        <Route path="/social" element={<Social />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}
