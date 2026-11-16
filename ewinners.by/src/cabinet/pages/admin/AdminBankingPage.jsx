import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Download, Landmark, RefreshCw } from 'lucide-react'
import { api, apiDownload } from '../../api'
import { DIRECTIONS, useDirection } from '../../DirectionContext'
import Button from '../../ui/Button'
import SearchField from '../../ui/SearchField'
import SegmentedControl from '../../ui/SegmentedControl'
import Skeleton from '../../ui/Skeleton'

// Банковские данные приходят из MTBank с IBAN без пробелов — сравниваем так же.
function normIban(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase()
}

const EMPTY_SUMMARY = {
  income: 0,
  expense: 0,
  net: 0,
  incomeCount: 0,
  expenseCount: 0,
}

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function periodDefaults() {
  const to = new Date()
  const from = new Date(to.getFullYear(), to.getMonth(), 1)
  // toISOString() в Минске (UTC+3) сдвигает полночь на предыдущий день,
  // поэтому собираем дату из локальных компонентов.
  return {
    from: localDate(from),
    to: localDate(to),
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

// Остаток — снимок на момент ответа банка, поэтому показываем и время.
function formatDateTime(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const tabs = [
  { id: 'income', label: 'Поступления', icon: ArrowDownLeft },
  { id: 'expense', label: 'Списания', icon: ArrowUpRight },
  { id: 'statement', label: 'Выписка', icon: Landmark },
]

const fieldClass =
  'mt-1.5 h-10 w-full rounded-lg border border-transparent bg-white/[0.06] px-3 text-sm font-medium text-[#f3f8ff] outline-none focus:bg-white/[0.09] focus:ring-2 focus:ring-[#4ea8ff]/35'

export default function AdminBankingPage() {
  const { direction, setDirection } = useDirection()
  const [tab, setTab] = useState('income')
  const [filters, setFilters] = useState({ ...periodDefaults(), q: '' })
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [account, setAccount] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  // Счета направлений (HR / Digital / КЦ) — по ним страница следует за сайдбаром.
  const [directionAccounts, setDirectionAccounts] = useState([])
  const [directionLoaded, setDirectionLoaded] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [message, setMessage] = useState('')
  const [fetchedAt, setFetchedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  // Данные из MTBank приходят за несколько секунд, поэтому до первого ответа
  // показываем скелетон, а не нули.
  const [loaded, setLoaded] = useState(false)
  // Для какого запроса (счёт + период + поиск) уже показан ответ. Пока новый
  // запрос в пути, старые данные под новым фильтром не показываем.
  const [loadedQuery, setLoadedQuery] = useState('')
  // Номер последнего запроса: ответы старых запросов не должны перетирать
  // данные нового счёта/периода. Иначе при быстром переключении направления
  // на экране остаются поступления предыдущего счёта.
  const requestRef = useRef(0)
  // Счёт, по которому банк ответил «не найден в согласии».
  const [unavailableIban, setUnavailableIban] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')

  // Поиск не должен дёргать MTBank на каждое нажатие клавиши.
  const [debouncedQ, setDebouncedQ] = useState('')

  // Счета из согласия MTBank — по ним понимаем, подключён ли счёт направления.
  useEffect(() => {
    api('/api/admin/banking/accounts')
      .then((d) => setAccounts(d.accounts || []))
      .catch(() => setAccounts([]))
      .finally(() => setAccountsLoaded(true))
  }, [])

  // Карта «направление → IBAN»: тот же справочник, что и в рабочем месте.
  useEffect(() => {
    api('/api/direction/accounts')
      .then((d) => setDirectionAccounts(d.items || []))
      .catch(() => setDirectionAccounts([]))
      .finally(() => setDirectionLoaded(true))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filters.q.trim()), 300)
    return () => clearTimeout(timer)
  }, [filters.q])

  const directionAccount = directionAccounts.find((a) => a.code === direction) || null
  const directionLabel =
    DIRECTIONS.find((d) => d.code === direction)?.label || directionAccount?.label || 'HR'
  const accountIban = normIban(directionAccount?.iban || '')
  const accountInConsent = accounts.some((a) => normIban(a.iban) === accountIban)
  // Счёт направления может быть не подключён к согласию MTBank. В этом случае
  // не запрашиваем выписку (банк вернёт ошибку), а показываем объяснение.
  const notConnected =
    Boolean(accountIban) &&
    (unavailableIban === accountIban ||
      (directionLoaded &&
        accountsLoaded &&
        accounts.length > 0 &&
        !accountInConsent))
  const notConnectedMessage =
    notConnected && directionAccount
      ? `Счёт ${directionAccount.label} (${directionAccount.formatted || accountIban}) не подключён к согласию MTBank. Данные появятся после добавления счёта в согласие.`
      : ''

  // Вкладки фильтруют уже загруженные операции локально, поэтому их смена
  // не дёргает банк. В запрос уходит только счёт выбранного направления.
  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (filters.from) p.set('from', filters.from)
    if (filters.to) p.set('to', filters.to)
    if (debouncedQ) p.set('q', debouncedQ)
    if (accountIban) p.set('account', accountIban)
    return p.toString()
  }, [filters.from, filters.to, debouncedQ, accountIban])

  async function load({ refresh = false } = {}) {
    const requestId = ++requestRef.current;
    const requestQuery = queryString;
    const requestIban = accountIban;
    const isCurrent = () => requestId === requestRef.current;

    setLoading(true)
    setError('')

    // Счёт направления не входит в согласие банка: показываем сам счёт,
    // но без выписки и с нулевыми оборотами. «Обновить» всё равно пробует
    // банк — вдруг счёт уже добавили в согласие.
    if (notConnected && !refresh) {
      if (!isCurrent()) return
      setItems([])
      setSummary(EMPTY_SUMMARY)
      setAccount({
        iban: requestIban,
        name: directionAccount?.label || 'Расчётный счёт',
        currency: 'BYN',
        balance: null,
        balanceAt: null,
      })
      setConfigured(true)
      setMessage('')
      setFetchedAt(null)
      setLoaded(true)
      setLoadedQuery(requestQuery)
      setLoading(false)
      return
    }

    try {
      const data = await api(
        `/api/admin/banking/movements?${requestQuery}${refresh ? '&refresh=1' : ''}`,
      )
      if (!isCurrent()) return
      setItems(data.items || [])
      setSummary(data.summary || EMPTY_SUMMARY)
      setAccount(data.account || null)
      setConfigured(Boolean(data.configured))
      setMessage(data.message || '')
      setFetchedAt(data.fetchedAt || null)
      setLoaded(true)
      setLoadedQuery(requestQuery)
      setUnavailableIban('')
    } catch (err) {
      if (!isCurrent()) return
      const text = err.message || ''
      if (/не найден в согласии/i.test(text)) {
        // Счёт направления просто не добавлен в согласие MTBank — это не
        // ошибка связи, показываем отдельное объяснение вместо красной плашки.
        setUnavailableIban(requestIban)
        setItems([])
        setSummary(EMPTY_SUMMARY)
        setAccount({
          iban: requestIban,
          name: directionAccount?.label || 'Расчётный счёт',
          currency: 'BYN',
          balance: null,
          balanceAt: null,
        })
        setConfigured(true)
        setMessage('')
        setFetchedAt(null)
        setError('')
      } else {
        setError(text)
        setItems([])
        setSummary(EMPTY_SUMMARY)
        setAccount(null)
      }
      setLoaded(true)
      setLoadedQuery(requestQuery)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  // Ждём только справочник направлений: он быстрый и задаёт счёт.
  // Полный список счетов согласия догружается параллельно и уточняет подписи.
  useEffect(() => {
    if (!directionLoaded) return
    load()
  }, [queryString, notConnected, directionLoaded])

  async function exportCsv() {
    setError('')
    try {
      const p = new URLSearchParams()
      if (filters.from) p.set('from', filters.from)
      if (filters.to) p.set('to', filters.to)
      if (accountIban) p.set('account', accountIban)
      await apiDownload(
        `/api/admin/banking/statement.csv?${p.toString()}`,
        `mtbank_${directionLabel}_${filters.from}_${filters.to}.csv`,
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function syncPayments() {
    setError('')
    setSyncing(true)
    try {
      const data = await api('/api/admin/banking/sync', { method: 'POST', body: {} })
      const paid = data.paid?.length || 0
      if (data.message && !data.ok) {
        setMessage(data.message)
      } else {
        setMessage(
          paid
            ? `Синхронизация: оплачено счетов — ${paid}`
            : `Синхронизация: новых оплат нет (проверено поступлений: ${data.scanned ?? 0})`,
        )
      }
      await load({ refresh: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const currency = account?.currency || 'BYN'
  // Скелетон показываем до первого ответа банка и при смене счёта. При
  // обновлении фильтров по тому же счёту старые данные остаются, без мерцания.
  const showSkeleton = loading && (!loaded || loadedQuery !== queryString)
  const emptyLabel = notConnected
    ? 'Счёт не подключён к MTBank'
    : !configured
      ? 'Нет данных: MTBank API ещё не подключён'
      : tab === 'income'
        ? 'За период поступлений нет'
        : tab === 'expense'
          ? 'За период списаний нет'
          : 'За период операций нет'

  // Вкладка фильтрует уже загруженные операции — без обращения к банку.
  const visibleItems = useMemo(
    () => (tab === 'statement' ? items : items.filter((row) => row.direction === tab)),
    [items, tab],
  )

  const skeletonRows = Array.from({ length: 5 }, (_, i) => (
    <tr key={`skeleton-${i}`} className="border-t border-white/[0.06]">
      <td className="px-3 py-3">
        <Skeleton className="h-4 w-20" />
      </td>
      {tab === 'statement' ? (
        <td className="px-3 py-3">
          <Skeleton className="h-4 w-14" />
        </td>
      ) : null}
      <td className="px-3 py-3">
        <Skeleton className="h-4 w-24" />
      </td>
      <td className="px-3 py-3">
        <Skeleton className="h-4 w-32" />
      </td>
      <td className="px-3 py-3">
        <Skeleton className="h-4 w-20" />
      </td>
      <td className="px-3 py-3">
        <Skeleton className="h-4 w-48 max-w-full" />
      </td>
      <td className="px-3 py-3">
        <Skeleton className="h-4 w-28" />
      </td>
      <td className="px-3 py-3">
        <Skeleton className="h-4 w-20" />
      </td>
    </tr>
  ))

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Банкинг</h1>
          <p className="mt-1 text-sm text-[#9db8d4]">
            Поступления, списания и выписка по счёту направления{' '}
            <span className="font-bold text-[#8fd2ff]">{directionLabel}</span> из MTBank Open API.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={loading || syncing} onClick={syncPayments}>
            <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
            Проверить оплаты
          </Button>
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => load({ refresh: true })}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </div>

      <SegmentedControl items={tabs} value={tab} onChange={setTab} />

      {notConnected ? (
        <div className="rounded-xl border border-amber-400/20 bg-[#2a2110] px-4 py-3 text-sm text-[#ffd58a]">
          {notConnectedMessage}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy={showSkeleton}>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Счёт</div>
          {directionAccounts.length > 1 ? (
            <select
              className="mt-1.5 h-9 w-full rounded-lg border border-transparent bg-white/[0.06] px-2 text-xs font-medium text-[#f3f8ff] outline-none focus:bg-white/[0.09]"
              value={accountIban}
              onChange={(e) => {
                const next = directionAccounts.find(
                  (a) => normIban(a.iban) === normIban(e.target.value),
                )
                if (next) setDirection(next.code)
              }}
            >
              {directionAccounts.map((a) => {
                const connected = accounts.some((x) => normIban(x.iban) === normIban(a.iban))
                return (
                  <option key={a.iban} value={a.iban}>
                    {a.label} — {a.formatted}
                    {accountsLoaded && !connected ? ' (не подключён)' : ''}
                  </option>
                )
              })}
            </select>
          ) : null}
          {showSkeleton ? (
            <>
              <Skeleton className="mt-2 h-5 w-44" />
              <Skeleton className="mt-2 h-3 w-28" />
            </>
          ) : (
            <>
              <div className="mt-2 font-mono text-sm font-semibold text-[#8fd2ff]">
                {account?.iban || '—'}
              </div>
              <div className="mt-1 text-xs text-[#9db8d4]">
                {notConnected ? 'Не подключён к MTBank' : account?.name || 'MTBank'}
              </div>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Остаток</div>
          {showSkeleton ? (
            <>
              <Skeleton className="mt-2 h-6 w-32" />
              <Skeleton className="mt-2 h-3 w-24" />
            </>
          ) : (
            <>
              <div className="mt-2 text-xl font-bold text-white">
                {account?.balance == null ? '—' : money(account.balance, currency)}
              </div>
              <div className="mt-1 text-xs text-[#9db8d4]">
                {notConnected
                  ? 'Счёт не подключён к MTBank'
                  : !configured
                    ? 'API не настроен'
                    : account?.balanceAt
                      ? `MTBank · на ${formatDateTime(account.balanceAt)}`
                      : 'Источник: MTBank'}
              </div>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Доходы</div>
          {showSkeleton ? (
            <>
              <Skeleton className="mt-2 h-6 w-32" />
              <Skeleton className="mt-2 h-3 w-20" />
            </>
          ) : (
            <>
              <div className="mt-2 text-xl font-bold text-[#7dffc2]">
                {money(summary.income, currency)}
              </div>
              <div className="mt-1 text-xs text-[#9db8d4]">{summary.incomeCount} операций</div>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">Расходы</div>
          {showSkeleton ? (
            <>
              <Skeleton className="mt-2 h-6 w-32" />
              <Skeleton className="mt-2 h-3 w-20" />
            </>
          ) : (
            <>
              <div className="mt-2 text-xl font-bold text-[#ff9b9b]">
                {money(summary.expense, currency)}
              </div>
              <div className="mt-1 text-xs text-[#9db8d4]">{summary.expenseCount} операций</div>
            </>
          )}
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
            {showSkeleton
              ? 'Запрашиваем данные из MTBank…'
              : fetchedAt
                ? `Обновлено ${new Date(fetchedAt).toLocaleString('ru-RU')}${
                    loading ? ' · обновление…' : ''
                  }`
                : 'Данные подтягиваются из MTBank Open API'}
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
          <tbody aria-busy={showSkeleton}>
            {showSkeleton
              ? skeletonRows
              : visibleItems.map((row, index) => {
              const isExpense = row.direction === 'expense'
              return (
                <tr key={`${row.reference || row.id || 'row'}-${index}`} className="border-t border-white/[0.06] align-top">
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
            {!showSkeleton && !visibleItems.length ? (
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
