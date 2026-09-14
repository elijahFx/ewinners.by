import { useEffect, useState } from 'react'
import { Building2, Check } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../AuthContext'

const ENTITY_LABELS = {
  ooo: 'ООО / юрлицо',
  ip: 'ИП',
  other: 'Другое',
}

export default function CompanyPage() {
  const { company, refresh } = useAuth()
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const data = await api('/api/cabinet/companies')
    setItems(data.items || [])
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  async function activate(id) {
    setBusy(true)
    setError('')
    try {
      await api(`/api/cabinet/companies/${id}/activate`, { method: 'POST' })
      await refresh()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div>
        <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Организации</h1>
        <p className="mt-1 text-sm text-[#9db8d4]">
          Организации назначает администратор. Здесь можно только просматривать и переключать активную.
          {company?.name ? (
            <>
              {' '}
              Сейчас: <strong className="text-[#8fd2ff]">{company.name}</strong>
            </>
          ) : null}
        </p>
      </div>

      {error ? <div className="cab-alert">{error}</div> : null}

      <div className="grid gap-3">
        {items.map((c) => (
          <div
            key={c.id}
            className={`rounded-2xl border bg-[#0b1f3a] p-4 ${
              c.isActive ? 'border-[#8fd2ff]/55' : 'border-white/[0.06]'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Building2 size={16} className="text-[#8fd2ff]" />
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
                {c.legalAddress ? (
                  <p className="mt-1 mb-0 text-xs text-[#9db8d4]">{c.legalAddress}</p>
                ) : null}
              </div>
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
            </div>
          </div>
        ))}
        {!items.length && (
          <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-8 text-center text-[#9db8d4]">
            Организаций пока нет. Обратитесь к администратору — он создаст компанию и привяжет её к вашему аккаунту.
          </div>
        )}
      </div>
    </div>
  )
}
