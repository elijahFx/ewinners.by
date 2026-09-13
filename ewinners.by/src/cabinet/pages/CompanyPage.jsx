import { useEffect, useState } from 'react'
import { Building2, Plus, Check } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../AuthContext'

const emptyForm = {
  name: '',
  unp: '',
  entityType: 'ooo',
  legalAddress: '',
  bankName: '',
  iban: '',
  bic: '',
  activate: true,
}

const ENTITY_LABELS = {
  ooo: 'ООО / юрлицо',
  ip: 'ИП',
  other: 'Другое',
}

export default function CompanyPage() {
  const { company, refresh } = useAuth()
  const [items, setItems] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ibanStatus, setIbanStatus] = useState('')
  const [unpStatus, setUnpStatus] = useState('')

  async function load() {
    const data = await api('/api/cabinet/companies')
    setItems(data.items || [])
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  useEffect(() => {
    const unp = String(form.unp || '').replace(/\D/g, '')
    if (unp.length !== 9) {
      setUnpStatus(unp.length ? 'УНП: 9 цифр' : '')
      return
    }
    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/lookup/unp/${unp}`)
        setForm((prev) => ({
          ...prev,
          unp: data.unp || unp,
          name: data.name || prev.name,
          legalAddress: data.address || prev.legalAddress,
        }))
        setUnpStatus(data.shortName || data.name || 'Найдено')
      } catch (err) {
        setUnpStatus(err.message || 'Не найдено')
      }
    }, 400)
    return () => clearTimeout(t)
  }, [form.unp])

  useEffect(() => {
    const iban = String(form.iban || '').replace(/\s+/g, '')
    if (iban.replace(/[^A-Za-z0-9]/g, '').length < 8) {
      setIbanStatus('')
      return
    }
    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/lookup/iban?iban=${encodeURIComponent(iban)}`)
        if (data.bankName || data.bic) {
          setForm((prev) => ({
            ...prev,
            bankName: data.bankName || prev.bankName,
            bic: data.bic || prev.bic,
          }))
        }
        setIbanStatus(
          data.bankName
            ? `${data.bankName} · ${data.bic || ''}`
            : data.message || (data.bic ? `БИК: ${data.bic}` : ''),
        )
      } catch (err) {
        setIbanStatus(err.message || '')
      }
    }, 350)
    return () => clearTimeout(t)
  }, [form.iban])

  function startEdit(c) {
    setShowCreate(false)
    setEditingId(c.id)
    setForm({
      name: c.name || '',
      unp: c.unp || '',
      entityType: c.entityType || 'ooo',
      legalAddress: c.legalAddress || '',
      bankName: c.bankName || '',
      iban: c.iban || '',
      bic: c.bic || '',
      activate: false,
    })
    setUnpStatus('')
    setIbanStatus('')
  }

  async function activate(id) {
    setBusy(true)
    try {
      await api(`/api/cabinet/companies/${id}/activate`, { method: 'POST' })
      await refresh()
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    try {
      if (editingId) {
        await api(`/api/cabinet/companies/${editingId}`, {
          method: 'PUT',
          body: {
            name: form.name,
            unp: form.unp,
            entityType: form.entityType,
            legalAddress: form.legalAddress,
            bankName: form.bankName,
            iban: form.iban,
            bic: form.bic,
          },
        })
      } else {
        await api('/api/cabinet/companies', {
          method: 'POST',
          body: form,
        })
      }
      setEditingId(null)
      setShowCreate(false)
      setForm(emptyForm)
      await refresh()
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const field =
    'mt-1.5 h-10 w-full rounded-lg border border-[#2a5f8f] bg-[#071529] px-3 text-sm font-medium text-[#f3f8ff] outline-none focus:border-[#4ea8ff]'

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Организации</h1>
          <p className="mt-1 text-sm text-[#9db8d4]">
            Несколько юрлиц и ИП в одном кабинете. Активная — для баланса, счетов и CRM.
            {company?.name ? (
              <>
                {' '}
                Сейчас: <strong className="text-[#8fd2ff]">{company.name}</strong>
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          className="cab-btn primary"
          onClick={() => {
            setEditingId(null)
            setForm(emptyForm)
            setShowCreate(true)
            setUnpStatus('')
            setIbanStatus('')
          }}
        >
          <Plus size={15} />
          Добавить
        </button>
      </div>

      <div className="grid gap-3">
        {items.map((c) => (
          <div
            key={c.id}
            className="rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4"
            style={c.isActive ? { borderColor: 'rgba(143, 210, 255, 0.55)' } : undefined}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Building2 size={16} color="#8fd2ff" />
                  <strong className="text-white">{c.name}</strong>
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-bold text-[#9db8d4]">
                    {ENTITY_LABELS[c.entityType] || c.entityType}
                  </span>
                  {c.isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[#258dff]/25 px-2 py-0.5 text-[11px] font-bold text-[#8fd2ff]">
                      <Check size={12} /> Активная
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 mb-0 text-sm text-[#9db8d4]">
                  УНП {c.unp || '—'} · баланс{' '}
                  {Number(c.balance || 0).toLocaleString('ru-RU', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  BYN
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!c.isActive ? (
                  <button
                    type="button"
                    className="cab-btn primary"
                    style={{ minHeight: 34, padding: '0 14px', fontSize: 12 }}
                    disabled={busy}
                    onClick={() => activate(c.id)}
                  >
                    Сделать активной
                  </button>
                ) : null}
                <button
                  type="button"
                  className="cab-btn ghost"
                  style={{ minHeight: 34, padding: '0 14px', fontSize: 12 }}
                  onClick={() => startEdit(c)}
                >
                  Редактировать
                </button>
              </div>
            </div>
          </div>
        ))}
        {!items.length && (
          <div className="rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-8 text-center text-[#9db8d4]">
            Организаций пока нет — добавьте юрлицо или ИП
          </div>
        )}
      </div>

      {(showCreate || editingId) && (
        <form
          onSubmit={save}
          className="max-w-2xl space-y-3 rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4 sm:p-5"
        >
          <h2 className="m-0 text-sm font-bold text-white">
            {editingId ? 'Редактирование организации' : 'Новая организация'}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4] sm:col-span-2">
              Тип
              <select
                className={field}
                value={form.entityType}
                onChange={(e) => setForm({ ...form, entityType: e.target.value })}
              >
                <option value="ooo">ООО / юрлицо</option>
                <option value="ip">ИП</option>
                <option value="other">Другое</option>
              </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              УНП
              <input
                className={field}
                value={form.unp}
                onChange={(e) => setForm({ ...form, unp: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                required
              />
              {unpStatus ? <span className="mt-1 block text-[11px] font-normal normal-case text-[#9db8d4]">{unpStatus}</span> : null}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Название
              <input
                className={field}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4] sm:col-span-2">
              Юридический адрес
              <input
                className={field}
                value={form.legalAddress}
                onChange={(e) => setForm({ ...form, legalAddress: e.target.value })}
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4] sm:col-span-2">
              IBAN
              <input
                className={field}
                value={form.iban}
                onChange={(e) => setForm({ ...form, iban: e.target.value.toUpperCase() })}
                placeholder="BY00...."
              />
              {ibanStatus ? <span className="mt-1 block text-[11px] font-normal normal-case text-[#9db8d4]">{ibanStatus}</span> : null}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Банк
              <input
                className={field}
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              БИК
              <input
                className={field}
                value={form.bic}
                onChange={(e) => setForm({ ...form, bic: e.target.value.toUpperCase() })}
              />
            </label>
          </div>
          {!editingId ? (
            <label className="flex items-center gap-2 text-sm text-[#cfe6ff]">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(e) => setForm({ ...form, activate: e.target.checked })}
              />
              Сделать активной сразу после создания
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="submit" className="cab-btn primary" disabled={busy}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button
              type="button"
              className="cab-btn ghost"
              onClick={() => {
                setShowCreate(false)
                setEditingId(null)
                setForm(emptyForm)
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
