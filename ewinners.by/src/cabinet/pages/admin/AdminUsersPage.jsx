import { useEffect, useRef, useState } from 'react'
import { Copy, KeyRound, Plus, Trash2, X } from 'lucide-react'
import { api, mediaUrl } from '../../api'

const emptyForm = {
  email: '',
  fullName: '',
  phone: '',
  role: 'client',
  companyId: '',
  password: '',
  passwordMode: 'invite',
  mustSetPassword: true,
  sendInvite: true,
}

const COLS_KEY = 'ew_admin_users_cols_v5'
// Relative weights — table always stretches to 100% width
const DEFAULT_COLS = {
  avatar: 5,
  name: 16,
  email: 18,
  phone: 11,
  role: 9,
  company: 16,
  status: 10,
  actions: 15,
}
const MIN_COLS = {
  avatar: 4,
  name: 10,
  email: 12,
  phone: 8,
  role: 7,
  company: 10,
  status: 8,
  actions: 14,
}

function loadCols() {
  try {
    const raw = localStorage.getItem(COLS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    const next = { ...DEFAULT_COLS, ...parsed }
    for (const key of Object.keys(DEFAULT_COLS)) {
      next[key] = Math.max(MIN_COLS[key], Number(next[key]) || DEFAULT_COLS[key])
    }
    return next
  } catch {
    return { ...DEFAULT_COLS }
  }
}

function toPercents(cols) {
  const total = Object.values(cols).reduce((sum, value) => sum + value, 0) || 1
  return Object.fromEntries(
    Object.entries(cols).map(([key, value]) => [key, (value / total) * 100]),
  )
}

function generateClientPassword(length = 14) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%&*?'
  const all = upper + lower + digits + symbols
  const pick = (s) => s[Math.floor(Math.random() * s.length)]
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)]
  while (chars.length < length) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function InlineCell({ value, display, type = 'text', options, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef(null)
  const label = display ?? value ?? '—'

  useEffect(() => {
    if (!editing) return
    setDraft(value ?? '')
    requestAnimationFrame(() => ref.current?.focus())
  }, [editing, value])

  async function commit(next = draft) {
    setEditing(false)
    if (String(next ?? '') === String(value ?? '')) return
    try {
      await onSave(next ?? '')
    } catch (err) {
      alert(err.message)
    }
  }

  if (!editing) {
    return (
      <div
        role="button"
        tabIndex={0}
        title={String(label)}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setEditing(true)
        }}
        className="w-full cursor-text truncate rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-[#f3f8ff] hover:bg-[#1a3a63]"
      >
        {label}
      </div>
    )
  }

  if (type === 'select') {
    return (
      <select
        ref={ref}
        value={draft}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setEditing(false)}
        className="w-full rounded-md border border-[#4ea8ff] bg-[#071529] px-2 py-1.5 text-[13px] font-semibold text-white outline-none"
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={opt.value} className="bg-[#071529] text-white">
            {opt.label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      ref={ref}
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      className="w-full rounded-md border border-[#4ea8ff] bg-[#071529] px-2 py-1.5 text-[13px] font-semibold text-white outline-none"
    />
  )
}

function ResizableTh({ label, colKey, widthPct, onResizeStart }) {
  return (
    <th
      style={{ width: `${widthPct}%` }}
      className="relative border-b border-[#1e4a73] bg-transparent px-2 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9db8d4]"
    >
      <span className="block truncate pr-2">{label}</span>
      <span
        onMouseDown={(e) => onResizeStart(e, colKey)}
        className="absolute inset-y-0 -right-1 z-10 w-3 cursor-col-resize"
      >
        <span className="absolute inset-y-2 left-1 w-0.5 rounded bg-[#4ea8ff]/50 hover:bg-[#7ec4ff]" />
      </span>
    </th>
  )
}

export default function AdminUsersPage() {
  const [items, setItems] = useState([])
  const [companies, setCompanies] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [created, setCreated] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [cols, setCols] = useState(loadCols)
  const tableWrapRef = useRef(null)
  const colOrder = ['avatar', 'name', 'email', 'phone', 'role', 'company', 'status', 'actions']
  const pct = toPercents(cols)

  useEffect(() => {
    localStorage.setItem(COLS_KEY, JSON.stringify(cols))
  }, [cols])

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  async function load() {
    const [users, comps] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/companies'),
    ])
    setItems(users.items)
    setCompanies(comps.items)
  }

  function onResizeStart(e, key) {
    e.preventDefault()
    e.stopPropagation()
    const wrap = tableWrapRef.current
    if (!wrap) return
    const totalWidth = wrap.clientWidth || 1
    const startX = e.clientX
    const startCols = { ...cols }
    const idx = colOrder.indexOf(key)
    const neighbor = colOrder[idx + 1] || colOrder[idx - 1]
    if (!neighbor || neighbor === 'avatar') return

    const onMove = (ev) => {
      const deltaPct = ((ev.clientX - startX) / totalWidth) * 100
      const next = { ...startCols }
      const desired = startCols[key] + deltaPct
      const clampedKey = Math.max(MIN_COLS[key], desired)
      const used = clampedKey - startCols[key]
      const nextNeighbor = Math.max(MIN_COLS[neighbor], startCols[neighbor] - used)
      const actualUsed = startCols[neighbor] - nextNeighbor
      next[key] = startCols[key] + actualUsed
      next[neighbor] = nextNeighbor
      setCols(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function patchUser(id, body) {
    const result = await api(`/api/admin/users/${id}`, { method: 'PATCH', body })
    if (result.temporaryPassword) {
      setCreated({ email: result.user.email, temporaryPassword: result.temporaryPassword })
    }
    await load()
    return result
  }

  async function create(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        email: form.email,
        fullName: form.fullName,
        phone: form.phone,
        role: form.role,
        companyId: form.companyId ? Number(form.companyId) : null,
        passwordMode: form.passwordMode,
        mustSetPassword: form.mustSetPassword,
        sendInvite: form.sendInvite !== false,
      }
      if ((form.passwordMode === 'manual' || form.passwordMode === 'generate') && form.password) {
        body.password = form.password
      }
      if (form.passwordMode === 'manual' && !form.password) {
        alert('Введите пароль или выберите другой режим')
        return
      }
      const result = await api('/api/admin/users', { method: 'POST', body })
      if (result.passwordMode === 'invite' || result.inviteSent || result.inviteError) {
        setCreated({
          email: result.email,
          inviteSent: result.inviteSent,
          inviteError: result.inviteError,
          temporaryPassword: null,
        })
      } else {
        setCreated({ email: result.email, temporaryPassword: result.temporaryPassword })
      }
      setForm(emptyForm)
      setShowCreate(false)
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeUser(user) {
    if (!confirm(`Удалить ${user.email}?`)) return
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  async function uploadAvatar(user, file) {
    if (!file) return
    const fd = new FormData()
    fd.append('avatar', file)
    try {
      await api(`/api/admin/users/${user.id}/avatar`, { method: 'POST', body: fd })
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  function setPasswordMode(mode) {
    if (mode === 'generate') {
      setForm((prev) => ({
        ...prev,
        passwordMode: mode,
        password: generateClientPassword(),
        mustSetPassword: false,
        sendInvite: false,
      }))
      return
    }
    if (mode === 'invite') {
      setForm((prev) => ({
        ...prev,
        passwordMode: mode,
        password: '',
        mustSetPassword: true,
        sendInvite: true,
      }))
      return
    }
    setForm((prev) => ({
      ...prev,
      passwordMode: mode,
      password: mode === 'manual' ? prev.password : '',
      mustSetPassword: mode === 'auto',
      sendInvite: false,
    }))
  }

  const roleOptions = [
    { value: 'client', label: 'client' },
    { value: 'manager', label: 'manager' },
    { value: 'accountant', label: 'accountant' },
    { value: 'admin', label: 'admin' },
  ]
  const statusOptions = [
    { value: 'active', label: 'active' },
    { value: 'blocked', label: 'blocked' },
    { value: 'invited', label: 'invited' },
  ]
  const companyOptions = [
    { value: '', label: 'Без организации' },
    ...companies.map((c) => ({ value: String(c.id), label: c.name })),
  ]

  const field =
    'mt-1.5 w-full rounded-lg border border-[#2a5f8f] bg-[#071529] px-3 py-2.5 text-sm font-medium text-[#f3f8ff] outline-none focus:border-[#4ea8ff]'

  const cell = 'overflow-hidden border-b border-[#1e4a73] bg-transparent px-1 py-1'
  const head = 'border-b border-[#1e4a73] bg-transparent'
  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Пользователи</h1>
          <p className="mt-1 text-sm text-[#9db8d4]">
            Клик по ячейке — правка. Тяните край заголовка — ширина колонки.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-2 rounded-full border-0 bg-[#258dff] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#3b9eff]"
        >
          {showCreate ? <X size={16} /> : <Plus size={16} />}
          {showCreate ? 'Скрыть' : 'Добавить'}
        </button>
      </div>

      {created && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/50 bg-[#3a2a10] px-4 py-3 text-sm font-semibold text-[#ffe4b0]">
          {created.temporaryPassword ? (
            <>
              <span>
                {created.email}: <span className="font-mono text-white">{created.temporaryPassword}</span>
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(created.temporaryPassword)}
                className="inline-flex items-center gap-1.5 rounded-full border-0 bg-[#258dff] px-3 py-1.5 text-xs font-bold text-white"
              >
                <Copy size={14} /> Копировать
              </button>
            </>
          ) : (
            <span>
              {created.email}:{' '}
              {created.inviteSent
                ? 'приглашение отправлено на email'
                : `пользователь создан, письмо не отправлено${created.inviteError ? ` (${created.inviteError})` : ''}`}
            </span>
          )}
        </div>
      )}

      {showCreate && (
        <form onSubmit={create} className="rounded-2xl border border-[#2a5f8f] bg-[#0d213f] p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Email
              <input className={field} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              ФИО
              <input className={field} required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Телефон
              <input className={field} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Роль
              <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roleOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4] md:col-span-2">
              Организация
              <select className={`${field} text-base font-semibold`} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
                {companyOptions.map((o) => (
                  <option key={String(o.value)} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <div className="space-y-3 md:col-span-2">
              <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Пароль</div>
              <div className="flex flex-wrap gap-2">
                {[
                  ['invite', 'Приглашение'],
                  ['manual', 'Свой'],
                  ['generate', 'Сгенерировать'],
                  ['auto', 'Авто'],
                ].map(([mode, text]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPasswordMode(mode)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                      form.passwordMode === mode
                        ? 'border-[#4ea8ff] bg-[#258dff] text-white'
                        : 'border-[#2a5f8f] bg-transparent text-[#cfe6ff]'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {form.passwordMode === 'invite' && (
                <p className="m-0 text-xs text-[#9db8d4]">
                  На email уйдёт ссылка для задания пароля (статус invited).
                </p>
              )}
              {(form.passwordMode === 'manual' || form.passwordMode === 'generate') && (
                <input
                  className={field}
                  type="text"
                  required={form.passwordMode === 'manual'}
                  placeholder="Пароль"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              )}
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mt-5 rounded-full border-0 bg-[#258dff] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            Создать
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a]">
        <div ref={tableWrapRef} className="w-full overflow-x-auto">
          <table className="w-full border-separate border-spacing-0" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              {colOrder.map((key) => (
                <col key={key} style={{ width: `${pct[key]}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={`${head} px-2 py-3`} style={{ width: `${pct.avatar}%` }} />
                <ResizableTh label="ФИО" colKey="name" widthPct={pct.name} onResizeStart={onResizeStart} />
                <ResizableTh label="Email" colKey="email" widthPct={pct.email} onResizeStart={onResizeStart} />
                <ResizableTh label="Телефон" colKey="phone" widthPct={pct.phone} onResizeStart={onResizeStart} />
                <ResizableTh label="Роль" colKey="role" widthPct={pct.role} onResizeStart={onResizeStart} />
                <ResizableTh label="Организация" colKey="company" widthPct={pct.company} onResizeStart={onResizeStart} />
                <ResizableTh label="Статус" colKey="status" widthPct={pct.status} onResizeStart={onResizeStart} />
                <th
                  className={`${head} px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9db8d4]`}
                  style={{ width: `${pct.actions}%` }}
                >
                  Действия
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="bg-transparent hover:bg-[#122a4d]/70">
                  <td className={`${cell} px-2 py-2`}>
                    <label className="grid h-9 w-9 cursor-pointer place-items-center overflow-hidden rounded-full border border-[#2a5f8f] bg-[#1a3a63] text-sm font-extrabold text-white">
                      {u.avatar_url ? (
                        <img src={mediaUrl(u.avatar_url)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span>{(u.full_name || '?').slice(0, 1)}</span>
                      )}
                      <input type="file" accept="image/*" hidden onChange={(e) => uploadAvatar(u, e.target.files?.[0])} />
                    </label>
                  </td>
                  <td className={cell}>
                    <InlineCell value={u.full_name} onSave={(fullName) => patchUser(u.id, { fullName })} />
                  </td>
                  <td className={cell}>
                    <InlineCell type="email" value={u.email} onSave={(email) => patchUser(u.id, { email })} />
                  </td>
                  <td className={cell}>
                    <InlineCell value={u.phone || ''} display={u.phone || '—'} onSave={(phone) => patchUser(u.id, { phone })} />
                  </td>
                  <td className={cell}>
                    <InlineCell type="select" value={u.role} options={roleOptions} onSave={(role) => patchUser(u.id, { role })} />
                  </td>
                  <td className={cell}>
                    <InlineCell
                      type="select"
                      value={u.company_id ? String(u.company_id) : ''}
                      display={u.company_name || '—'}
                      options={companyOptions}
                      onSave={(companyId) => patchUser(u.id, { companyId: companyId ? Number(companyId) : null })}
                    />
                  </td>
                  <td className={cell}>
                    <InlineCell type="select" value={u.status} options={statusOptions} onSave={(status) => patchUser(u.id, { status })} />
                  </td>
                  <td className={`${cell} px-3 py-2`}>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <button
                        type="button"
                        title="Отправить приглашение на email"
                        onClick={async () => {
                          if (!confirm(`Отправить приглашение на ${u.email}?`)) return
                          try {
                            await api(`/api/admin/users/${u.id}/invite`, { method: 'POST' })
                            setCreated({ email: u.email, inviteSent: true })
                            await load()
                          } catch (err) {
                            alert(err.message)
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-md border-0 bg-[#0ea5e9] px-2.5 py-1.5 text-xs font-extrabold text-white hover:bg-[#38bdf8]"
                      >
                        Invite
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm(`Сгенерировать новый пароль для ${u.email}?`)) return
                          await patchUser(u.id, { passwordMode: 'auto', mustSetPassword: true })
                        }}
                        className="inline-flex items-center gap-1 rounded-md border-0 bg-[#258dff] px-2.5 py-1.5 text-xs font-extrabold text-white hover:bg-[#4ea8ff]"
                      >
                        <KeyRound size={13} />
                        Пароль
                      </button>
                      <button
                        type="button"
                        onClick={() => removeUser(u)}
                        className="inline-flex items-center gap-1 rounded-md border-0 bg-[#e11d48] px-2.5 py-1.5 text-xs font-extrabold text-white hover:bg-[#fb7185]"
                      >
                        <Trash2 size={13} />
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
