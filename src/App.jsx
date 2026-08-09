import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import CallCenterPage from './pages/CallCenterPage'
import HRPage from './pages/HRPage'
import MarketingPage from './pages/MarketingPage'
import AccountPage from './pages/AccountPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/call-center" element={<CallCenterPage />} />
      <Route path="/call-center/" element={<CallCenterPage />} />
      <Route path="/hr" element={<HRPage />} />
      <Route path="/hr/" element={<HRPage />} />
      <Route path="/target" element={<MarketingPage />} />
      <Route path="/target/" element={<MarketingPage />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/account/" element={<AccountPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
