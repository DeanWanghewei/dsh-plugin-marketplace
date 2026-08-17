import { Navigate, Route, Routes } from 'react-router-dom'
import Market from './pages/Market.js'
import PluginDetail from './pages/PluginDetail.js'
import AdminLogin from './pages/admin/Login.js'
import AdminLayout from './pages/admin/AdminLayout.js'
import Overview from './pages/admin/Overview.js'
import Plugins from './pages/admin/Plugins.js'
import RegistryPage from './pages/admin/Registry.js'
import Tokens from './pages/admin/Tokens.js'
import Audit from './pages/admin/Audit.js'
import Stats from './pages/admin/Stats.js'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Market />} />
      <Route path="/p/:id" element={<PluginDetail />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Overview />} />
        <Route path="plugins" element={<Plugins />} />
        <Route path="registry" element={<RegistryPage />} />
        <Route path="tokens" element={<Tokens />} />
        <Route path="audit" element={<Audit />} />
        <Route path="stats" element={<Stats />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
