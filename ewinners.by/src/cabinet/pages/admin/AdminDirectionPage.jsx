import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { api, apiDownload, apiOpen } from '../../api'
import { useAuth } from '../../AuthContext'
import SearchSelect from '../../ui/SearchSelect'
import useLiveBalance from '../../useLiveBalance'

const DIRECTIONS = {
  hr: 'HR',
  digital: 'Digital',
  kc: 'КЦ',
}

const INVOICE_STATUS = {
  created: 'Создан',
  awaiting_payment: 'Ожидает оплаты',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  overdue: 'Просрочен',
  cancelled: 'Отменён',
  needs_review: 'Проверить',
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

function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Рабочее место направления: HR, Digital или КЦ.
 *
 * Одна страница на всё: форма создания клиента, генератор счёта
 * и список счетов направления. Пометка, которую вводит сотрудник,
 * попадает в назначение платежа счёта. Акты формируются автоматически
 * по итогам месяца и отражают только списания с баланса.
 */
export default function AdminDirectionPage() {
  const { code } = useParams()
  const { user } = useAuth()
  const direction = DIRECTIONS[code] ? code : 'hr'
  const label = DIRECTIONS[direction]
  const canMarkPaid = ['admin', 'accountant'].includes(user?.role)
  const isAdmin = user?.role === 'admin'

  const [companies, setCompanies] = useState([])
  const [invoices, setInvoices] = useState([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [invoiceBusy, setInvoiceBusy] = useState(null)
  const [deletingInvoice, setDeletingInvoice] = useState(null)
  const [invoiceMenu, setInvoiceMenu] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [unpStatus, setUnpStatus] = useState('')
  const [ibanStatus, setIbanStatus] = useState('')
  const [lookingUnp, setLookingUnp] = useState(false)
  const [oneoff, setOneoff] = useState({
    name: '',
    unp: '',
    bic: '',
    iban: '',
    bankName: '',
    legalAddress: '',
  })
  const [oneoffUnpStatus, setOneoffUnpStatus] = useState('')
  const [oneoffIbanStatus, setOneoffIbanStatus] = useState('')
  const [lookingOneoffUnp, setLookingOneoffUnp] = useState(false)

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
  const [gen, setGen] = useState({ companyId: '', amount: '', note: '' })
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
      const params = new URLSearchParams({ direction })
      if (q) params.set('q', q)
      const data = await api(`/api/direction/companies?${params.toString()}`)
      setCompanies(data.items || [])
    } catch (err) {
      setError(err.message)
    }
  }

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true)
    try {
      const data = await api(`/api/direction/invoices?direction=${encodeURIComponent(direction)}`)
      setInvoices(data.items || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setInvoicesLoading(false)
    }
  }, [direction])

  useEffect(() => {
    setMessage('')
    setError('')
    // У другого направления свои клиенты — выбранного в форме сбрасываем.
    setGen((prev) => ({ ...prev, companyId: '' }))
    loadCompanies()
    loadInvoices()
  }, [direction, loadInvoices])

  // УНП → название и юридический адрес из ЕГР.
  useEffect(() => {
    const unp = String(form.unp || '').replace(/\D/g, '')
    if (unp.length !== 9) {
      setUnpStatus(unp.length ? 'УНП: 9 цифр' : '')
      return
    }

    const t = setTimeout(async () => {
      setLookingUnp(true)
      setUnpStatus('Поиск в реестре…')
      try {
        const data = await api(`/api/lookup/unp/${unp}`)
        setForm((prev) => ({
          ...prev,
          unp: data.unp,
          name: data.name || prev.name,
          legalAddress: data.address || prev.legalAddress,
        }))
        setUnpStatus(
          data.status
            ? `Найдено: ${data.shortName || data.name} (${data.status})`
            : `Найдено: ${data.shortName || data.name}`,
        )
      } catch (err) {
        setUnpStatus(err.message || 'Не найдено')
      } finally {
        setLookingUnp(false)
      }
    }, 450)

    return () => clearTimeout(t)
  }, [form.unp])

  // IBAN → банк и БИК.
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
            iban: data.iban || prev.iban,
          }))
        }
        setIbanStatus(
          data.bankName
            ? `${data.bankName} · ${data.bic}`
            : data.message || (data.bic ? `БИК: ${data.bic}` : ''),
        )
      } catch (err) {
        setIbanStatus(err.message || 'Не удалось определить банк')
      }
    }, 350)

    return () => clearTimeout(t)
  }, [form.iban])

  // Те же подсказки для разового клиента в правой форме.
  useEffect(() => {
    const unp = String(oneoff.unp || '').replace(/\D/g, '')
    if (unp.length !== 9) {
      setOneoffUnpStatus(unp.length ? 'УНП: 9 цифр' : '')
      return
    }
    const t = setTimeout(async () => {
      setLookingOneoffUnp(true)
      setOneoffUnpStatus('Поиск в реестре…')
      try {
        const data = await api(`/api/lookup/unp/${unp}`)
        setOneoff((prev) => ({
          ...prev,
          unp: data.unp,
          name: data.name || prev.name,
          legalAddress: data.address || prev.legalAddress,
        }))
        setOneoffUnpStatus(
          data.status
            ? `Найдено: ${data.shortName || data.name} (${data.status})`
            : `Найдено: ${data.shortName || data.name}`,
        )
      } catch (err) {
        setOneoffUnpStatus(err.message || 'Не найдено')
      } finally {
        setLookingOneoffUnp(false)
      }
    }, 450)
    return () => clearTimeout(t)
  }, [oneoff.unp])

  useEffect(() => {
    const iban = String(oneoff.iban || '').replace(/\s+/g, '')
    if (iban.replace(/[^A-Za-z0-9]/g, '').length < 8) {
      setOneoffIbanStatus('')
      return
    }
    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/lookup/iban?iban=${encodeURIComponent(iban)}`)
        if (data.bankName || data.bic) {
          setOneoff((prev) => ({
            ...prev,
            bankName: data.bankName || prev.bankName,
            bic: data.bic || prev.bic,
            iban: data.iban || prev.iban,
          }))
        }
        setOneoffIbanStatus(
          data.bankName
            ? `${data.bankName} · ${data.bic}`
            : data.message || (data.bic ? `БИК: ${data.bic}` : ''),
        )
      } catch (err) {
        setOneoffIbanStatus(err.message || 'Не удалось определить банк')
      }
    }, 350)
    return () => clearTimeout(t)
  }, [oneoff.iban])

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
    loadCompanies()
    loadAccounts()
    loadInvoices()
  })

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
      setUnpStatus('')
      setIbanStatus('')
      await loadCompanies()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function generateDocument(e) {
    e.preventDefault()
    const oneoffData = {
      name: oneoff.name.trim(),
      unp: oneoff.unp.trim(),
      bic: oneoff.bic.trim(),
      iban: oneoff.iban.trim(),
      bankName: oneoff.bankName.trim(),
      legalAddress: oneoff.legalAddress.trim(),
    }
    if (!gen.companyId && !oneoffData.name) {
      setError('Выберите клиента из списка или заполните название разового клиента')
      return
    }
    if (!gen.companyId && !oneoffData.unp) {
      setError('Для разового клиента укажите УНП')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const data = await api('/api/direction/documents', {
        method: 'POST',
        body: {
          companyId: gen.companyId ? Number(gen.companyId) : undefined,
          oneoff: gen.companyId ? undefined : oneoffData,
          amount: gen.amount ? Number(gen.amount) : undefined,
          note: gen.note,
          direction,
          iban: accountIban || undefined,
        },
      })
      setMessage(`Счёт ${data.document?.number || ''} сформирован`)
      // Новый счёт меняет цифры на карточках направлений.
      await Promise.all([loadAccounts(), loadInvoices()])
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

  async function openInvoiceDocument(invoice, documentId, download = false) {
    if (!documentId) return
    try {
      if (download) {
        await apiDownload(`/api/direction/documents/${documentId}/download`, `${invoice.number}.pdf`)
      } else {
        await apiOpen(`/api/direction/documents/${documentId}/view`)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function markInvoicePaid(invoice) {
    const ok = window.confirm(
      `Отметить счёт ${invoice.number} оплаченным и зачислить ${money(invoice.amount)} на баланс «${invoice.company_name}»?`,
    )
    if (!ok) return
    setInvoiceBusy(invoice.id)
    setError('')
    setMessage('')
    try {
      await api(`/api/admin/invoices/${invoice.id}/mark-paid`, { method: 'POST', body: {} })
      await Promise.all([loadInvoices(), loadAccounts(), loadCompanies()])
      setMessage(`Счёт ${invoice.number} оплачен. Акт будет сформирован по итогам месяца`)
    } catch (err) {
      setError(err.message)
    } finally {
      setInvoiceBusy(null)
    }
  }

  function openInvoiceMenu(event, invoice) {
    const rect = event.currentTarget.getBoundingClientRect()
    setInvoiceMenu({
      invoice,
      top: rect.bottom + 8,
      right: Math.max(12, window.innerWidth - rect.right),
    })
  }

  async function deleteInvoice(invoice) {
    if (!isAdmin || !invoice) return
    const paid =
      ['paid', 'partially_paid'].includes(invoice.status) ||
      Number(invoice.paid_amount || 0) > 0 ||
      Boolean(invoice.paid_at)
    const paidNote = paid
      ? '\n\nСчёт оплачен. Если оплата подтверждена вручную, зачисление на баланс будет отменено.'
      : ''
    if (
      !window.confirm(
        `Удалить счёт ${invoice.number}?${paidNote}\n\nPDF счёта также будет удалён. Действие необратимо.`,
      )
    ) {
      return
    }
    setInvoiceMenu(null)
    setDeletingInvoice(invoice.id)
    setError('')
    setMessage('')
    try {
      const data = await api(`/api/admin/invoices/${invoice.id}`, { method: 'DELETE' })
      const reversed = Number(data.balanceReversed || 0)
      setMessage(
        reversed > 0
          ? `Счёт ${invoice.number} удалён, зачисление отменено на ${money(reversed)}`
          : `Счёт ${invoice.number} удалён`,
      )
      await Promise.all([loadInvoices(), loadAccounts(), loadCompanies()])
    } catch (err) {
      setError(err.message)
    } finally {
      setDeletingInvoice(null)
    }
  }

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div>
        <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Направление {label}</h1>
        <p className="mt-1 text-sm text-[#9db8d4]">
          Счета направления, добавление клиентов и генерация счетов. Акты формируются
          автоматически по итогам месяца и доступны в разделе «Документы».
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
              placeholder="Заполнится по УНП"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              УНП
              <input
                className={fieldClass}
                value={form.unp}
                onChange={(e) =>
                  setForm((p) => ({ ...p, unp: e.target.value.replace(/\D/g, '').slice(0, 9) }))
                }
                inputMode="numeric"
                maxLength={9}
                placeholder="190000000"
              />
              {unpStatus ? (
                <span className="mt-1 block text-[11px] font-medium normal-case text-[#9db8d4]">
                  {lookingUnp ? 'Поиск…' : unpStatus}
                </span>
              ) : null}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              БИК
              <input
                className={fieldClass}
                value={form.bic}
                onChange={(e) => setForm((p) => ({ ...p, bic: e.target.value }))}
                placeholder="Определится по счёту"
              />
            </label>
          </div>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            IBAN
            <input
              className={fieldClass}
              value={form.iban}
              onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value.toUpperCase() }))}
              placeholder="BY00 XXXX 0000 0000 0000 0000 0000"
            />
            {ibanStatus ? (
              <span className="mt-1 block text-[11px] font-medium normal-case text-[#9db8d4]">
                {ibanStatus}
              </span>
            ) : null}
          </label>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Банк
            <input
              className={fieldClass}
              value={form.bankName}
              onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))}
              placeholder="Определится по IBAN"
            />
          </label>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Юридический адрес
            <input
              className={fieldClass}
              value={form.legalAddress}
              onChange={(e) => setForm((p) => ({ ...p, legalAddress: e.target.value }))}
              placeholder="Подтянется из ЕГР"
            />
          </label>

          <button
            type="submit"
            className="cab-btn primary mt-4 w-full"
            style={{ minHeight: 40 }}
            disabled={busy || lookingUnp}
          >
            {busy ? 'Сохраняю…' : 'Добавить клиента'}
          </button>
        </form>

        {/* Генератор документов */}
        <form
          onSubmit={generateDocument}
          className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5"
        >
          <h2 className="m-0 text-base font-bold text-white">Счёт на оплату</h2>
          <p className="mt-1 text-xs text-[#9db8d4]">
            Пометка попадёт в счёт — например, «Оплата по счету № 12 от 01.10.2026».
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

          <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-[#8fd2ff]">
              Или разовый клиент
            </div>
            <p className="mt-1 text-[11px] leading-snug text-[#9db8d4]">
              Не добавляется в список клиентов. Данные попадут в счёт. Если выбран клиент
              из списка выше, эти поля не используются.
            </p>
            <label className="mt-2 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Название
              <input
                className={fieldClass}
                value={oneoff.name}
                onChange={(e) => setOneoff((p) => ({ ...p, name: e.target.value }))}
                placeholder="Заполнится по УНП"
              />
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
                УНП
                <input
                  className={fieldClass}
                  value={oneoff.unp}
                  onChange={(e) =>
                    setOneoff((p) => ({
                      ...p,
                      unp: e.target.value.replace(/\D/g, '').slice(0, 9),
                    }))
                  }
                  inputMode="numeric"
                  maxLength={9}
                  placeholder="190000000"
                />
                {oneoffUnpStatus ? (
                  <span className="mt-1 block text-[11px] font-medium normal-case text-[#9db8d4]">
                    {lookingOneoffUnp ? 'Поиск…' : oneoffUnpStatus}
                  </span>
                ) : null}
              </label>
              <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
                БИК
                <input
                  className={fieldClass}
                  value={oneoff.bic}
                  onChange={(e) => setOneoff((p) => ({ ...p, bic: e.target.value }))}
                  placeholder="Определится по счёту"
                />
              </label>
            </div>
            <label className="mt-2 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              IBAN
              <input
                className={fieldClass}
                value={oneoff.iban}
                onChange={(e) =>
                  setOneoff((p) => ({ ...p, iban: e.target.value.toUpperCase() }))
                }
                placeholder="BY00 XXXX 0000 0000 0000 0000 0000"
              />
              {oneoffIbanStatus ? (
                <span className="mt-1 block text-[11px] font-medium normal-case text-[#9db8d4]">
                  {oneoffIbanStatus}
                </span>
              ) : null}
            </label>
            <label className="mt-2 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Банк
              <input
                className={fieldClass}
                value={oneoff.bankName}
                onChange={(e) => setOneoff((p) => ({ ...p, bankName: e.target.value }))}
                placeholder="Определится по IBAN"
              />
            </label>
            <label className="mt-2 block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Юридический адрес
              <input
                className={fieldClass}
                value={oneoff.legalAddress}
                onChange={(e) => setOneoff((p) => ({ ...p, legalAddress: e.target.value }))}
                placeholder="Подтянется из ЕГР"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
              Сумма, BYN
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={fieldClass}
                value={gen.amount}
                onChange={(e) => setGen((p) => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
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
              Попадает в счёт. При смене направления счёт переключается на {label} автоматически.
            </span>
          </label>

          <button
            type="submit"
            className="cab-btn primary mt-4 w-full"
            style={{ minHeight: 40 }}
            disabled={
              busy ||
              lookingOneoffUnp ||
              (!gen.companyId && (!oneoff.name.trim() || !oneoff.unp.trim()))
            }
          >
            {busy ? 'Формирую…' : 'Сформировать счёт'}
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

      {/* Счета направления: сформировали счёт — он здесь, как в разделе «Счета» */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-bold text-white">Счета направления {label}</h2>
            <p className="mt-1 text-xs text-[#9db8d4]">
              Счёт появляется здесь сразу после формирования. Акт оказанных услуг формируется
              автоматически по итогам месяца и доступен в разделе «Документы».
            </p>
          </div>
          <button
            type="button"
            className="rounded-full border border-[#2a5f8f] bg-transparent px-4 py-2 text-xs font-bold text-[#cfe6ff] hover:bg-white/5 disabled:opacity-50"
            onClick={() => loadInvoices()}
            disabled={invoicesLoading}
          >
            {invoicesLoading ? 'Обновляю…' : 'Обновить'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead className="bg-[#071529] text-xs uppercase tracking-wide text-[#9db8d4]">
              <tr>
                <th className="px-3 py-3 font-bold">Номер</th>
                <th className="px-3 py-3 font-bold">Дата</th>
                <th className="px-3 py-3 font-bold">Организация</th>
                <th className="px-3 py-3 font-bold">Сумма</th>
                <th className="px-3 py-3 font-bold">Статус</th>
                <th className="px-3 py-3 font-bold">Действия</th>
              </tr>
            </thead>
            <tbody>
              {invoicesLoading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[#9db8d4]">
                    Загрузка…
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[#9db8d4]">
                    Счетов направления {label} пока нет
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t border-white/[0.06]">
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-[#cfe6ff]">
                      {invoice.number}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-[#9db8d4]">
                      {formatDateTime(invoice.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-white">{invoice.company_name}</div>
                      <div className="text-xs text-[#9db8d4]">
                        УНП {invoice.company_unp || '—'}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-[#8fd2ff]">
                      {money(invoice.amount)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          invoice.status === 'paid'
                            ? 'bg-[#7dffc2]/15 text-[#7dffc2]'
                            : invoice.status === 'cancelled'
                              ? 'bg-white/10 text-[#9db8d4]'
                              : 'bg-[#ffcf70]/15 text-[#ffe4b0]'
                        }`}
                      >
                        {INVOICE_STATUS[invoice.status] || invoice.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={!invoice.invoice_document_id}
                          onClick={() => openInvoiceDocument(invoice, invoice.invoice_document_id)}
                          className="rounded-full border border-[#2a5f8f] bg-transparent px-3 py-1.5 text-xs font-bold text-[#cfe6ff] hover:bg-white/5 disabled:opacity-40"
                        >
                          Смотреть
                        </button>
                        <button
                          type="button"
                          disabled={!invoice.invoice_document_id}
                          onClick={() => openInvoiceDocument(invoice, invoice.invoice_document_id, true)}
                          className="rounded-full border border-[#2a5f8f] bg-transparent px-3 py-1.5 text-xs font-bold text-[#cfe6ff] hover:bg-white/5 disabled:opacity-40"
                        >
                          Скачать
                        </button>
                        {canMarkPaid && invoice.status !== 'paid' && invoice.status !== 'cancelled' ? (
                          <button
                            type="button"
                            disabled={invoiceBusy === invoice.id}
                            onClick={() => markInvoicePaid(invoice)}
                            className="rounded-full border border-[#2f8f5b] bg-[#123a26] px-3 py-1.5 text-xs font-bold text-[#b7f7cf] hover:bg-[#174b31] disabled:opacity-50"
                          >
                            {invoiceBusy === invoice.id ? 'Зачисляю…' : 'Оплачен'}
                          </button>
                        ) : null}
                        {isAdmin ? (
                          <button
                            type="button"
                            aria-label="Ещё"
                            title="Ещё"
                            disabled={deletingInvoice === invoice.id}
                            onClick={(event) => openInvoiceMenu(event, invoice)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#2a5f8f] bg-transparent text-[#cfe6ff] hover:bg-white/5 disabled:opacity-40"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {invoiceMenu ? (
        <>
          <div
            className="fixed inset-0 z-[90] bg-black/10"
            onClick={() => setInvoiceMenu(null)}
          />
          <div
            className="fixed z-[100] min-w-[190px] rounded-xl border border-[#2a5f8f] bg-[#0b1f3a] p-1 shadow-2xl"
            style={{ top: invoiceMenu.top, right: invoiceMenu.right }}
          >
            <button
              type="button"
              disabled={deletingInvoice === invoiceMenu.invoice.id}
              onClick={() => deleteInvoice(invoiceMenu.invoice)}
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-[#ff9b9b] hover:bg-red-500/10 disabled:opacity-50"
            >
              {deletingInvoice === invoiceMenu.invoice.id ? 'Удаление…' : 'Удалить счёт'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
