import { Navigate } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <LoadingScreen label="Загрузка кабинета…" />
  }

  if (!user) return <Navigate to="/account" replace />

  if (user.mustSetupTelegram2fa) {
    return <Navigate to="/account/security" replace />
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === 'client' ? '/cabinet' : '/cabinet/admin'} replace />
  }

  return children
}
