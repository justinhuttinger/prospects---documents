import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import VipPage from './pages/VipPage'
import PtIntakePage from './pages/PtIntakePage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <Routes>
      <Route path="/"          element={<HomePage />} />
      <Route path="/vip"       element={<VipPage variant="internal" />} />
      <Route path="/vipx"      element={<VipPage variant="member" />} />
      <Route path="/form-page" element={<PtIntakePage />} />
      <Route path="*"          element={<NotFoundPage />} />
    </Routes>
  )
}
