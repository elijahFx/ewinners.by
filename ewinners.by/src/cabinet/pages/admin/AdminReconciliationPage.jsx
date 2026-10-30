import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Wrench } from 'lucide-react'
import { api } from '../../api'

const PERIODS = [
  { value: 1, label: 'Сегодня' },
  { value: 2, label: '2 дня' },
  { value: 7, label: 'Неделя' },
  { value: 31, label: 'Месяц' },
]

function money(value) {
  return `${Number(value || 0).toFixed(2)} BYN`
}

export default function AdminReconciliationPage() {
  const [days, setDays] = useState(2)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  const load = useCallback(async (period = days) => {
    setBusy(true)
    setError('')
    setDone(null)
    try {
      setReport(await api(`/api/admin/reconciliation?days=${period}`))
    } catch (err) {
      setError(err.message || 'Не удалось выполнить сверку')
    } finally {
      setBusy(false)
    }
  }, [days])

  useEffect(() => {
    load(days)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days])

  const recover = async () => {
    if (!report?.missing?.length) return
    const list = report.missing.filter((m) => m.companyId)
    if (!list.length) {
      setError('Все найденные заказы — из непривязанных проектов, списывать не с кого')
      return
    }
    const ok = window.confirm(
      `Восстановить ${list.length} списаний на ${money(list.reduce((s, m) => s + m.amount, 0))}?`,
    )
    if (!ok) return
    setRecovering(true)
    setError('')
    try {
      const result = await api('/api/admin/reconciliation/recover', {
        method: 'POST',
        body: { days },
      })
      setDone(result)
      await load(days)
    } catch (err) {
      setError(err.message || 'Не удалось восстановить')
    } finally {
      setRecovering(false)
    }
  }

  const missing = report?.missing || []
  const mapped = missing.filter((m) => m.companyId)
  const unmapped = missing.filter((m) => !m.companyId)

  const card = 'rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4'
  const label = 'text-xs font-bold uppercase tracking-wide text-[#9db8d4]'

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Сверка со SalesRender</h1>
          <p className="mt-1 max-w-3xl text-sm text-[#9db8d4]">
            Сравнивает заказы SalesRender в платных статусах с нашими списаниями. Если вебхук не дошёл,
            заказ остаётся несписанным навсегда — здесь он и находится.
            {report?.billingStartDate && (
              <>
                {' '}
                Заказы <b className="text-[#cfe6ff]">раньше {report.billingStartDate}</b> не учитываются:
                тогда система ещё не работала в полную силу.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setDays(p.value)}
              className={`rounded-full border px-4 py-2 text-sm font-bold ${
                days === p.value
                  ? 'border-[#258dff] bg-[#258dff] text-white'
                  : 'border-[#2a5f8f] bg-transparent text-[#cfe6ff] hover:bg-white/5'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => load(days)}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full border border-[#2a5f8f] bg-transparent px-4 py-2 text-sm font-bold text-[#cfe6ff] hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
            Проверить
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/50 bg-[#3a1414] px-4 py-3 text-sm font-semibold text-[#ffc9c9]">
          {error}
        </div>
      )}

      {done && (
        <div className="rounded-xl border border-emerald-400/50 bg-[#0f2e1d] px-4 py-3 text-sm font-semibold text-[#b7f7cf]">
          Восстановлено списаний: {done.restored}
          {done.skipped ? `, пропущено как повтор: ${done.skipped}` : ''}
          {done.failed ? `, ошибок: ${done.failed}` : ''} — на сумму {money(done.amount)}
        </div>
      )}

      {report && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className={card}>
              <div className={label}>Проверено заказов</div>
              <div className="mt-1 text-2xl font-bold text-white">{report.ordersChecked}</div>
            </div>
            <div className={card}>
              <div className={label}>Списано корректно</div>
              <div className="mt-1 text-2xl font-bold text-[#7ee2a8]">{report.charged}</div>
            </div>
            <div className={card}>
              <div className={label}>Не списано</div>
              <div className={`mt-1 text-2xl font-bold ${missing.length ? 'text-[#ff9b9b]' : 'text-[#7ee2a8]'}`}>
                {missing.length}
                {missing.length > 0 && (
                  <span className="ml-2 text-base font-semibold text-[#ffc9c9]">{money(report.missingAmount)}</span>
                )}
              </div>
            </div>
          </div>

          {!missing.length ? (
            <div className={`${card} flex items-center gap-3 text-[#b7f7cf]`}>
              <CheckCircle2 size={20} />
              <span className="font-semibold">Расхождений нет — все заказы за период списаны.</span>
            </div>
          ) : (
            <>
              {unmapped.length > 0 && (
                <div className="rounded-xl border border-amber-400/50 bg-[#3a2a10] px-4 py-3 text-sm text-[#ffe4b0]">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle size={16} />
                    Заказы из непривязанных проектов: {unmapped.length}
                  </div>
                  <div className="mt-1">
                    Проекты SalesRender{' '}
                    <b>{[...new Set(unmapped.map((m) => m.projectId))].join(', ')}</b> не привязаны ни к одному
                    клиенту — списать не с кого. Укажите ID проекта в карточке клиента.
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e4a73] px-4 py-3">
                  <span className="font-bold">По клиентам</span>
                  {mapped.length > 0 && (
                    <button
                      type="button"
                      onClick={recover}
                      disabled={recovering}
                      className="inline-flex items-center gap-2 rounded-full border-0 bg-[#258dff] px-4 py-2 text-sm font-bold text-white hover:bg-[#3b9eff] disabled:opacity-50"
                    >
                      <Wrench size={15} />
                      {recovering
                        ? 'Восстанавливаю…'
                        : `Восстановить списания (${mapped.length}, ${money(mapped.reduce((s, m) => s + m.amount, 0))})`}
                    </button>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[#9db8d4]">
                      <th className="px-4 py-3">Клиент</th>
                      <th className="px-4 py-3 text-right">Заказов</th>
                      <th className="px-4 py-3 text-right">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byCompany.map((c) => (
                      <tr key={c.companyId} className="border-t border-[#1e4a73]">
                        <td className="px-4 py-3">{c.companyName}</td>
                        <td className="px-4 py-3 text-right">{c.count}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#ffc9c9]">{money(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details className="overflow-hidden rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a]">
                <summary className="cursor-pointer px-4 py-3 font-bold">
                  Показать все заказы ({missing.length})
                </summary>
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[#0b1f3a]">
                      <tr className="text-left text-xs uppercase tracking-wide text-[#9db8d4]">
                        <th className="px-3 py-2">Заказ</th>
                        <th className="px-3 py-2">Проект</th>
                        <th className="px-3 py-2">№ у клиента</th>
                        <th className="px-3 py-2">Получатель</th>
                        <th className="px-3 py-2">Статус</th>
                        <th className="px-3 py-2 text-right">Должно быть</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missing.map((m) => (
                        <tr key={m.id} className="border-t border-[#1e4a73]">
                          <td className="px-3 py-2 font-mono">{m.id}</td>
                          <td className="px-3 py-2">
                            {m.projectName || m.projectId}
                            {!m.companyId && <span className="ml-2 text-[#ffc9c9]">не привязан</span>}
                          </td>
                          <td className="px-3 py-2">{m.clientOrderNumber || '—'}</td>
                          <td className="px-3 py-2">
                            {m.customerName || '—'}
                            {m.customerPhone ? <span className="text-[#9db8d4]"> {m.customerPhone}</span> : null}
                          </td>
                          <td className="px-3 py-2">
                            {m.statusName}
                            {m.upsell ? ' · апсейл' : ''}
                            {m.cross ? ' · кроссейл' : ''}
                          </td>
                          <td className="px-3 py-2 text-right">{m.companyId ? money(m.amount) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </div>
  )
}
