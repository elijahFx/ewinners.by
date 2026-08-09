import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import CallCenterPage from './pages/CallCenterPage'
import HRPage from './pages/HRPage'
import MarketingPage from './pages/MarketingPage'
import AccountPage from './pages/AccountPage'
import TwoFaPage from './pages/TwoFaPage'
import SecuritySetupPage from './pages/SecuritySetupPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import InviteAcceptPage from './pages/InviteAcceptPage'
import { AuthProvider } from './cabinet/AuthContext'
import ProtectedRoute from './cabinet/ProtectedRoute'
import CabinetLayout from './cabinet/CabinetLayout'
import DashboardPage from './cabinet/pages/DashboardPage'
import OperationsPage from './cabinet/pages/OperationsPage'
import InvoicesPage from './cabinet/pages/InvoicesPage'
import DocumentsPage from './cabinet/pages/DocumentsPage'
import TariffsPage from './cabinet/pages/TariffsPage'
import CompanyPage from './cabinet/pages/CompanyPage'
import NotificationsPage from './cabinet/pages/NotificationsPage'
import CrmIntegrationPage from './cabinet/pages/CrmIntegrationPage'
import AdminOverviewPage from './cabinet/pages/admin/AdminOverviewPage'
import AdminCompaniesPage from './cabinet/pages/admin/AdminCompaniesPage'
import AdminUsersPage from './cabinet/pages/admin/AdminUsersPage'
import AdminProjectsPage from './cabinet/pages/admin/AdminProjectsPage'
import AdminPaymentsPage from './cabinet/pages/admin/AdminPaymentsPage'
import AdminBalancePage from './cabinet/pages/admin/AdminBalancePage'
import AdminApiKeysPage from './cabinet/pages/admin/AdminApiKeysPage'

export default function App() {
  return (
    <AuthProvider>
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
        <Route path="/account/2fa" element={<TwoFaPage />} />
        <Route path="/account/2fa/" element={<TwoFaPage />} />
        <Route path="/account/security" element={<SecuritySetupPage />} />
        <Route path="/account/security/" element={<SecuritySetupPage />} />
        <Route path="/account/forgot" element={<ForgotPasswordPage />} />
        <Route path="/account/forgot/" element={<ForgotPasswordPage />} />
        <Route path="/account/reset" element={<ResetPasswordPage />} />
        <Route path="/account/reset/" element={<ResetPasswordPage />} />
        <Route path="/account/invite" element={<InviteAcceptPage />} />
        <Route path="/account/invite/" element={<InviteAcceptPage />} />

        <Route
          path="/cabinet"
          element={
            <ProtectedRoute>
              <CabinetLayout />
            </ProtectedRoute>
          }
        >
          <Route
            index
            element={
              <ProtectedRoute roles={['client']}>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="operations"
            element={
              <ProtectedRoute roles={['client']}>
                <OperationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="invoices"
            element={
              <ProtectedRoute roles={['client']}>
                <InvoicesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="documents"
            element={
              <ProtectedRoute roles={['client']}>
                <DocumentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="tariffs"
            element={
              <ProtectedRoute roles={['client']}>
                <TariffsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="company"
            element={
              <ProtectedRoute roles={['client']}>
                <CompanyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="notifications"
            element={
              <ProtectedRoute roles={['client']}>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="crm"
            element={
              <ProtectedRoute roles={['client']}>
                <CrmIntegrationPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="admin"
            element={
              <ProtectedRoute roles={['admin', 'accountant']}>
                <AdminOverviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/companies"
            element={
              <ProtectedRoute roles={['admin', 'accountant']}>
                <AdminCompaniesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/users"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/projects"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminProjectsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/payments"
            element={
              <ProtectedRoute roles={['admin', 'accountant']}>
                <AdminPaymentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/balance"
            element={
              <ProtectedRoute roles={['admin', 'accountant']}>
                <AdminBalancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/api-keys"
            element={
              <ProtectedRoute roles={['admin', 'accountant']}>
                <AdminApiKeysPage />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
