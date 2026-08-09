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
  Cable,
  KeyRound,
  ShieldCheck,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { api, mediaUrl } from './api'
import './cabinet.css'

export default function CabinetLayout() {
  const { user, logout, refresh } = useAuth()
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
    { to: '/cabinet/crm', label: 'Интеграция CRM', icon: Cable },
  ]

  const adminLinks = [
    { to: '/cabinet/admin', end: true, label: 'Админ-обзор', icon: Shield },
    { to: '/cabinet/admin/companies', label: 'Клиенты', icon: Building2 },
    { to: '/cabinet/admin/users', label: 'Пользователи', icon: Users },
    { to: '/cabinet/admin/projects', label: 'Проекты', icon: FolderKanban },
    { to: '/cabinet/admin/payments', label: 'Платежи', icon: Receipt },
    { to: '/cabinet/admin/balance', label: 'Корректировки', icon: Wallet },
    { to: '/cabinet/admin/api-keys', label: 'API-ключи', icon: KeyRound },
    ...(user?.role === 'admin'
      ? [{ to: '/account/security', label: 'Безопасность', icon: ShieldCheck }]
      : []),
  ]

  const links = isStaff ? adminLinks : clientLinks

  function doLogout() {
    logout()
    navigate('/account')
  }

  async function onAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('avatar', file)
    try {
      await api('/api/auth/avatar', { method: 'POST', body: fd })
      await refresh()
    } catch (err) {
      alert(err.message)
    } finally {
      e.target.value = ''
    }
  }

  return (
    <div className="cab-shell">
      <aside className="cab-sidebar">
        <div className="cab-brand">
          <img src="/e-winners-logo.jpeg" alt="" />
          <strong>E-Winners</strong>
        </div>

        <nav className="cab-nav">
          {links.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="cab-sidebar-foot">
          <label className="cab-user" title="Сменить аватар">
            {user?.avatarUrl ? (
              <img className="cab-user-avatar" src={mediaUrl(user.avatarUrl)} alt="" />
            ) : (
              <span className="cab-user-avatar">{(user?.fullName || '?').slice(0, 1)}</span>
            )}
            <span className="cab-user-meta">
              <strong>{user?.fullName}</strong>
              <em>{user?.role}</em>
            </span>
            <input type="file" accept="image/*" hidden onChange={onAvatarChange} />
          </label>
          <button type="button" className="cab-logout" onClick={doLogout} title="Выйти">
            <LogOut size={15} />
            <span>Выйти</span>
          </button>
        </div>
      </aside>

      <main className="cab-main">
        <Outlet />
      </main>
    </div>
  )
}
