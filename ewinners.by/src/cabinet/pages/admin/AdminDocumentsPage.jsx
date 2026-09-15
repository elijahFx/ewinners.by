import { useEffect, useMemo, useState } from 'react'
import { Download, Eye, FileText } from 'lucide-react'
import { api, apiDownload, apiOpen } from '../../api'
import { statusLabel } from '../../statusLabels'
import Button from '../../ui/Button'
import SearchField from '../../ui/SearchField'

const TYPE_LABEL = {
  invoice: 'Счёт',
  act: 'Акт',
  detail: 'Детализация',
  contract: 'Договор',
  report: 'Отчёт',
  addendum: 'Доп. соглашение',
  other: 'Документ',
}

const TYPE_TABS = [
  { id: '', label: 'Все' },
  { id: 'invoice', label: 'Счета' },
  { id: 'act', label: 'Акты' },
  { id: 'detail', label: 'Детализация' },
  { id: 'contract', label: 'Договоры' },
  { id: 'other', label: 'Прочее' },
]

function money(v) {
  if (v == null || v === '') return '—'
  return `${Number(v).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} BYN`
}

function monthStartIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

const fieldClass =
  'cab-select mt-1.5 h-10 w-full rounded-lg border border-[#2a5f8f] bg-[#0c2344] px-3 text-sm font-medium text-[#f3f8ff] outline-none focus:ring-2 focus:ring-[#4ea8ff]/35'

export default function AdminDocumentsPage() {
  const [items, setItems] = useState([])
  const [companies, setCompanies] = useState([])
  const [type, setType] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState(monthStartIso)
  const [to, setTo] = useState(todayIso)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (type) p.set('type', type)
    if (companyId) p.set('companyId', companyId)
    if (q.trim()) p.set('q', q.trim())
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    return p.toString()
  }, [type, companyId, q, from, to])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [docs, comps] = await Promise.all([
        api(`/api/admin/documents${queryString ? `?${queryString}` : ''}`),
        api('/api/admin/companies'),
      ])
      setItems(docs.items || [])
      setCompanies(comps.items || [])
    } catch (err) {
      setError(err.message)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [queryString])

  function resetPeriod() {
    setFrom(monthStartIso())
    setTo(todayIso())
  }

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 flex items-center gap-2 text-[28px] font-bold leading-tight text-white">
            <FileText size={26} />
            Документы клиентов
          </h1>
          <p className="mt-1 text-sm text-[#9db8d4]">
            Все документы всех организаций: счета, акты, детализации. Фильтр по клиенту и периоду.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.id || 'all'}
            type="button"
            className={`cab-btn${type === tab.id ? ' primary' : ' ghost'}`}
            onClick={() => setType(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Организация
            <select
              className={fieldClass}
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">Все организации</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.unp ? ` · УНП ${c.unp}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Поиск
            <SearchField
              className="mt-1.5"
              value={q}
              placeholder="Название, номер, УНП…"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            С
            <input
              type="date"
              className={fieldClass}
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            По
            <input
              type="date"
              className={fieldClass}
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={resetPeriod}>
            Сбросить период
          </Button>
          <span className="self-center text-sm text-[#9db8d4]">
            Найдено: {loading ? '…' : items.length}
          </span>
        </div>
      </div>

      {error ? <div className="cab-alert">{error}</div> : null}

      <div className="cab-card">
        <div className="cab-table-wrap">
          <table className="cab-table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Тип</th>
                <th>Название</th>
                <th>Номер</th>
                <th>Дата</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="font-semibold text-[#f3f8ff]">{d.company_name}</div>
                    {d.company_unp ? (
                      <div className="text-xs text-[#9db8d4]">УНП {d.company_unp}</div>
                    ) : null}
                  </td>
                  <td>{TYPE_LABEL[d.type] || d.type}</td>
                  <td>{d.title}</td>
                  <td>{d.number || '—'}</td>
                  <td>
                    {d.created_at
                      ? new Date(d.created_at).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td>{money(d.amount)}</td>
                  <td>
                    <span className="cab-chip">{statusLabel(d.status)}</span>
                  </td>
                  <td>
                    {d.file_path ? (
                      <div className="cab-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            apiOpen(`/api/admin/documents/${d.id}/view`).catch((e) =>
                              setError(e.message),
                            )
                          }
                        >
                          <Eye size={14} />
                          Смотреть
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            apiDownload(
                              `/api/admin/documents/${d.id}/download`,
                              `${d.number || d.id}.pdf`,
                            ).catch((e) => setError(e.message))
                          }
                        >
                          <Download size={14} />
                          Скачать
                        </Button>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length ? (
            <div className="cab-empty">Документов по фильтру нет</div>
          ) : null}
          {loading ? <div className="cab-empty">Загрузка…</div> : null}
        </div>
      </div>
    </div>
  )
}
