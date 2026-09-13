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
  Landmark,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { api, mediaUrl } from './api'
import './cabinet.css'

export default function CabinetLayout() {
  const { user, company, companies, switchCompany, logout, refresh } = useAuth()
  const navigate = useNavigate()
  const isStaff = user && ['admin', 'accountant'].includes(user.role)

  const clientLinks = [
    { to: '/cabinet', end: true, label: 'Обзор', icon: LayoutDashboard },
    { to: '/cabinet/operations', label: 'Операции', icon: ArrowLeftRight },
    { to: '/cabinet/invoices', label: 'Счета', icon: Receipt },
    { to: '/cabinet/documents', label: 'Документы', icon: FileText },
    { to: '/cabinet/tariffs', label: 'Тарифы', icon: Wallet },
    { to: '/cabinet/company', label: 'Организации', icon: Building2 },
    { to: '/cabinet/notifications', label: 'Уведомления', icon: Bell },
    { to: '/cabinet/crm', label: 'Интеграция CRM', icon: Cable },
  ]

  const adminLinks = [
    { to: '/cabinet/admin', end: true, label: 'Админ-обзор', icon: Shield },
    { to: '/cabinet/admin/companies', label: 'Клиенты', icon: Building2 },
    { to: '/cabinet/admin/users', label: 'Пользователи', icon: Users },
    { to: '/cabinet/admin/projects', label: 'Проекты', icon: FolderKanban },
    { to: '/cabinet/admin/invoices', label: 'Счета', icon: Receipt },
    { to: '/cabinet/admin/banking', label: 'Банкинг', icon: Landmark },
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

        {!isStaff && companies?.length > 0 ? (
          <div style={{ padding: '0 14px 12px' }}>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'rgba(157, 184, 212, 0.9)',
                marginBottom: 6,
              }}
            >
              Организация
            </label>
            <select
              value={company?.id || user?.companyId || ''}
              onChange={async (e) => {
                const id = Number(e.target.value)
                if (!id) return
                try {
                  await switchCompany(id)
                  window.location.reload()
                } catch (err) {
                  alert(err.message)
                }
              }}
              style={{
                width: '100%',
                minHeight: 38,
                borderRadius: 10,
                border: '1px solid rgba(154, 211, 255, 0.22)',
                background: 'rgba(7, 21, 41, 0.85)',
                color: '#eaf4ff',
                fontSize: 13,
                fontWeight: 600,
                padding: '0 10px',
              }}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

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
