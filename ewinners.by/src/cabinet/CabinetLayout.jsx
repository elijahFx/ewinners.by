import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
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
  MessageCircle,
  Tags,
  ArrowDownRight,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { api, mediaUrl } from './api'
import './cabinet.css'

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 220
const SIDEBAR_STORAGE_KEY = 'ew_sidebar_width'

function readSidebarWidth() {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_STORAGE_KEY))
    if (Number.isFinite(saved)) {
      return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, saved))
    }
  } catch {
    /* ignore */
  }
  return SIDEBAR_DEFAULT
}

export default function CabinetLayout() {
  const { user, company, companies, switchCompany, logout, refresh } = useAuth()
  const navigate = useNavigate()
  const isStaff = user && ['admin', 'accountant'].includes(user.role)
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const [chatPending, setChatPending] = useState(0)
  const widthRef = useRef(sidebarWidth)

  useEffect(() => {
    widthRef.current = sidebarWidth
  }, [sidebarWidth])

  const refreshChatPending = useCallback(async () => {
    if (!user) {
      setChatPending(0)
      return
    }
    try {
      const data = await api('/api/chat/unread-count')
      setChatPending(Number(data.count) || 0)
    } catch {
      setChatPending(0)
    }
  }, [user])

  useEffect(() => {
    refreshChatPending()
    const onRefresh = () => refreshChatPending()
    window.addEventListener('ew-chat-unread-refresh', onRefresh)
    const timer = setInterval(refreshChatPending, 30000)
    return () => {
      window.removeEventListener('ew-chat-unread-refresh', onRefresh)
      clearInterval(timer)
    }
  }, [refreshChatPending])

  useEffect(() => {
    const token = localStorage.getItem('ew_token')
    if (!token || !user) return undefined
    const API_BASE = (import.meta.env.VITE_API_URL || 'https://178.172.137.114.sslip.io').replace(/\/$/, '')
    const socket = io(API_BASE, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
    })
    socket.on('chat:unread-changed', refreshChatPending)
    socket.on('chat:conversation-updated', refreshChatPending)
    return () => socket.disconnect()
  }, [user, refreshChatPending])

  const clientLinks = [
    { to: '/cabinet', end: true, label: 'Обзор', icon: LayoutDashboard },
    { to: '/cabinet/operations', label: 'Операции', icon: ArrowLeftRight },
    { to: '/cabinet/invoices', label: 'Счета', icon: Receipt },
    { to: '/cabinet/documents', label: 'Документы', icon: FileText },
    { to: '/cabinet/tariffs', label: 'Тарифы', icon: Wallet },
    { to: '/cabinet/company', label: 'Организации', icon: Building2 },
    { to: '/cabinet/notifications', label: 'Уведомления', icon: Bell },
    { to: '/cabinet/chat', label: 'Чат', icon: MessageCircle },
    { to: '/cabinet/crm', label: 'Интеграция CRM', icon: Cable },
  ]

  const adminLinks = [
    { to: '/cabinet/admin', end: true, label: 'Админ-обзор', icon: Shield },
    { to: '/cabinet/admin/chat', label: 'Чат', icon: MessageCircle },
    { to: '/cabinet/admin/companies', label: 'Клиенты', icon: Building2 },
    { to: '/cabinet/admin/users', label: 'Пользователи', icon: Users },
    { to: '/cabinet/admin/projects', label: 'Проекты', icon: FolderKanban },
    { to: '/cabinet/admin/invoices', label: 'Счета', icon: Receipt },
    { to: '/cabinet/admin/documents', label: 'Документы', icon: FileText },
    { to: '/cabinet/admin/banking', label: 'Банкинг', icon: Landmark },
    { to: '/cabinet/admin/balance', label: 'Корректировки', icon: Wallet },
    { to: '/cabinet/admin/write-offs', label: 'Списания', icon: ArrowDownRight },
    { to: '/cabinet/admin/tariffs', label: 'Тарифы', icon: Tags },
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

  function onResizePointerDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setResizing(true)
  }

  function onResizePointerMove(e) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX))
    widthRef.current = next
    setSidebarWidth(next)
  }

  function onResizePointerUp(e) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setResizing(false)
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(widthRef.current))
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={`cab-shell${resizing ? ' is-resizing-sidebar' : ''}`}
      style={{ '--cab-sidebar-width': `${sidebarWidth}px` }}
    >
      <aside className="cab-sidebar">
        <div
          className={`cab-sidebar-resizer${resizing ? ' is-dragging' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину меню"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={sidebarWidth}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        />

        <a
          className="cab-brand"
          href="https://ewinners.by"
          target="_blank"
          rel="noopener noreferrer"
          title="ewinners.by"
        >
          <img src="/e-winners-logo.jpeg" alt="" />
          <strong>E-Winners</strong>
        </a>

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
            <span className="cab-user-avatar-wrap">
              {user?.avatarUrl ? (
                <img className="cab-user-avatar" src={mediaUrl(user.avatarUrl)} alt="" />
              ) : (
                <span className="cab-user-avatar">{(user?.fullName || '?').slice(0, 1)}</span>
              )}
              {chatPending > 0 ? (
                <em className="cab-chat-pending-badge" title="Диалоги, требующие ответа">
                  {chatPending > 99 ? '99+' : chatPending}
                </em>
              ) : null}
            </span>
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
