import { useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Download, Landmark, RefreshCw } from 'lucide-react'
import { api, apiDownload } from '../../api'
import Button from '../../ui/Button'
import SearchField from '../../ui/SearchField'
import SegmentedControl from '../../ui/SegmentedControl'

function periodDefaults() {
  const to = new Date()
  const from = new Date(to.getFullYear(), to.getMonth(), 1)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function money(v, currency = 'BYN') {
  return `${Number(v || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU')
}

const tabs = [
  { id: 'income', label: 'Поступления', icon: ArrowDownLeft },
  { id: 'expense', label: 'Списания', icon: ArrowUpRight },
  { id: 'statement', label: 'Выписка', icon: Landmark },
]

const fieldClass =
  'mt-1.5 h-10 w-full rounded-lg border border-transparent bg-white/[0.06] px-3 text-sm font-medium text-[#f3f8ff] outline-none focus:bg-white/[0.09] focus:ring-2 focus:ring-[#4ea8ff]/35'

export default function AdminBankingPage() {
  const [tab, setTab] = useState('income')
  const [filters, setFilters] = useState({ ...periodDefaults(), q: '' })
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState({
    income: 0,
    expense: 0,
    net: 0,
    incomeCount: 0,
    expenseCount: 0,
  })
  const [account, setAccount] = useState(null)
  const [configured, setConfigured] = useState(false)
  const [message, setMessage] = useState('')
  const [fetchedAt, setFetchedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (filters.from) p.set('from', filters.from)
    if (filters.to) p.set('to', filters.to)
    if (tab === 'income' || tab === 'expense') p.set('direction', tab)
    if (filters.q.trim()) p.set('q', filters.q.trim())
    return p.toString()
  }, [filters.from, filters.to, filters.q, tab])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await api(`/api/admin/banking/movements?${queryString}`)
      setItems(data.items || [])
      setSummary(
        data.summary || {
          income: 0,
          expense: 0,
          net: 0,
          incomeCount: 0,
          expenseCount: 0,
        },
      )
      setAccount(data.account || null)
      setConfigured(Boolean(data.configured))
      setMessage(data.message || '')
      setFetchedAt(data.fetchedAt || null)
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

  async function exportCsv() {
    setError('')
    try {
      const p = new URLSearchParams()
      if (filters.from) p.set('from', filters.from)
      if (filters.to) p.set('to', filters.to)
      await apiDownload(
        `/api/admin/banking/statement.csv?${p.toString()}`,
        `priorbank_${filters.from}_${filters.to}.csv`,
      )
    } catch (err) {
      setError(err.message)
    }
  }

  const currency = account?.currency || 'BYN'
  const emptyLabel = !configured
    ? 'Нет данных: Priorbank API ещё не подключён'
    : loading
      ? 'Загрузка…'
      : 'За период операций нет'

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Банкинг</h1>
          <p className="mt-1 text-sm text-[#9db8d4]">
            Поступления, списания и выписка по расчётному счёту из Priorbank API.
          </p>
        </div>
        <Button variant="secondary" disabled={loading} onClick={load}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </div>

      <SegmentedControl items={tabs} value={tab} onChange={setTab} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Счёт</div>
          <div className="mt-2 font-mono text-sm font-semibold text-[#8fd2ff]">
            {account?.iban || '—'}
          </div>
          <div className="mt-1 text-xs text-[#9db8d4]">{account?.name || 'Priorbank'}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Остаток</div>
          <div className="mt-2 text-xl font-bold text-white">
            {account?.balance == null ? '—' : money(account.balance, currency)}
          </div>
          <div className="mt-1 text-xs text-[#9db8d4]">
            {configured ? 'Источник: Priorbank' : 'API не настроен'}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Доходы</div>
          <div className="mt-2 text-xl font-bold text-[#7dffc2]">{money(summary.income, currency)}</div>
          <div className="mt-1 text-xs text-[#9db8d4]">{summary.incomeCount} операций</div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Расходы</div>
          <div className="mt-2 text-xl font-bold text-[#ff9b9b]">{money(summary.expense, currency)}</div>
          <div className="mt-1 text-xs text-[#9db8d4]">{summary.expenseCount} операций</div>
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
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4] sm:col-span-2 lg:col-span-2">
            Поиск
            <SearchField
              className="mt-1.5"
              value={filters.q}
              placeholder="Контрагент, УНП, назначение…"
              onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
          <div className="text-xs text-[#9db8d4]">
            {fetchedAt
              ? `Обновлено ${new Date(fetchedAt).toLocaleString('ru-RU')}`
              : 'Данные подтягиваются из Priorbank API'}
            {tab === 'statement' ? (
              <span className="ml-2 text-[#cfe6ff]">
                · сальдо {money(summary.net, currency)}
              </span>
            ) : null}
          </div>
          {tab === 'statement' ? (
            <Button variant="primary" onClick={exportCsv}>
              <Download className="size-4" />
              Скачать CSV
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/20 bg-[#3a1218] px-4 py-3 text-sm text-[#ffb4b4]">
          {error}
        </div>
      ) : null}

      {!configured && message ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#071529]/80 px-4 py-3 text-sm text-[#cfe6ff]">
          {message}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-[#0b1f3a]">
        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
          <thead className="bg-[#071529] text-xs uppercase tracking-wide text-[#9db8d4]">
            <tr>
              <th className="px-3 py-3 font-bold">Дата</th>
              {tab === 'statement' ? <th className="px-3 py-3 font-bold">Тип</th> : null}
              <th className="px-3 py-3 font-bold">Сумма</th>
              <th className="px-3 py-3 font-bold">Контрагент</th>
              <th className="px-3 py-3 font-bold">УНП</th>
              <th className="px-3 py-3 font-bold">Назначение</th>
              <th className="px-3 py-3 font-bold">Референс</th>
              <th className="px-3 py-3 font-bold">Остаток</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const isExpense = row.direction === 'expense'
              return (
                <tr key={row.id} className="border-t border-white/[0.06] align-top">
                  <td className="px-3 py-3 whitespace-nowrap text-[#cfe6ff]">{formatDate(row.date)}</td>
                  {tab === 'statement' ? (
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          isExpense
                            ? 'bg-[#ff6b6b]/15 text-[#ff9b9b]'
                            : 'bg-[#7dffc2]/15 text-[#7dffc2]'
                        }`}
                      >
                        {isExpense ? 'Расход' : 'Доход'}
                      </span>
                    </td>
                  ) : null}
                  <td
                    className={`px-3 py-3 whitespace-nowrap font-semibold ${
                      isExpense ? 'text-[#ff9b9b]' : 'text-[#7dffc2]'
                    }`}
                  >
                    {isExpense ? '−' : '+'}
                    {money(row.amount, row.currency || currency)}
                  </td>
                  <td className="px-3 py-3 font-medium text-white">{row.counterparty || '—'}</td>
                  <td className="px-3 py-3 text-[#9db8d4]">{row.unp || '—'}</td>
                  <td className="max-w-[280px] px-3 py-3 text-[#cfe6ff]">{row.purpose || '—'}</td>
                  <td className="px-3 py-3 font-mono text-xs text-[#8fd2ff]">{row.reference || '—'}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-[#9db8d4]">
                    {row.balanceAfter == null ? '—' : money(row.balanceAfter, row.currency || currency)}
                  </td>
                </tr>
              )
            })}
            {!items.length ? (
              <tr>
                <td
                  colSpan={tab === 'statement' ? 8 : 7}
                  className="px-3 py-12 text-center text-[#9db8d4]"
                >
                  {emptyLabel}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
