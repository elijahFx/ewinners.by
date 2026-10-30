import { useEffect, useMemo, useState } from 'react'
import { api, apiDownload } from '../../api'

const FOLDERS = [
  { id: 'incoming', label: 'Входящие', icon: '📥' },
  { id: 'outgoing', label: 'Отправленные', icon: '📤' },
  { id: 'drafts', label: 'Черновики', icon: '📝' },
  { id: 'spam', label: 'Спам', icon: '🚫' },
  { id: '', label: 'Все письма', icon: '📁' },
]

// Тёмная палитра кабинета: раскладка как в Gmail, цвета родные для E-Winners
const C = {
  bg: '#0b1f3a',
  panel: '#071529',
  border: 'rgba(255,255,255,0.07)',
  hover: 'rgba(255,255,255,0.05)',
  active: 'rgba(37,141,255,0.22)',
  text: '#f3f8ff',
  muted: '#9db8d4',
  blue: '#258dff',
  unreadBg: 'rgba(255,255,255,0.03)',
  compose: 'rgba(37,141,255,0.18)',
  composeText: '#dbeaff',
  field: 'rgba(255,255,255,0.06)',
}

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  }
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatFull(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function senderOf(m) {
  if (m.direction === 'outgoing') return `Кому: ${m.to_address || '—'}`
  return m.from_name || m.from_address || 'Без отправителя'
}

/**
 * Почта в духе Gmail: светлая тема, кнопка «Написать», папки слева,
 * список писем и панель чтения.
 */
export default function AdminMailPage() {
  const [status, setStatus] = useState(null)
  const [folder, setFolder] = useState('incoming')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [opened, setOpened] = useState(null)
  const [attachments, setAttachments] = useState([])

  const [composeOpen, setComposeOpen] = useState(false)
  const [compose, setCompose] = useState({ to: '', cc: '', subject: '', text: '' })
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (folder === 'incoming') p.set('direction', 'incoming')
    else if (folder === 'outgoing') p.set('direction', 'outgoing')
    else if (folder === 'spam') p.set('folder', 'spam')
    else if (folder === 'drafts') p.set('folder', 'drafts')
    if (debounced) p.set('q', debounced)
    return p.toString()
  }, [folder, debounced])

  async function loadStatus() {
    try {
      setStatus(await api('/api/mail/status'))
    } catch {
      /* состояние показывается отдельно */
    }
  }

  async function loadMessages() {
    try {
      setError('')
      const data = await api(`/api/mail/messages${query ? `?${query}` : ''}`)
      setItems(data.items || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])
  useEffect(() => {
    setLoading(true)
    loadMessages()
  }, [query])

  async function sync() {
    setNotice('')
    setError('')
    try {
      const r = await api('/api/mail/sync', { method: 'POST', body: { limit: 100 } })
      const saved = (r.inbox?.saved || 0) + (r.sent?.saved || 0)
      setNotice(saved ? `Загружено новых писем: ${saved}` : 'Новых писем нет')
      await loadMessages()
      await loadStatus()
    } catch (err) {
      setError(err.message)
    }
  }

  async function openMessage(id) {
    try {
      const data = await api(`/api/mail/messages/${id}`)
      setOpened(data.message)
      setAttachments(data.attachments || [])
      setItems((prev) => prev.map((m) => (m.id === id ? { ...m, is_read: 1 } : m)))
      loadStatus()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleRead(m, e) {
    e.stopPropagation()
    const next = !m.is_read
    try {
      await api(`/api/mail/messages/${m.id}/read`, { method: 'POST', body: { isRead: next } })
      setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_read: next ? 1 : 0 } : x)))
      loadStatus()
    } catch (err) {
      setError(err.message)
    }
  }

  async function submitCompose(e) {
    e.preventDefault()
    setSending(true)
    setError('')
    try {
      await api('/api/mail/send', { method: 'POST', body: compose })
      setNotice('Письмо отправлено')
      setCompose({ to: '', cc: '', subject: '', text: '' })
      setComposeOpen(false)
      await loadMessages()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const unread = items.filter((m) => !m.is_read && m.direction === 'incoming').length

  const fieldRow = { display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.border}`, padding: '10px 0' }

  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${C.border}`,
        minHeight: 620,
      }}
    >
      {/* Верхняя панель — как в Gmail: название, поиск, действие */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          background: C.panel,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span style={{ fontSize: '1.02rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Почта</span>
        <div style={{ flex: 1, maxWidth: 620, position: 'relative' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск в почте"
            style={{
              width: '100%',
              height: 40,
              padding: '0 14px 0 38px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: search ? C.field : 'rgba(255,255,255,0.05)',
              fontSize: '0.9rem',
              color: C.text,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <span style={{ position: 'absolute', left: 13, top: 10, color: C.muted }}>🔍</span>
        </div>
        <button
          type="button"
          onClick={sync}
          title="Проверить новую почту"
          style={{
            height: 36,
            padding: '0 14px',
            borderRadius: 18,
            border: `1px solid ${C.border}`,
            background: C.field,
            color: C.text,
            fontSize: '0.84rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Обновить
        </button>
      </div>

      {status && !status.configured ? (
        <div style={{ padding: '10px 16px', background: '#fef7e0', color: '#8a6d1f', fontSize: '0.84rem' }}>
          Ящик не подключён. Укажите MAIL_USER и MAIL_PASS в .env на сервере API.
        </div>
      ) : null}
      {error ? (
        <div style={{ padding: '10px 16px', background: '#fce8e6', color: '#b3261e', fontSize: '0.84rem' }}>{error}</div>
      ) : null}
      {notice ? (
        <div style={{ padding: '10px 16px', background: '#e6f4ea', color: '#146c2e', fontSize: '0.84rem' }}>{notice}</div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: 580 }}>
        {/* Левая колонка */}
        <div style={{ padding: '12px 8px', borderRight: `1px solid ${C.border}`, background: C.panel }}>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 48,
              padding: '0 22px',
              marginBottom: 14,
              borderRadius: 28,
              border: '1px solid rgba(37,141,255,0.35)',
              background: C.compose,
              color: C.composeText,
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,.12)',
            }}
          >
            <span style={{ fontSize: '1.05rem' }}>✏️</span> Написать
          </button>

          {FOLDERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              onClick={() => {
                setFolder(f.id)
                setOpened(null)
                setComposeOpen(false)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                height: 34,
                padding: '0 16px 0 18px',
                borderRadius: 20,
                border: 'none',
                background: folder === f.id ? C.active : 'transparent',
                color: C.text,
                fontSize: '0.86rem',
                fontWeight: folder === f.id ? 700 : 500,
                cursor: 'pointer',
                marginBottom: 2,
                textAlign: 'left',
              }}
            >
              <span style={{ width: 16 }}>{f.icon}</span>
              <span style={{ flex: 1 }}>{f.label}</span>
              {f.id === 'incoming' && unread > 0 ? <span style={{ fontWeight: 700 }}>{unread}</span> : null}
            </button>
          ))}

          <div style={{ marginTop: 18, padding: '0 18px', fontSize: '0.72rem', color: C.muted, lineHeight: 1.5 }}>
            {status?.user || 'ящик не настроен'}
            <br />
            всего писем: {status?.total ?? 0}
          </div>
        </div>

        {/* Правая часть */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {composeOpen ? (
            <form onSubmit={submitCompose} style={{ padding: '18px 24px', maxWidth: 780 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 14 }}>Новое письмо</div>
              {[
                ['Кому', 'to', 'client@example.by'],
                ['Копия', 'cc', 'необязательно'],
                ['Тема', 'subject', 'Тема письма'],
              ].map(([label, key, ph]) => (
                <div key={key} style={fieldRow}>
                  <span style={{ width: 76, fontSize: '0.86rem', color: C.muted }}>{label}</span>
                  <input
                    required={key === 'to'}
                    value={compose[key]}
                    onChange={(e) => setCompose((p) => ({ ...p, [key]: e.target.value }))}
                    placeholder={ph}
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: '0.9rem', background: 'transparent', color: C.text }}
                  />
                </div>
              ))}
              <textarea
                rows={12}
                value={compose.text}
                onChange={(e) => setCompose((p) => ({ ...p, text: e.target.value }))}
                style={{
                  width: '100%',
                  marginTop: 14,
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.92rem',
                  resize: 'vertical',
                  color: C.text,
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button
                  type="submit"
                  disabled={sending}
                  style={{
                    height: 40,
                    padding: '0 26px',
                    borderRadius: 20,
                    border: 'none',
                    background: C.blue,
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '0.88rem',
                    cursor: sending ? 'wait' : 'pointer',
                  }}
                >
                  {sending ? 'Отправляю…' : 'Отправить'}
                </button>
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  style={{
                    height: 40,
                    padding: '0 20px',
                    borderRadius: 20,
                    border: `1px solid ${C.border}`,
                    background: C.bg,
                    color: C.text,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
              </div>
            </form>
          ) : opened ? (
            <div style={{ padding: '16px 24px' }}>
              <button
                type="button"
                onClick={() => setOpened(null)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: C.blue,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: 12,
                }}
              >
                ← Назад
              </button>
              <button
                type="button"
                onClick={() => {
                  const replyTo = opened.direction === 'outgoing' ? opened.to_address : opened.from_address
                  const subj = String(opened.subject || '')
                  setCompose({
                    to: replyTo || '',
                    cc: '',
                    subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`,
                    text: `\n\n--- Исходное письмо ---\n${opened.body_text || ''}`,
                  })
                  setComposeOpen(true)
                }}
                style={{
                  marginLeft: 14,
                  height: 32,
                  padding: '0 16px',
                  borderRadius: 16,
                  border: `1px solid ${C.border}`,
                  background: C.field,
                  color: C.text,
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ↩ Ответить
              </button>
              <h2 style={{ margin: '0 0 14px', fontSize: '1.25rem', fontWeight: 600, color: C.text }}>
                {opened.subject || '(без темы)'}
              </h2>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  paddingBottom: 16,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: C.blue,
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {(senderOf(opened) || '?').slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                    {senderOf(opened)}
                    <span style={{ fontWeight: 400, color: C.muted, fontSize: '0.82rem' }}>
                      {opened.from_address && opened.from_name ? ` <${opened.from_address}>` : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: C.muted, marginTop: 2 }}>
                    кому: {opened.to_address || '—'}
                    {opened.cc_address ? ` · копия: ${opened.cc_address}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: '0.78rem', color: C.muted, whiteSpace: 'nowrap' }}>{formatFull(opened.sent_at)}</div>
              </div>

              {attachments.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                  {attachments.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        apiDownload(`/api/mail/messages/${opened.id}/attachments/${a.id}`, a.filename || 'file').catch((e) =>
                          setError(e.message),
                        )
                      }
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        background: C.field,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        color: C.text,
                      }}
                    >
                      📎 {a.filename} · {Math.round((a.size || 0) / 1024)} КБ
                    </button>
                  ))}
                </div>
              ) : null}

              <div style={{ marginTop: 18, fontSize: '0.92rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {opened.body_text || '(письмо без текста)'}
              </div>
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 16px',
                  borderBottom: `1px solid ${C.border}`,
                  fontSize: '0.78rem',
                  color: C.muted,
                }}
              >
                <span>{loading ? 'Загрузка…' : `${items.length} писем`}</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {!loading && items.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center', color: C.muted, fontSize: '0.9rem' }}>
                    {status?.configured ? 'Писем нет. Нажмите «Обновить».' : 'Ящик не подключён'}
                  </div>
                ) : (
                  items.map((m) => (
                    <div
                      key={m.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openMessage(m.id)}
                      onKeyDown={(e) => e.key === 'Enter' && openMessage(m.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '0 16px',
                        height: 44,
                        borderBottom: `1px solid ${C.border}`,
                        background: m.is_read ? C.bg : C.unreadBg,
                        cursor: 'pointer',
                        fontSize: '0.86rem',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = C.hover
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = m.is_read ? C.bg : C.unreadBg
                      }}
                    >
                      <button
                        type="button"
                        title={m.is_read ? 'Отметить непрочитанным' : 'Отметить прочитанным'}
                        onClick={(e) => toggleRead(m, e)}
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          border: 'none',
                          background: m.is_read ? 'transparent' : C.blue,
                          cursor: 'pointer',
                          flexShrink: 0,
                          padding: 0,
                        }}
                      />
                      <span
                        style={{
                          width: 190,
                          flexShrink: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: m.is_read ? 400 : 700,
                        }}
                      >
                        {senderOf(m)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: m.is_read ? 400 : 700 }}>{m.subject || '(без темы)'}</span>
                        <span style={{ color: C.muted }}> — {m.snippet || ''}</span>
                      </span>
                      {m.has_attachments ? <span style={{ flexShrink: 0 }}>📎</span> : null}
                      <span
                        style={{
                          flexShrink: 0,
                          width: 72,
                          textAlign: 'right',
                          fontSize: '0.78rem',
                          color: m.is_read ? C.muted : C.text,
                          fontWeight: m.is_read ? 400 : 700,
                        }}
                      >
                        {formatDate(m.sent_at)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
