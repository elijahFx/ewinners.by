import { useAuth } from '../../AuthContext'
import AdminCompaniesPage from './AdminCompaniesPage'

/**
 * Клиенты в разрезе направления.
 *
 * Админ управляет клиентами, бухгалтер видит полную карточку без правок,
 * HR — только список клиентов своего направления.
 */
export default function CompaniesPage() {
  const { user } = useAuth()
  return <AdminCompaniesPage readOnly={user?.role !== 'admin'} />
}
