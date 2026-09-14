import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, Eye, Receipt } from 'lucide-react'
import { api, apiDownload, apiOpen } from '../../api'
import Button from '../../ui/Button'
import SearchField from '../../ui/SearchField'
import SegmentedControl from '../../ui/SegmentedControl'

const STATUS_LABEL = {
  created: 'Создан',
  awaiting_payment: 'Ожидает оплаты',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  overdue: 'Просрочен',
  cancelled: 'Отменён',
  needs_review: 'Требует проверки',
}

const STATUS_TABS = [
  { id: '', label: 'Все' },
  { id: 'awaiting_payment', label: 'Ожидают' },
  { id: 'paid', label: 'Оплачены' },
  { id: 'overdue', label: 'Просрочены' },
  { id: 'cancelled', label: 'Отменены' },
]

function money(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} BYN`
}

function canMarkPaid(status) {
  return status !== 'paid' && status !== 'cancelled'
}

const fieldClass =
  'mt-1.5 h-10 w-full rounded-lg border border-transparent bg-white/[0.06] px-3 text-sm font-medium text-[#f3f8ff] outline-none focus:bg-white/[0.09] focus:ring-2 focus:ring-[#4ea8ff]/35'

export default function AdminInvoicesPage() {
  const [items, setItems] = useState([])
  const [companies, setCompanies] = useState([])
  const [status, setStatus] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    if (companyId) p.set('companyId', companyId)
    if (q.trim()) p.set('q', q.trim())
    return p.toString()
  }, [status, companyId, q])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [invoices, comps] = await Promise.all([
        api(`/api/admin/invoices${queryString ? `?${queryString}` : ''}`),
        api('/api/admin/companies'),
      ])
      setItems(invoices.items || [])
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

  async function markPaid(invoice) {
    const ok = window.confirm(
      `Отметить счёт ${invoice.number} оплаченным и зачислить ${money(invoice.amount)} на баланс «${invoice.company_name}»?`,
    )
    if (!ok) return
    setBusyId(invoice.id)
    setError('')
    try {
      await api(`/api/admin/invoices/${invoice.id}/mark-paid`, { method: 'POST', body: {} })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div>
        <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Счета клиентов</h1>
        <p className="mt-1 text-sm text-[#9db8d4]">
          Все счета организаций: просмотр, скачивание и ручное подтверждение оплаты с зачислением на баланс.
        </p>
      </div>

      <SegmentedControl
        items={STATUS_TABS}
        value={status}
        onChange={setStatus}
      />

      <div className="rounded-2xl border border-white/[0.06] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
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
                  {c.name}{c.unp ? ` · УНП ${c.unp}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
            Поиск
            <SearchField
              className="mt-1.5"
              value={q}
              placeholder="Номер счёта, УНП, компания…"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/20 bg-[#3a1218] px-4 py-3 text-sm text-[#ffb4b4]">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-[#0b1f3a]">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
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
            {items.map((invoice) => (
              <tr key={invoice.id} className="border-t border-white/[0.06] align-middle">
                <td className="px-3 py-3 font-semibold text-white">{invoice.number}</td>
                <td className="px-3 py-3 whitespace-nowrap text-[#cfe6ff]">
                  {new Date(invoice.created_at).toLocaleString('ru-RU')}
                </td>
                <td className="px-3 py-3">
                  <div className="font-medium text-white">{invoice.company_name}</div>
                  <div className="text-xs text-[#9db8d4]">
                    УНП {invoice.company_unp || '—'}
                    {invoice.company_balance != null
                      ? ` · баланс ${money(invoice.company_balance)}`
                      : ''}
                  </div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap font-semibold text-[#8fd2ff]">
                  {money(invoice.amount)}
                </td>
                <td className="px-3 py-3">
                  <span className="inline-flex rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-bold text-[#cfe6ff]">
                    {STATUS_LABEL[invoice.status] || invoice.status}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        apiOpen(`/api/admin/invoices/${invoice.id}/view`).catch((e) =>
                          alert(e.message),
                        )
                      }
                    >
                      <Eye className="size-3.5" />
                      Смотреть
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        apiDownload(
                          `/api/admin/invoices/${invoice.id}/download`,
                          `${invoice.number}.pdf`,
                        ).catch((e) => alert(e.message))
                      }
                    >
                      <Download className="size-3.5" />
                      Скачать
                    </Button>
                    {canMarkPaid(invoice.status) ? (
                      <Button
                        size="sm"
                        variant="success"
                        disabled={busyId === invoice.id}
                        onClick={() => markPaid(invoice)}
                      >
                        <CheckCircle2 className="size-3.5" />
                        {busyId === invoice.id ? 'Зачисление…' : 'Оплачен'}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-[#9db8d4]">
                  <Receipt className="mr-2 inline size-[18px] opacity-60" />
                  {loading ? 'Загрузка…' : 'Счетов по фильтру нет'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
