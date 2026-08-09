import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Receipt,
  FileText,
  Wallet,
  Bell,
  Building2,
  LogOut,
  Shield,
  Users,
  FolderKanban,
  ArrowLeftRight,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import './cabinet.css'

export default function CabinetLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const isStaff = user && ['admin', 'accountant'].includes(user.role)

  const clientLinks = [
    { to: '/cabinet', end: true, label: 'Обзор', icon: LayoutDashboard },
    { to: '/cabinet/operations', label: 'Операции', icon: ArrowLeftRight },
    { to: '/cabinet/invoices', label: 'Счета', icon: Receipt },
    { to: '/cabinet/documents', label: 'Документы', icon: FileText },
    { to: '/cabinet/tariffs', label: 'Тарифы', icon: Wallet },
    { to: '/cabinet/company', label: 'Реквизиты', icon: Building2 },
    { to: '/cabinet/notifications', label: 'Уведомления', icon: Bell },
  ]

  const adminLinks = [
    { to: '/cabinet/admin', end: true, label: 'Админ-обзор', icon: Shield },
    { to: '/cabinet/admin/companies', label: 'Клиенты', icon: Building2 },
    { to: '/cabinet/admin/users', label: 'Пользователи', icon: Users },
    { to: '/cabinet/admin/projects', label: 'Проекты', icon: FolderKanban },
    { to: '/cabinet/admin/payments', label: 'Платежи', icon: Receipt },
    { to: '/cabinet/admin/balance', label: 'Корректировки', icon: Wallet },
  ]

  const links = isStaff ? adminLinks : clientLinks

  return (
    <div className="cab-shell">
      <aside className="cab-sidebar">
        <div className="cab-brand">
          <img src="/e-winners-logo.jpeg" alt="" />
          <div>
            <strong>E-Winners</strong>
            <span>Личный кабинет</span>
          </div>
        </div>

        <nav className="cab-nav">
          {links.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="cab-sidebar-foot">
          <div className="cab-user">
            <strong>{user?.fullName}</strong>
            <span>{user?.email}</span>
            <em>{user?.role}</em>
          </div>
          <button
            type="button"
            className="cab-logout"
            onClick={() => {
              logout()
              navigate('/account')
            }}
          >
            <LogOut size={16} /> Выйти
          </button>
        </div>
      </aside>

      <main className="cab-main">
        <Outlet />
      </main>
    </div>
  )
}
