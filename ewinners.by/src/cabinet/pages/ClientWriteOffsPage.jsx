import { useEffect, useMemo, useState } from 'react'
import { api, apiDownload } from '../api'
import { categoryLabel } from '../statusLabels'
import Skeleton from '../ui/Skeleton'
import useLiveBalance from '../useLiveBalance'

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function money(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} BYN`
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

const PRESETS = [
  { id: 'month', label: 'Этот месяц' },
  { id: 'prev', label: 'Прошлый месяц' },
  { id: '30', label: '30 дней' },
  { id: 'all', label: 'Всё время' },
]

function presetRange(id) {
  const today = localDate(new Date())
  const now = new Date()
  if (id === 'month') {
    return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
  }
  if (id === 'prev') {
    return {
      from: localDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: localDate(new Date(now.getFullYear(), now.getMonth(), 0)),
    }
  }
  if (id === '30') {
    const d = new Date()
    d.setDate(d.getDate() - 29)
    return { from: localDate(d), to: today }
  }
  return { from: '', to: '' }
}

/** Списания клиента — только по его организации. */
export default function ClientWriteOffsPage() {
  const [filters, setFilters] = useState({ ...presetRange('month'), q: '', type: 'debit', source: '' })
  const [preset, setPreset] = useState('month')
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
    // Пусто — показываем всё: и списания, и зачисления.
    if (filters.type) p.set('type', filters.type)
    if (filters.source) p.set('source', filters.source)
    if (filters.from) p.set('from', filters.from)
    if (filters.to) p.set('to', filters.to)
    if (debouncedQ) p.set('q', debouncedQ)
    p.set('limit', '1000')
    return p.toString()
  }, [filters.type, filters.source, filters.from, filters.to, debouncedQ])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api(`/api/cabinet/transactions?${query}`)
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

  function applyPreset(id) {
    setPreset(id)
    setFilters((prev) => ({ ...prev, ...presetRange(id) }))
  }

  const showSkeleton = loading && !loaded
  const debitTotal = Number(totals?.debit_total || 0)
  const debitCount = Number(totals?.debit_count || 0)
  const creditTotal = Number(totals?.credit_total || 0)
  const creditCount = Number(totals?.credit_count || 0)

  // Карточки подстраиваются под выбранный тип: списания, зачисления или всё.
  const onlyCredits = filters.type === 'credit'
  const showBoth = !filters.type
  const mainTotal = onlyCredits ? creditTotal : debitTotal
  const mainCount = onlyCredits ? creditCount : debitCount
  const totalCount = Number(totals?.total_count || 0) || (showBoth ? debitCount + creditCount : mainCount)

  const periodLabel =
    filters.from && filters.to
      ? `${new Date(filters.from).toLocaleDateString('ru-RU')} — ${new Date(filters.to).toLocaleDateString('ru-RU')}`
      : 'за всё время'

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Списания</h1>
          <p className="mt-1 text-sm text-[#9db8d4]">
            История операций по балансу: списания и зачисления, остаток после каждой операции.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="cab-btn primary"
            onClick={() =>
              apiDownload(
                `/api/cabinet/export/write-offs.xlsx?${query}`,
                'write-offs.xlsx',
              ).catch((e) => setError(e.message))
            }
          >
            Скачать для бухгалтерии (Excel)
          </button>
          <button
            type="button"
            className="cab-btn ghost"
            onClick={() =>
              apiDownload(`/api/cabinet/export/transactions.csv?${query}`, 'write-offs.csv').catch(
                (e) => setError(e.message),
              )
            }
          >
            Экспорт операций (CSV)
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            {showBoth ? `Списано ${periodLabel}` : onlyCredits ? `Зачислено ${periodLabel}` : `Списано ${periodLabel}`}
          </div>
          <div className={`mt-2 text-xl font-bold ${onlyCredits ? 'text-[#7dffc2]' : 'text-[#ff9b9b]'}`}>
            {showSkeleton ? <Skeleton className="h-6 w-32" /> : money(mainTotal)}
          </div>
          {showBoth ? (
            <div className="mt-1 text-[11px] text-[#9db8d4]">
              зачислено {money(creditTotal)}
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Операций</div>
          <div className="mt-2 text-xl font-bold text-white">
            {showSkeleton ? <Skeleton className="h-6 w-20" /> : showBoth ? totalCount : mainCount}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            {onlyCredits ? 'Среднее зачисление' : 'Средняя стоимость'}
          </div>
          <div className="mt-2 text-xl font-bold text-[#8fd2ff]">
            {showSkeleton ? (
              <Skeleton className="h-6 w-28" />
            ) : (
              money(mainCount ? mainTotal / mainCount : 0)
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`cab-btn ${preset === p.id ? '' : 'ghost'}`}
              style={{ minHeight: 34, padding: '0 14px', fontSize: '0.82rem' }}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Тип операции
            <select
              className={fieldClass}
              value={filters.type}
              onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
            >
              <option value="debit">Списания</option>
              <option value="credit">Зачисления</option>
              <option value="">Все операции</option>
            </select>
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Источник
            <select
              className={fieldClass}
              value={filters.source}
              onChange={(e) => setFilters((prev) => ({ ...prev, source: e.target.value }))}
            >
              <option value="">Все</option>
              <option value="auto">Автоматические</option>
              <option value="manual">Ручные</option>
            </select>
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            С
            <input
              type="date"
              className={fieldClass}
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => {
                setPreset('')
                setFilters((prev) => ({ ...prev, from: e.target.value }))
              }}
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            По
            <input
              type="date"
              className={fieldClass}
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => {
                setPreset('')
                setFilters((prev) => ({ ...prev, to: e.target.value }))
              }}
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Поиск
            <input
              className={fieldClass}
              placeholder="Услуга, проект, комментарий…"
              value={filters.q}
              onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="cab-btn ghost"
              style={{ width: '100%', minHeight: 40 }}
              onClick={() => {
                setPreset('all')
                setFilters((prev) => ({ ...prev, from: '', to: '', q: '', type: 'debit', source: '' }))
              }}
            >
              Сбросить фильтры
            </button>
          </div>
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
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead className="bg-[#071529] text-xs uppercase tracking-wide text-[#9db8d4]">
            <tr>
              <th className="px-3 py-3 font-bold">Дата</th>
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
                    {Array.from({ length: 8 }, (_, j) => (
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
                    <td
                      className={`px-3 py-3 whitespace-nowrap font-semibold ${
                        row.type === 'credit' ? 'text-[#7dffc2]' : 'text-[#ff9b9b]'
                      }`}
                    >
                      {row.type === 'credit' ? '+' : '−'}
                      {money(row.amount)}
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
                <td colSpan={8} className="px-3 py-12 text-center text-[#9db8d4]">
                  {filters.type === 'credit'
                    ? 'За выбранный период зачислений нет'
                    : filters.type === 'debit'
                      ? 'За выбранный период списаний нет'
                      : 'За выбранный период операций нет'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
