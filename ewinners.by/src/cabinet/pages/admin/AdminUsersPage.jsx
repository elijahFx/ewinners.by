import { useEffect, useRef, useState } from 'react'
import { Building2, Copy, KeyRound, Plus, Trash2, X } from 'lucide-react'
import { api, mediaUrl } from '../../api'
import { statusLabel } from '../../statusLabels'

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

const COLS_KEY = 'ew_admin_users_cols_v6'
// Pixel-ish weights for a wide scrollable table (sum ≈ 1280)
const DEFAULT_COLS = {
  avatar: 56,
  name: 180,
  email: 220,
  phone: 130,
  role: 110,
  company: 200,
  status: 110,
  actions: 320,
}
const MIN_COLS = {
  avatar: 48,
  name: 120,
  email: 150,
  phone: 100,
  role: 90,
  company: 140,
  status: 90,
  actions: 280,
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

function tableWidth(cols) {
  return Object.values(cols).reduce((sum, value) => sum + value, 0)
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

function ResizableTh({ label, colKey, widthPx, onResizeStart }) {
  return (
    <th
      style={{ width: widthPx, minWidth: widthPx, maxWidth: widthPx }}
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
  const [orgsUser, setOrgsUser] = useState(null)
  const [linkedCompanies, setLinkedCompanies] = useState([])
  const [addCompanyId, setAddCompanyId] = useState('')
  const [orgsBusy, setOrgsBusy] = useState(false)
  const [cols, setCols] = useState(loadCols)
  const tableWrapRef = useRef(null)
  const colOrder = ['avatar', 'name', 'email', 'phone', 'role', 'company', 'status', 'actions']
  const totalTableWidth = tableWidth(cols)

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
    const startX = e.clientX
    const startCols = { ...cols }

    const onMove = (ev) => {
      const delta = ev.clientX - startX
      const next = { ...startCols }
      next[key] = Math.max(MIN_COLS[key], startCols[key] + delta)
      setCols(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function openOrgs(user) {
    setOrgsUser(user)
    setAddCompanyId('')
    setOrgsBusy(true)
    try {
      const data = await api(`/api/admin/users/${user.id}/companies`)
      setLinkedCompanies(data.items || [])
    } catch (err) {
      alert(err.message)
      setOrgsUser(null)
    } finally {
      setOrgsBusy(false)
    }
  }

  async function linkCompany() {
    if (!orgsUser || !addCompanyId) return
    setOrgsBusy(true)
    try {
      const data = await api(`/api/admin/users/${orgsUser.id}/companies`, {
        method: 'POST',
        body: { companyId: Number(addCompanyId), makeDefault: linkedCompanies.length === 0 },
      })
      setLinkedCompanies(data.items || [])
      setAddCompanyId('')
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setOrgsBusy(false)
    }
  }

  async function unlinkCompany(companyId) {
    if (!orgsUser) return
    if (!confirm('Отвязать эту организацию от пользователя?')) return
    setOrgsBusy(true)
    try {
      const data = await api(`/api/admin/users/${orgsUser.id}/companies/${companyId}`, {
        method: 'DELETE',
      })
      setLinkedCompanies(data.items || [])
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setOrgsBusy(false)
    }
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
    { value: 'client', label: 'Клиент' },
    { value: 'manager', label: 'Менеджер' },
    { value: 'accountant', label: 'Бухгалтер' },
    { value: 'admin', label: 'Админ' },
  ]
  const statusOptions = [
    { value: 'active', label: 'Активен' },
    { value: 'blocked', label: 'Заблокирован' },
    { value: 'invited', label: 'Приглашён' },
  ]
  const companyOptions = [
    { value: '', label: 'Без организации' },
    ...companies.map((c) => ({ value: String(c.id), label: c.name })),
  ]

  const field =
    'mt-1.5 w-full rounded-lg border border-[#2a5f8f] bg-[#071529] px-3 py-2.5 text-sm font-medium text-[#f3f8ff] outline-none focus:border-[#4ea8ff]'

  const cell = 'border-b border-[#1e4a73] bg-transparent px-1 py-1'
  const head = 'border-b border-[#1e4a73] bg-transparent'
  return (
    <div className="space-y-5 text-[#f3f8ff]" style={{ minWidth: 0, maxWidth: '100%' }}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Пользователи</h1>
          <p className="mt-1 text-sm text-[#9db8d4]">
            Клик по ячейке — правка. Таблицу можно прокручивать вправо, если не хватает ширины.
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
              Основная организация
              <select className={`${field} text-base font-semibold`} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
                {companyOptions.map((o) => (
                  <option key={String(o.value)} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-[#9db8d4]">
                Дополнительные организации можно привязать позже кнопкой «Орг.» в таблице.
              </span>
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

      {orgsUser ? (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0d213f] p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="m-0 flex items-center gap-2 text-base font-bold text-white">
                <Building2 size={16} className="text-[#8fd2ff]" />
                Организации: {orgsUser.full_name || orgsUser.email}
              </h2>
              <p className="mt-1 mb-0 text-sm text-[#9db8d4]">
                Создайте компанию в разделе «Клиенты», затем привяжите её к пользователю здесь.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] px-3 py-2 text-xs font-bold text-[#eaf4ff] hover:bg-white/[0.1]"
              onClick={() => setOrgsUser(null)}
            >
              <X size={14} /> Закрыть
            </button>
          </div>

          <div className="mb-4 flex flex-wrap items-end gap-2">
            <label className="block min-w-[240px] flex-1 text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Добавить организацию
              <select
                className={field}
                value={addCompanyId}
                onChange={(e) => setAddCompanyId(e.target.value)}
              >
                <option value="">Выберите компанию</option>
                {companies
                  .filter((c) => !linkedCompanies.some((lc) => Number(lc.id) === Number(c.id)))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.unp ? ` · УНП ${c.unp}` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              disabled={orgsBusy || !addCompanyId}
              onClick={linkCompany}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#258dff] px-4 text-sm font-bold text-white hover:bg-[#3b9eff] disabled:opacity-50"
            >
              <Plus size={14} /> Привязать
            </button>
          </div>

          <div className="space-y-2">
            {linkedCompanies.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5"
              >
                <div>
                  <div className="font-semibold text-white">
                    {c.name}
                    {c.isActive ? (
                      <span className="ml-2 text-[11px] font-bold text-[#8fd2ff]">активная</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-[#9db8d4]">УНП {c.unp || '—'}</div>
                </div>
                <button
                  type="button"
                  disabled={orgsBusy}
                  onClick={() => unlinkCompany(c.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-[#e11d48]/90 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[#fb7185]"
                >
                  <Trash2 size={12} /> Отвязать
                </button>
              </div>
            ))}
            {!linkedCompanies.length && !orgsBusy ? (
              <div className="rounded-xl bg-white/[0.03] px-3 py-6 text-center text-sm text-[#9db8d4]">
                К пользователю пока не привязано ни одной организации
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={tableWrapRef}
        style={{
          width: '100%',
          maxWidth: '100%',
          overflowX: 'scroll',
          overflowY: 'visible',
          WebkitOverflowScrolling: 'touch',
          borderRadius: 16,
          border: '1px solid #2a5f8f',
          background: '#0b1f3a',
        }}
      >
        <table
          style={{
            tableLayout: 'fixed',
            width: totalTableWidth,
            minWidth: totalTableWidth,
            borderCollapse: 'separate',
            borderSpacing: 0,
          }}
        >
          <colgroup>
            {colOrder.map((key) => (
              <col key={key} style={{ width: cols[key], minWidth: cols[key] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className={`${head} px-2 py-3`}
                style={{ width: cols.avatar, minWidth: cols.avatar }}
              />
              <ResizableTh label="ФИО" colKey="name" widthPx={cols.name} onResizeStart={onResizeStart} />
              <ResizableTh label="Email" colKey="email" widthPx={cols.email} onResizeStart={onResizeStart} />
              <ResizableTh label="Телефон" colKey="phone" widthPx={cols.phone} onResizeStart={onResizeStart} />
              <ResizableTh label="Роль" colKey="role" widthPx={cols.role} onResizeStart={onResizeStart} />
              <ResizableTh
                label="Организация"
                colKey="company"
                widthPx={cols.company}
                onResizeStart={onResizeStart}
              />
              <ResizableTh label="Статус" colKey="status" widthPx={cols.status} onResizeStart={onResizeStart} />
              <th
                className={`${head} px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#9db8d4]`}
                style={{ width: cols.actions, minWidth: cols.actions }}
              >
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
              {items.map((u) => (
                <tr key={u.id} className="bg-transparent hover:bg-[#122a4d]/70">
                  <td className={`${cell} px-2 py-2`} style={{ width: cols.avatar, minWidth: cols.avatar }}>
                    <label className="grid h-9 w-9 cursor-pointer place-items-center overflow-hidden rounded-full border border-[#2a5f8f] bg-[#1a3a63] text-sm font-extrabold text-white">
                      {u.avatar_url ? (
                        <img src={mediaUrl(u.avatar_url)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span>{(u.full_name || '?').slice(0, 1)}</span>
                      )}
                      <input type="file" accept="image/*" hidden onChange={(e) => uploadAvatar(u, e.target.files?.[0])} />
                    </label>
                  </td>
                  <td className={cell} style={{ width: cols.name, minWidth: cols.name }}>
                    <InlineCell value={u.full_name} onSave={(fullName) => patchUser(u.id, { fullName })} />
                  </td>
                  <td className={cell} style={{ width: cols.email, minWidth: cols.email }}>
                    <InlineCell type="email" value={u.email} onSave={(email) => patchUser(u.id, { email })} />
                  </td>
                  <td className={cell} style={{ width: cols.phone, minWidth: cols.phone }}>
                    <InlineCell value={u.phone || ''} display={u.phone || '—'} onSave={(phone) => patchUser(u.id, { phone })} />
                  </td>
                  <td className={cell} style={{ width: cols.role, minWidth: cols.role }}>
                    <InlineCell type="select" value={u.role} display={statusLabel(u.role)} options={roleOptions} onSave={(role) => patchUser(u.id, { role })} />
                  </td>
                  <td className={cell} style={{ width: cols.company, minWidth: cols.company }}>
                    <div className="px-1 py-1 text-sm">
                      <div className="font-medium text-[#eaf4ff]">{u.company_name || '—'}</div>
                      {Number(u.companies_count) > 1 ? (
                        <div className="text-[11px] text-[#9db8d4]">
                          ещё {Number(u.companies_count) - 1}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className={cell} style={{ width: cols.status, minWidth: cols.status }}>
                    <InlineCell type="select" value={u.status} display={statusLabel(u.status)} options={statusOptions} onSave={(status) => patchUser(u.id, { status })} />
                  </td>
                  <td className={`${cell} px-3 py-2`} style={{ width: cols.actions, minWidth: cols.actions }}>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      {u.role === 'client' ? (
                        <button
                          type="button"
                          title="Организации пользователя"
                          onClick={() => openOrgs(u)}
                          className="inline-flex items-center gap-1 rounded-md border-0 bg-[#0b3a66] px-2.5 py-1.5 text-xs font-extrabold text-[#8fd2ff] hover:bg-[#134878]"
                        >
                          <Building2 size={13} />
                          Орг.
                        </button>
                      ) : null}
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
                        Пригласить
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
  )
}
