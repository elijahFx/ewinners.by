import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="cab-shell" style={{ placeItems: 'center', display: 'grid' }}>
        <div className="cab-muted">Загрузка кабинета…</div>
      </div>
    )
  }

  if (!user) return <Navigate to="/account" replace />

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === 'client' ? '/cabinet' : '/cabinet/admin'} replace />
  }

  return children
}
