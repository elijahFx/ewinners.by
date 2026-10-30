import { useEffect, useMemo, useState } from 'react'
import { api, apiDownload, apiOpen } from '../api'
import Skeleton from '../ui/Skeleton'
import useLiveBalance from '../useLiveBalance'

/**
 * Самый ранний период, за который можно запросить детализацию.
 * Только для документов: на баланс и списания это никак не влияет.
 */
const DETAIL_MIN_DATE = '2026-09-01'

function money(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`
}

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDate(d)
}

const PRESETS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'week', label: '7 дней' },
  { id: 'month', label: 'Этот месяц' },
  { id: 'prev', label: 'Прошлый месяц' },
  { id: 'all', label: 'Всё время' },
]

/** Границы периода для быстрых кнопок. */
function presetRange(id) {
  const today = localDate(new Date())
  const now = new Date()
  if (id === 'today') return { from: today, to: today }
  if (id === 'week') return { from: daysAgo(6), to: today }
  if (id === 'month') return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
  if (id === 'prev') {
    return {
      from: localDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: localDate(new Date(now.getFullYear(), now.getMonth(), 0)),
    }
  }
  return { from: '', to: '' }
}

const fieldClass =
  'mt-1.5 h-10 w-full rounded-lg border border-transparent bg-white/[0.06] px-3 text-sm font-medium text-[#f3f8ff] outline-none focus:bg-white/[0.09] focus:ring-2 focus:ring-[#4ea8ff]/35'

export default function OperationsPage() {
  const initial = presetRange('month')
  const [filters, setFilters] = useState({ ...initial, type: '' })
  const [preset, setPreset] = useState('month')
  const [items, setItems] = useState([])
  const [totals, setTotals] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailMessage, setDetailMessage] = useState('')

  /**
   * Запрашивает PDF-детализацию за выбранный период.
   * Сервер только читает операции и формирует документ — баланс и списания
   * не меняются.
   */
  async function requestDetail() {
    setDetailBusy(true)
    setError('')
    setDetailMessage('')
    try {
      const data = await api('/api/cabinet/documents/detail/generate', {
        method: 'POST',
        body: { from: filters.from || DETAIL_MIN_DATE, to: filters.to || undefined },
      })
      setDetailMessage(
        data.updated ? 'Детализация за этот период уже была — PDF обновлён.' : 'Детализация сформирована.',
      )
      if (data.document?.id) {
        try {
          await apiOpen(`/api/cabinet/documents/${data.document.id}/view`)
        } catch {
          /* документ всё равно появится в разделе «Документы» */
        }
      }
    } catch (err) {
      setError(err.message || 'Не удалось сформировать детализацию')
    } finally {
      setDetailBusy(false)
    }
  }

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (filters.type) p.set('type', filters.type)
    if (filters.from) p.set('from', filters.from)
    if (filters.to) p.set('to', filters.to)
    return p.toString()
  }, [filters.type, filters.from, filters.to])

  async function load() {
    try {
      setError('')
      const data = await api(`/api/cabinet/transactions${query ? `?${query}` : ''}`)
      setItems(data.items || [])
      setTotals(data.totals || null)
      setTruncated(Boolean(data.truncated))
      setLoaded(true)
    } catch (e) {
      setError(e.message)
      setItems([])
      setTotals(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    load()
  }, [query])

  // Новые списания/поступления появляются без перезагрузки страницы.
  useLiveBalance(load)

  function applyPreset(id) {
    setPreset(id)
    const range = presetRange(id)
    setFilters((prev) => ({ ...prev, ...range }))
  }

  function changeField(field, value) {
    setPreset('')
    setFilters((prev) => ({ ...prev, [field]: value }))
  }

  const showSkeleton = loading && !loaded
  const debitTotal = Number(totals?.debit_total || 0)
  const creditTotal = Number(totals?.credit_total || 0)
  const debitCount = Number(totals?.debit_count || 0)

  const periodLabel =
    filters.from && filters.to
      ? `${new Date(filters.from).toLocaleDateString('ru-RU')} — ${new Date(filters.to).toLocaleDateString('ru-RU')}`
      : 'за всё время'

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Детализация расходов</h1>
          <p>История поступлений и списаний по тарифам и CRM-действиям.</p>
        </div>
        <div className="cab-actions">
          <button
            type="button"
            className="cab-btn primary"
            disabled={detailBusy}
            onClick={requestDetail}
          >
            {detailBusy ? 'Формирую…' : 'Запросить детализацию'}
          </button>
          <button
            type="button"
            className="cab-btn ghost"
            onClick={() =>
              apiDownload(
                `/api/cabinet/export/transactions.csv${query ? `?${query}` : ''}`,
                'operations.csv',
              ).catch((e) => setError(e.message))
            }
          >
            Экспорт Excel
          </button>
        </div>
      </div>

      {detailMessage && <div className="cab-alert">{detailMessage}</div>}
      <p className="cab-muted" style={{ marginBottom: 12, fontSize: '0.8rem' }}>
        Детализацию можно запросить с 1 сентября 2026 года. Это только документ — на баланс и
        списания он не влияет.
      </p>

      {error && <div className="cab-alert">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-3" style={{ marginBottom: 16 }}>
        <div className="cab-card">
          <span className="cab-muted" style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em' }}>
            СПИСАНО {periodLabel.toUpperCase()}
          </span>
          <div style={{ marginTop: 8, fontSize: '1.25rem', fontWeight: 800, color: '#ff9b9b' }}>
            {showSkeleton ? <Skeleton className="h-6 w-32" /> : money(debitTotal)}
          </div>
          <div className="cab-muted" style={{ fontSize: '0.78rem' }}>
            {showSkeleton ? '' : `${debitCount} операций`}
          </div>
        </div>
        <div className="cab-card">
          <span className="cab-muted" style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em' }}>
            ПОПОЛНЕНО {periodLabel.toUpperCase()}
          </span>
          <div style={{ marginTop: 8, fontSize: '1.25rem', fontWeight: 800, color: '#8fd2ff' }}>
            {showSkeleton ? <Skeleton className="h-6 w-32" /> : money(creditTotal)}
          </div>
          <div className="cab-muted" style={{ fontSize: '0.78rem' }}>
            {showSkeleton ? '' : `${Number(totals?.credit_count || 0)} операций`}
          </div>
        </div>
        <div className="cab-card">
          <span className="cab-muted" style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em' }}>
            ИТОГО ЗА ПЕРИОД
          </span>
          <div
            style={{
              marginTop: 8,
              fontSize: '1.25rem',
              fontWeight: 800,
              color: debitTotal - creditTotal > 0 ? '#ff9b9b' : '#7ee2a8',
            }}
          >
            {showSkeleton ? <Skeleton className="h-6 w-32" /> : money(debitTotal - creditTotal)}
          </div>
          <div className="cab-muted" style={{ fontSize: '0.78rem' }}>
            {showSkeleton ? '' : `${Number(totals?.total_count || 0)} операций`}
          </div>
        </div>
      </div>

      <div className="cab-card" style={{ marginBottom: 16 }}>
        <div className="flex flex-wrap gap-2" style={{ marginBottom: 14 }}>
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

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            С
            <input
              type="date"
              className={fieldClass}
              value={filters.from}
              min={DETAIL_MIN_DATE}
              max={filters.to || undefined}
              onChange={(e) => changeField('from', e.target.value)}
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            По
            <input
              type="date"
              className={fieldClass}
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => changeField('to', e.target.value)}
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Тип операций
            <select
              className={fieldClass}
              value={filters.type}
              onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
            >
              <option value="">Все операции</option>
              <option value="debit">Списания</option>
              <option value="credit">Пополнения</option>
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="cab-btn ghost"
              style={{ width: '100%', minHeight: 40 }}
              onClick={() => {
                setPreset('')
                setFilters((prev) => ({ ...prev, from: '', to: '' }))
              }}
            >
              Сбросить период
            </button>
          </div>
        </div>
      </div>

      {truncated && (
        <div className="cab-alert" style={{ marginBottom: 12 }}>
          Показаны последние 500 операций. Сузьте период, чтобы увидеть все.
        </div>
      )}

      <div className="cab-card span-4">
        <div className="cab-table-wrap">
          <table className="cab-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Действие</th>
                <th>Проект</th>
                <th>Сотрудник</th>
                <th>Объём</th>
                <th>Тариф</th>
                <th>Сумма</th>
                <th>Баланс</th>
              </tr>
            </thead>
            <tbody>
              {showSkeleton
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j}>
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                : items.map((t) => (
                    <tr key={t.id}>
                      <td>{new Date(t.created_at).toLocaleString('ru-RU')}</td>
                      <td>{t.service_name || t.category}</td>
                      <td>{t.project_name || '—'}</td>
                      <td>{t.employee_name || '—'}</td>
                      <td>{t.quantity ?? '—'}</td>
                      <td>{t.unit_price != null ? money(t.unit_price) : '—'}</td>
                      <td className={t.type === 'credit' ? 'cab-ok' : 'cab-bad'}>{money(t.amount)}</td>
                      <td>{money(t.balance_after)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!showSkeleton && !items.length && (
            <div className="cab-empty">За выбранный период операций нет</div>
          )}
        </div>
      </div>
    </>
  )
}
