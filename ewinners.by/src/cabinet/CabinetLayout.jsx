import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import {
  LayoutDashboard,
  Receipt,
  FileText,
  Wallet,
  Bell,
  Building2,
  Mail,
  LogOut,
  Shield,
  Users,
  FolderKanban,
  ArrowLeftRight,
  Cable,
  KeyRound,
  ShieldCheck,
  Landmark,
  Tags,
  ArrowDownRight,
  Scale,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { api, mediaUrl } from './api'
import { DIRECTIONS, DIRECTION_STORAGE_KEY, DirectionContext } from './DirectionContext'
import AvatarEditorModal from './ui/AvatarEditorModal'
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
  const location = useLocation()
  const [mailUnread, setMailUnread] = useState(0)
  const isHr = user?.role === 'hr'
  const isStaff = user && ['admin', 'accountant', 'hr'].includes(user.role)
  const [direction, setDirection] = useState(() => {
    // При открытии страницы направления адрес важнее сохранённого выбора.
    const match = location.pathname.match(/^\/cabinet\/admin\/direction\/([^/]+)/)
    const code = match?.[1]?.toLowerCase()
    if (DIRECTIONS.some((d) => d.code === code)) return code
    try {
      return localStorage.getItem(DIRECTION_STORAGE_KEY) || 'hr'
    } catch {
      return 'hr'
    }
  })

  // Единая точка смены направления: сайдбар, рабочее место и «Банкинг»
  // читают одно и то же состояние.
  const applyDirection = useCallback((code) => {
    setDirection(code)
    try {
      localStorage.setItem(DIRECTION_STORAGE_KEY, code)
    } catch {
      /* ignore */
    }
  }, [])

  // Текущее направление берём из адреса: страница рабочего места — это
  // /cabinet/admin/direction/:code, и сайдбар должен показывать то же самое.
  const routeDirection = (() => {
    const match = location.pathname.match(/^\/cabinet\/admin\/direction\/([^/]+)/)
    const code = match?.[1]?.toLowerCase()
    return DIRECTIONS.some((d) => d.code === code) ? code : null
  })()

  useEffect(() => {
    if (routeDirection) applyDirection(routeDirection)
  }, [routeDirection, applyDirection])

  // HR-сотрудник работает только в своём направлении.
  const effectiveDirection = isHr ? 'hr' : direction

  useEffect(() => {
    if (!isHr) return
    const path = location.pathname.replace(/\/+$/, '') || '/'
    const allowed = path === '/cabinet/admin/direction/hr'
    if (!allowed) navigate('/cabinet/admin/direction/hr', { replace: true })
  }, [isHr, location.pathname, navigate])

  function pickDirection(code) {
    applyDirection(code)
    if (isHr) {
      navigate('/cabinet/admin/direction/hr')
      return
    }
    const path = location.pathname.replace(/\/+$/, '') || '/'
    const onWorkspace = path.startsWith('/cabinet/admin/direction/')
    // В HR/Digital остаются только обзор, рабочее место, банкинг и клиенты.
    // Если открыта «глобальная» страница (почта, пользователи, счета…),
    // переключаем на рабочее место, чтобы не остаться на скрытом разделе.
    const scopedPage = [
      '/cabinet/admin',
      '/cabinet/admin/banking',
      '/cabinet/admin/companies',
    ].includes(path)
    if (onWorkspace) {
      navigate(`/cabinet/admin/direction/${code}`)
    } else if (code !== 'kc' && !scopedPage) {
      navigate(`/cabinet/admin/direction/${code}`)
    }
  }
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const [chatPending, setChatPending] = useState(0)
  const [avatarOpen, setAvatarOpen] = useState(false)
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
    // Баланс изменился — открытые страницы сами перечитают данные.
    socket.on('balance:changed', () => {
      window.dispatchEvent(new CustomEvent('ew-balance-changed'))
    })
    return () => socket.disconnect()
  }, [user, refreshChatPending])

  const clientLinks = [
    { to: '/cabinet', end: true, label: 'Обзор', icon: LayoutDashboard },
    { to: '/cabinet/operations', label: 'Операции', icon: ArrowLeftRight },
    { to: '/cabinet/write-offs', label: 'Списания', icon: ArrowDownRight },
    { to: '/cabinet/invoices', label: 'Счета', icon: Receipt },
    { to: '/cabinet/documents', label: 'Документы', icon: FileText },
    { to: '/cabinet/tariffs', label: 'Тарифы', icon: Wallet },
    { to: '/cabinet/company', label: 'Организации', icon: Building2 },
    { to: '/cabinet/notifications', label: 'Уведомления', icon: Bell },
    { to: '/cabinet/crm', label: 'Интеграция CRM', icon: Cable },
  ]

  const adminLinks = [
    { to: '/cabinet/admin', end: true, label: 'Админ-обзор', icon: Shield },
    { to: `/cabinet/admin/direction/${direction}`, label: 'Рабочее место', icon: Building2 },
    { to: '/cabinet/admin/mail', label: 'Почта', icon: Mail },
    { to: '/cabinet/admin/companies', label: 'Клиенты', icon: Building2 },
    { to: '/cabinet/admin/users', label: 'Пользователи', icon: Users },
    { to: '/cabinet/admin/projects', label: 'Проекты', icon: FolderKanban },
    { to: '/cabinet/admin/invoices', label: 'Счета', icon: Receipt },
    { to: '/cabinet/admin/documents', label: 'Документы', icon: FileText },
    { to: '/cabinet/admin/banking', label: 'Банкинг', icon: Landmark },
    { to: '/cabinet/admin/balance', label: 'Корректировки', icon: Wallet },
    { to: '/cabinet/admin/write-offs', label: 'Списания', icon: ArrowDownRight },
    { to: '/cabinet/admin/reconciliation', label: 'Сверка', icon: Scale },
    { to: '/cabinet/admin/tariffs', label: 'Тарифы', icon: Tags },
    { to: '/cabinet/admin/api-keys', label: 'API-ключи', icon: KeyRound },
    ...(user?.role === 'admin'
      ? [{ to: '/account/security', label: 'Безопасность', icon: ShieldCheck }]
      : []),
  ]

  // В HR/Digital не показываем глобальные разделы КЦ: остаются только
  // обзор, рабочее место, банкинг и клиенты этого направления.
  const directionScopedLinks = [
    { to: '/cabinet/admin', end: true, label: 'Админ-обзор', icon: Shield },
    { to: `/cabinet/admin/direction/${direction}`, label: 'Рабочее место', icon: Building2 },
    { to: '/cabinet/admin/banking', label: 'Банкинг', icon: Landmark },
    { to: '/cabinet/admin/companies', label: 'Клиенты', icon: Building2 },
  ]

  // HR-сотруднику нужен только его рабочий стол: ни клиентов, ни других
  // направлений, чтобы не путаться с КЦ.
  const hrLinks = [
    { to: '/cabinet/admin/direction/hr', label: 'Рабочее место', icon: Building2 },
  ]

  // Сотрудник направления видит только своё рабочее место
  // Счётчик непрочитанных писем для бейджа в меню
  useEffect(() => {
    if (!user || !['admin', 'accountant'].includes(user.role)) return
    let alive = true
    function refreshMail() {
      api('/api/mail/status')
        .then((d) => {
          if (alive) setMailUnread(Number(d?.unread || 0))
        })
        .catch(() => {})
    }
    refreshMail()
    const timer = setInterval(refreshMail, 60000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [user])

  const links = isHr
    ? hrLinks
    : isStaff
      ? effectiveDirection === 'kc'
        ? adminLinks
        : directionScopedLinks
      : clientLinks

  function doLogout() {
    logout()
    navigate('/account')
  }

  // Аватар приходит уже обрезанным из модалки-редактора.
  async function saveAvatar(blob) {
    const fd = new FormData()
    fd.append('avatar', blob, 'avatar.jpg')
    await api('/api/auth/avatar', { method: 'POST', body: fd })
    await refresh()
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

  const directionContextValue = useMemo(
    () => ({ direction: effectiveDirection, setDirection: applyDirection }),
    [effectiveDirection, applyDirection],
  )

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

        {isStaff && !isHr ? (
          <div className="cab-direction-picker">
            <span className="cab-direction-picker__label">Направление</span>
            <div className="cab-direction-picker__options">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.code}
                  type="button"
                  className={`cab-direction-picker__btn${direction === d.code ? ' active' : ''}`}
                  onClick={() => pickDirection(d.code)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <nav className="cab-nav">
          {links.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={17} />
              <span>{label}</span>
              {to === '/cabinet/admin/mail' && mailUnread > 0 ? (
                <em className="cab-mail-unread" title={`Непрочитанных писем: ${mailUnread}`}>
                  {mailUnread > 99 ? '99+' : mailUnread}
                </em>
              ) : null}
              {(to === '/cabinet/chat' || to === '/cabinet/admin/chat') && chatPending > 0 ? (
                <em
                  className="cab-chat-pending-badge cab-chat-pending-badge--nav"
                  title="Непрочитанные сообщения"
                >
                  {chatPending > 99 ? '99+' : chatPending}
                </em>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="cab-sidebar-foot">
          <div className="cab-user">
            <button
              type="button"
              className="cab-user-avatar-wrap"
              title="Сменить аватар"
              onClick={() => setAvatarOpen(true)}
              style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              {user?.avatarUrl ? (
                <img className="cab-user-avatar" src={mediaUrl(user.avatarUrl)} alt="" />
              ) : (
                <span className="cab-user-avatar">{(user?.fullName || '?').slice(0, 1)}</span>
              )}
            </button>
            <span className="cab-user-meta">
              <strong>{user?.fullName}</strong>
              <em>{user?.role}</em>
            </span>
          </div>
          <button type="button" className="cab-logout" onClick={doLogout} title="Выйти">
            <LogOut size={15} />
            <span>Выйти</span>
          </button>
        </div>
      </aside>

      <main className="cab-main">
        <DirectionContext.Provider value={directionContextValue}>
          <Outlet />
        </DirectionContext.Provider>
      </main>

      <AvatarEditorModal
        open={avatarOpen}
        userName={user?.fullName || ''}
        currentUrl={user?.avatarUrl ? mediaUrl(user.avatarUrl) : null}
        onClose={() => setAvatarOpen(false)}
        onSave={saveAvatar}
      />
    </div>
  )
}
