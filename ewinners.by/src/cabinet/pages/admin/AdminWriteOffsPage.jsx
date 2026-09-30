import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { categoryLabel } from '../../statusLabels'
import Skeleton from '../../ui/Skeleton'
import useLiveBalance from '../../useLiveBalance'

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthStart() {
  const d = new Date()
  return localDate(new Date(d.getFullYear(), d.getMonth(), 1))
}

function money(v, currency = 'BYN') {
  return `${Number(v || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`
}

function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const fieldClass =
  'mt-1.5 h-10 w-full rounded-lg border border-transparent bg-white/[0.06] px-3 text-sm font-medium text-[#f3f8ff] outline-none focus:bg-white/[0.09] focus:ring-2 focus:ring-[#4ea8ff]/35'

export default function AdminWriteOffsPage() {
  const [companies, setCompanies] = useState([])
  const [filters, setFilters] = useState({
    from: monthStart(),
    to: localDate(new Date()),
    companyId: '',
    q: '',
  })
  const [debouncedQ, setDebouncedQ] = useState('')
  const [items, setItems] = useState([])
  const [totals, setTotals] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filters.q.trim()), 300)
    return () => clearTimeout(timer)
  }, [filters.q])

  const query = useMemo(() => {
    const p = new URLSearchParams()
    p.set('type', 'debit')
    if (filters.from) p.set('from', filters.from)
    if (filters.to) p.set('to', filters.to)
    if (filters.companyId) p.set('companyId', filters.companyId)
    if (debouncedQ) p.set('q', debouncedQ)
    p.set('limit', '1000')
    return p.toString()
  }, [filters.from, filters.to, filters.companyId, debouncedQ])

  useEffect(() => {
    api('/api/admin/companies')
      .then((d) => setCompanies(d.items || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api(`/api/admin/transactions?${query}`)
      .then((data) => {
        if (cancelled) return
        setItems(data.items || [])
        setTotals(data.totals || null)
        setTruncated(Boolean(data.truncated))
        setLoaded(true)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setItems([])
        setTotals(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, reloadKey])

  // Новое списание — список и итоги обновляются сами.
  useLiveBalance(() => setReloadKey((k) => k + 1))

  const showSkeleton = loading && !loaded
  const debitTotal = Number(totals?.debit_total || 0)
  const debitCount = Number(totals?.debit_count || 0)
  const companyName = companies.find((c) => String(c.id) === String(filters.companyId))?.name

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Списания</h1>
          <p className="mt-1 text-sm text-[#9db8d4]">
            История списаний с баланса клиентов: услуги, суммы и остаток после операции.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Списано за период</div>
          <div className="mt-2 text-xl font-bold text-[#ff9b9b]">
            {showSkeleton ? <Skeleton className="h-6 w-32" /> : money(debitTotal)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Операций</div>
          <div className="mt-2 text-xl font-bold text-white">
            {showSkeleton ? <Skeleton className="h-6 w-20" /> : debitCount}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Клиент</div>
          <div className="mt-2 truncate text-sm font-semibold text-[#8fd2ff]">
            {showSkeleton ? <Skeleton className="h-5 w-40" /> : companyName || 'Все клиенты'}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            С
            <input
              type="date"
              className={fieldClass}
              value={filters.from}
              onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            По
            <input
              type="date"
              className={fieldClass}
              value={filters.to}
              onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Клиент
            <select
              className={fieldClass}
              value={filters.companyId}
              onChange={(e) => setFilters((prev) => ({ ...prev, companyId: e.target.value }))}
            >
              <option value="">Все клиенты</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Поиск
            <input
              className={fieldClass}
              placeholder="Клиент, услуга, УНП, комментарий…"
              value={filters.q}
              onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4 text-xs text-[#9db8d4]">
          <span>
            {showSkeleton
              ? 'Загрузка…'
              : `Показано ${items.length} из ${Number(totals?.total_count || 0)} операций`}
            {truncated && !showSkeleton ? ' · список ограничен, сузьте период' : ''}
          </span>
          {loading && loaded ? <span>обновление…</span> : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/20 bg-[#3a1218] px-4 py-3 text-sm text-[#ffb4b4]">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-[#0b1f3a]">
        <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
          <thead className="bg-[#071529] text-xs uppercase tracking-wide text-[#9db8d4]">
            <tr>
              <th className="px-3 py-3 font-bold">Дата</th>
              <th className="px-3 py-3 font-bold">Клиент</th>
              <th className="px-3 py-3 font-bold">Услуга</th>
              <th className="px-3 py-3 font-bold">Кол-во</th>
              <th className="px-3 py-3 font-bold">Цена</th>
              <th className="px-3 py-3 font-bold">Сумма</th>
              <th className="px-3 py-3 font-bold">Остаток после</th>
              <th className="px-3 py-3 font-bold">Проект</th>
              <th className="px-3 py-3 font-bold">Основание</th>
            </tr>
          </thead>
          <tbody aria-busy={showSkeleton}>
            {showSkeleton
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={`sk-${i}`} className="border-t border-white/[0.06]">
                    {Array.from({ length: 9 }, (_, j) => (
                      <td key={j} className="px-3 py-3">
                        <Skeleton className="h-4 w-full max-w-[120px]" />
                      </td>
                    ))}
                  </tr>
                ))
              : items.map((row) => (
                  <tr key={row.id} className="border-t border-white/[0.06] align-top">
                    <td className="px-3 py-3 whitespace-nowrap text-[#cfe6ff]">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-3 py-3 font-medium text-white">
                      {row.company_name}
                      {row.company_unp ? (
                        <div className="text-[11px] text-[#9db8d4]">УНП {row.company_unp}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-[#cfe6ff]">
                      {row.service_name || categoryLabel(row.category)}
                      {row.employee_name ? (
                        <div className="text-[11px] text-[#9db8d4]">{row.employee_name}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-[#9db8d4]">
                      {row.quantity == null ? '—' : Number(row.quantity)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-[#9db8d4]">
                      {row.unit_price == null ? '—' : money(row.unit_price)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap font-semibold text-[#ff9b9b]">
                      −{money(row.amount)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-[#7dffc2]">
                      {row.balance_after == null ? '—' : money(row.balance_after)}
                    </td>
                    <td className="px-3 py-3 text-[#9db8d4]">{row.project_name || '—'}</td>
                    <td className="max-w-[320px] px-3 py-3 text-[#cfe6ff]">{row.comment || '—'}</td>
                  </tr>
                ))}
            {!showSkeleton && !items.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-[#9db8d4]">
                  За выбранный период списаний нет
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
