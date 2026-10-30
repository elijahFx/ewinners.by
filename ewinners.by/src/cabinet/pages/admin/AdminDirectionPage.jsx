import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, apiOpen } from '../../api'
import SearchSelect from '../../ui/SearchSelect'
import useLiveBalance from '../../useLiveBalance'

const DIRECTIONS = {
  hr: 'HR',
  digital: 'Digital',
  kc: 'КЦ',
}

const fieldClass =
  'mt-1.5 h-10 w-full rounded-lg border border-transparent bg-white/[0.06] px-3 text-sm font-medium text-[#f3f8ff] outline-none focus:bg-white/[0.09] focus:ring-2 focus:ring-[#4ea8ff]/35'

const dateClass =
  'mt-1 block h-9 rounded-lg border border-transparent bg-white/[0.06] px-2 text-xs font-medium text-[#f3f8ff] outline-none focus:bg-white/[0.09] focus:ring-2 focus:ring-[#4ea8ff]/35'

function money(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`
}

function moneyOrDash(v) {
  return v == null || v === '' ? '—' : money(v)
}

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Период по умолчанию — с первого числа текущего месяца по сегодня. */
function periodDefaults() {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  return { from: localDate(first), to: localDate(today) }
}

function normIban(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase()
}

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('ru-RU')
}

/**
 * Рабочее место направления: HR, Digital или КЦ.
 *
 * Одна страница на всё: список клиентов, форма создания клиента и генератор
 * счёта или акта. Пометка, которую вводит сотрудник, попадает в назначение
 * платежа счёта и в текст акта.
 */
export default function AdminDirectionPage() {
  const { code } = useParams()
  const direction = DIRECTIONS[code] ? code : 'hr'
  const label = DIRECTIONS[direction]

  const [companies, setCompanies] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  // форма нового клиента
  const [form, setForm] = useState({
    name: '',
    unp: '',
    legalAddress: '',
    bankName: '',
    iban: '',
    bic: '',
  })

  // генератор документов
  const [gen, setGen] = useState({ companyId: '', kind: 'invoice', amount: '', note: '' })
  const [accounts, setAccounts] = useState([])
  const [accountIban, setAccountIban] = useState('')

  // Банковские данные по счетам направлений: остаток, поступления, расходы
  const [bank, setBank] = useState(null)
  const [bankLoading, setBankLoading] = useState(true)
  const [bankError, setBankError] = useState('')
  const [period, setPeriod] = useState(periodDefaults)
  const [movementView, setMovementView] = useState('all')
  const bankRequestRef = useRef(0)

  async function loadCompanies(q = '') {
    try {
      setError('')
      const data = await api(
        `/api/direction/companies${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      )
      setCompanies(data.items || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    setMessage('')
    setError('')
    loadCompanies()
  }, [direction])

  // Счета направлений: у HR, Digital и КЦ они разные. Список от направления
  // не зависит, поэтому запрашиваем его один раз.
  const loadAccounts = useCallback(async () => {
    try {
      const data = await api('/api/direction/accounts')
      setAccounts(data.items || [])
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const ownAccount = useMemo(
    () => accounts.find((a) => a.code === direction) || null,
    [accounts, direction],
  )
  const ownIban = ownAccount?.iban || ''

  // При смене направления расчётный счёт сразу переключается на счёт этого
  // направления — ещё до ответа банка и без ручного выбора.
  useEffect(() => {
    if (ownIban) setAccountIban(ownIban)
  }, [direction, ownIban])

  const loadBank = useCallback(
    async ({ refresh = false } = {}) => {
      const requestId = ++bankRequestRef.current
      setBankLoading(true)
      setBankError('')
      try {
        const params = new URLSearchParams({ from: period.from, to: period.to })
        if (refresh) params.set('refresh', '1')
        const data = await api(`/api/direction/bank?${params.toString()}`)
        if (requestId !== bankRequestRef.current) return
        setBank(data)
        if (data?.message) setBankError(data.message)
      } catch (err) {
        if (requestId !== bankRequestRef.current) return
        setBank(null)
        setBankError(err.message)
      } finally {
        if (requestId === bankRequestRef.current) setBankLoading(false)
      }
    },
    [period.from, period.to],
  )

  useEffect(() => {
    loadBank()
  }, [loadBank])

  useLiveBalance(() => {
    loadCompanies(search)
    loadAccounts()
  })

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return companies
    return companies.filter((c) =>
      `${c.name} ${c.unp || ''} ${c.iban || ''}`.toLowerCase().includes(needle),
    )
  }, [companies, search])

  // Банковские счета из MTBank, разложенные по IBAN: по ним карточки счетов
  // показывают остаток и обороты, не дожидаясь нового запроса.
  const bankByIban = useMemo(() => {
    const map = new Map()
    for (const item of bank?.accounts || []) map.set(normIban(item.iban), item)
    return map
  }, [bank])

  // Выбранный счёт: по умолчанию — счёт направления, но его можно сменить
  // карточкой ниже. Обороты показываем именно по выбранному счёту.
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.iban === accountIban) || ownAccount,
    [accounts, accountIban, ownAccount],
  )
  const selectedIban = selectedAccount?.iban || ''
  const selectedBank = selectedIban ? bankByIban.get(normIban(selectedIban)) || null : null

  const accountMovements = useMemo(() => {
    const wanted = normIban(selectedIban)
    if (!wanted) return []
    const rows = (bank?.movements || []).filter((m) => normIban(m.accountIban) === wanted)
    if (movementView === 'income' || movementView === 'expense') {
      return rows.filter((m) => m.direction === movementView)
    }
    return rows
  }, [bank, selectedIban, movementView])

  async function createCompany(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await api('/api/direction/companies', {
        method: 'POST',
        body: { ...form, direction },
      })
      setMessage(`Клиент «${form.name}» добавлен в ${label}`)
      setForm({ name: '', unp: '', legalAddress: '', bankName: '', iban: '', bic: '' })
      await loadCompanies(search)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function generateDocument(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const data = await api('/api/direction/documents', {
        method: 'POST',
        body: {
          companyId: Number(gen.companyId),
          kind: gen.kind,
          amount: gen.amount ? Number(gen.amount) : undefined,
          note: gen.note,
          direction,
          iban: accountIban || undefined,
        },
      })
      const kindLabel = data.kind === 'act' ? 'Акт' : 'Счёт'
      setMessage(`${kindLabel} ${data.document?.number || ''} сформирован`)
      // Новый счёт меняет цифры на карточках направлений.
      await loadAccounts()
      if (data.document?.id) {
        try {
          await apiOpen(`/api/direction/documents/${data.document.id}/view`)
        } catch {
          /* документ всё равно доступен в разделе «Документы» */
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div>
        <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Направление {label}</h1>
        <p className="mt-1 text-sm text-[#9db8d4]">
          Клиенты направления, добавление новых и генерация счетов и актов.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/20 bg-[#3a1218] px-4 py-3 text-sm text-[#ffb4b4]">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-400/20 bg-[#0f2a1c] px-4 py-3 text-sm text-[#7dffc2]">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Добавление клиента */}
        <form
          onSubmit={createCompany}
          className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5"
        >
          <h2 className="m-0 text-base font-bold text-white">Новый клиент в {label}</h2>
          <p className="mt-1 text-xs text-[#9db8d4]">Название и УНП обязательны для счетов.</p>

          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Название
            <input
              required
              className={fieldClass}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="ООО «Пример»"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              УНП
              <input
                className={fieldClass}
                value={form.unp}
                onChange={(e) => setForm((p) => ({ ...p, unp: e.target.value }))}
                placeholder="190000000"
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              БИК
              <input
                className={fieldClass}
                value={form.bic}
                onChange={(e) => setForm((p) => ({ ...p, bic: e.target.value }))}
                placeholder="ALFABY2X"
              />
            </label>
          </div>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            IBAN
            <input
              className={fieldClass}
              value={form.iban}
              onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))}
              placeholder="BY00 XXXX 0000 0000 0000 0000 0000"
            />
          </label>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Банк
            <input
              className={fieldClass}
              value={form.bankName}
              onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))}
              placeholder="ОАО «АСБ Беларусбанк»"
            />
          </label>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Юридический адрес
            <input
              className={fieldClass}
              value={form.legalAddress}
              onChange={(e) => setForm((p) => ({ ...p, legalAddress: e.target.value }))}
              placeholder="г. Минск, ул. …"
            />
          </label>

          <button
            type="submit"
            className="cab-btn primary mt-4 w-full"
            style={{ minHeight: 40 }}
            disabled={busy}
          >
            {busy ? 'Сохраняю…' : 'Добавить клиента'}
          </button>
        </form>

        {/* Генератор документов */}
        <form
          onSubmit={generateDocument}
          className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5"
        >
          <h2 className="m-0 text-base font-bold text-white">Счёт или акт</h2>
          <p className="mt-1 text-xs text-[#9db8d4]">
            Пометка попадёт в счёт и в акт — например, «Оплата по счету № 12 от 01.10.2026».
          </p>

          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Клиент
            <div className="mt-1.5">
              <SearchSelect
                value={gen.companyId}
                onChange={(id) => setGen((p) => ({ ...p, companyId: id }))}
                options={companies}
                getLabel={(c) => c.name}
                getHint={(c) => money(c.balance)}
                placeholder="Начните вводить название…"
                emptyText="Клиент не найден"
              />
            </div>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Документ
              <select
                className={fieldClass}
                value={gen.kind}
                onChange={(e) => setGen((p) => ({ ...p, kind: e.target.value }))}
              >
                <option value="invoice">Счёт</option>
                <option value="act">Акт</option>
              </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Сумма, BYN
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={fieldClass}
                value={gen.amount}
                onChange={(e) => setGen((p) => ({ ...p, amount: e.target.value }))}
                placeholder={gen.kind === 'act' ? 'Если счёта ещё нет' : '0.00'}
              />
            </label>
          </div>

          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Пометка в документе
            <textarea
              className="mt-1.5 w-full rounded-lg border border-transparent bg-white/[0.06] px-3 py-2 text-sm font-medium text-[#f3f8ff] outline-none focus:bg-white/[0.09] focus:ring-2 focus:ring-[#4ea8ff]/35"
              rows={3}
              value={gen.note}
              onChange={(e) => setGen((p) => ({ ...p, note: e.target.value }))}
              placeholder="Оплата по счету № 12 от 01.10.2026"
            />
          </label>

          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Расчётный счёт
            <select
              className={fieldClass}
              value={accountIban}
              onChange={(e) => setAccountIban(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.iban} value={a.iban}>
                  {a.label} — {a.formatted}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-[#6f8bab]">
              Попадает в счёт и акт. При смене направления счёт переключается на {label} автоматически.
            </span>
          </label>

          <button
            type="submit"
            className="cab-btn primary mt-4 w-full"
            style={{ minHeight: 40 }}
            disabled={busy || !gen.companyId}
          >
            {busy ? 'Формирую…' : `Сформировать ${gen.kind === 'act' ? 'акт' : 'счёт'}`}
          </button>
        </form>
      </div>

      {/* Счета направлений: остатки и обороты из банка */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-bold text-white">Расчётные счета</h2>
            <span className="text-xs text-[#9db8d4]">
              Остаток, поступления и расходы из MTBank за период
              {bank?.fetchedAt
                ? ` · обновлено ${new Date(bank.fetchedAt).toLocaleString('ru-RU')}`
                : bankLoading
                  ? ' · загрузка…'
                  : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wide text-[#9db8d4]">
              С
              <input
                type="date"
                className={dateClass}
                value={period.from}
                onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
              />
            </label>
            <label className="text-[11px] font-bold uppercase tracking-wide text-[#9db8d4]">
              По
              <input
                type="date"
                className={dateClass}
                value={period.to}
                onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
              />
            </label>
            <button
              type="button"
              className="cab-btn ghost"
              style={{ minHeight: 36, padding: '0 12px', fontSize: '0.78rem' }}
              onClick={() => loadBank({ refresh: true })}
              disabled={bankLoading}
            >
              {bankLoading ? 'Обновляю…' : 'Обновить'}
            </button>
          </div>
        </div>

        {bankError ? (
          <div className="mb-3 rounded-xl border border-amber-400/20 bg-[#2a2110] px-3 py-2 text-xs text-[#ffd58a]">
            {bankError}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          {accounts.length === 0 ? (
            <div className="text-sm text-[#9db8d4]">Загружаю счета…</div>
          ) : (
            accounts.map((a) => {
              const info = bankByIban.get(normIban(a.iban))
              const isSelected = accountIban === a.iban
              const isDirection = a.code === direction
              return (
                <button
                  key={a.iban}
                  type="button"
                  onClick={() => setAccountIban(a.iban)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    isSelected
                      ? 'border-[#258dff] bg-[#258dff]/10'
                      : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white">{a.label}</span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                        isDirection
                          ? 'bg-[#258dff]/25 text-[#8fd2ff]'
                          : 'bg-white/[0.06] text-[#9db8d4]'
                      }`}
                    >
                      {isDirection ? 'Направление' : `${a.invoices} счетов`}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] tracking-tight text-[#8fd2ff]">
                    {a.formatted}
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-[#9db8d4]">Остаток в банке</span>
                      <span className="font-semibold text-white">
                        {info ? moneyOrDash(info.balance) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#9db8d4]">Поступления</span>
                      <span className="font-semibold text-[#7dffc2]">
                        {info ? money(info.income) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#9db8d4]">Расходы</span>
                      <span className="font-semibold text-[#ff9b9b]">
                        {info ? money(info.expense) : '—'}
                      </span>
                    </div>
                  </div>
                  {!info && bank && !bankLoading ? (
                    <div className="mt-1 text-[10px] font-semibold text-[#ffd58a]">
                      Счёт не подключён в MTBank
                    </div>
                  ) : null}
                  <div className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] leading-5 text-[#9db8d4]">
                    По счетам (всего): оплачено{' '}
                    <span className="text-[#7dffc2]">{money(a.paid)}</span>
                    <br />
                    ждёт оплаты <span className="text-[#ffd58a]">{money(a.awaiting)}</span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Обороты по выбранному счёту направления */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-bold text-white">
              Поступления и расходы по счёту {selectedAccount?.label || label}
            </h2>
            <span className="mt-1 block font-mono text-[11px] text-[#8fd2ff]">
              {selectedAccount?.formatted || '—'} · остаток{' '}
              {selectedBank ? moneyOrDash(selectedBank.balance) : '—'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all', label: 'Все' },
              { id: 'income', label: 'Поступления' },
              { id: 'expense', label: 'Расходы' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMovementView(tab.id)}
                className={`cab-btn ${movementView === tab.id ? 'primary' : 'ghost'}`}
                style={{ minHeight: 30, padding: '0 12px', fontSize: '0.78rem' }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-[#071529] text-xs uppercase tracking-wide text-[#9db8d4]">
              <tr>
                <th className="px-3 py-3 font-bold">Дата</th>
                <th className="px-3 py-3 font-bold">Тип</th>
                <th className="px-3 py-3 font-bold">Сумма</th>
                <th className="px-3 py-3 font-bold">Контрагент</th>
                <th className="px-3 py-3 font-bold">Назначение</th>
              </tr>
            </thead>
            <tbody>
              {bankLoading && !bank ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[#9db8d4]">
                    Загружаю операции из MTBank…
                  </td>
                </tr>
              ) : accountMovements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[#9db8d4]">
                    {bankError ||
                      (!selectedBank && bank
                        ? 'Счёт не подключён к MTBank — операций нет'
                        : 'Операций за период нет')}
                  </td>
                </tr>
              ) : (
                accountMovements.slice(0, 50).map((m) => {
                  const isExpense = m.direction === 'expense'
                  return (
                    <tr key={`${m.id}-${m.accountIban}`} className="border-t border-white/[0.06] align-top">
                      <td className="whitespace-nowrap px-3 py-3 text-[#cfe6ff]">
                        {formatDate(m.date)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            isExpense
                              ? 'bg-[#ff6b6b]/15 text-[#ff9b9b]'
                              : 'bg-[#7dffc2]/15 text-[#7dffc2]'
                          }`}
                        >
                          {isExpense ? 'Расход' : 'Поступление'}
                        </span>
                      </td>
                      <td
                        className={`whitespace-nowrap px-3 py-3 font-semibold ${
                          isExpense ? 'text-[#ff9b9b]' : 'text-[#7dffc2]'
                        }`}
                      >
                        {isExpense ? '−' : '+'}
                        {money(m.amount)}
                      </td>
                      <td className="px-3 py-3 font-medium text-white">{m.counterparty || '—'}</td>
                      <td className="max-w-[360px] px-3 py-3 text-[#cfe6ff]">{m.purpose || '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-[#9db8d4]">
          Показано {Math.min(accountMovements.length, 50)} из {accountMovements.length} · период{' '}
          {period.from} — {period.to}
        </div>
      </div>

      {/* Список клиентов */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-base font-bold text-white">Клиенты направления {label}</h2>
          <input
            className={fieldClass}
            style={{ maxWidth: 320 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию, УНП или IBAN"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-[#071529] text-xs uppercase tracking-wide text-[#9db8d4]">
              <tr>
                <th className="px-3 py-3 font-bold">Клиент</th>
                <th className="px-3 py-3 font-bold">УНП</th>
                <th className="px-3 py-3 font-bold">IBAN</th>
                <th className="px-3 py-3 font-bold">Баланс</th>
                <th className="px-3 py-3 font-bold" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[#9db8d4]">
                    Загрузка…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[#9db8d4]">
                    Клиентов пока нет
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="border-t border-white/[0.06]">
                    <td className="px-3 py-3 text-[#cfe6ff]">{c.name}</td>
                    <td className="px-3 py-3 text-[#9db8d4]">{c.unp || '—'}</td>
                    <td className="px-3 py-3 text-[#9db8d4]">{c.iban || '—'}</td>
                    <td className="px-3 py-3 font-semibold text-[#8fd2ff]">{money(c.balance)}</td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        className="cab-btn ghost"
                        style={{ minHeight: 30, padding: '0 12px', fontSize: '0.78rem' }}
                        onClick={() => setGen((p) => ({ ...p, companyId: String(c.id) }))}
                      >
                        В документ
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-[#9db8d4]">
          Показано {filtered.length} из {companies.length} · {localDate(new Date())}
        </div>
      </div>
    </div>
  )
}
