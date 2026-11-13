import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, Wrench } from 'lucide-react'
import { api } from '../../api'
import { useAuth } from '../../AuthContext'

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
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [days, setDays] = useState(2)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
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

  const chargePending = async (row) => {
    if (!window.confirm(`Списать ${money(row.amount)} с клиента «${row.companyName}»?`)) return
    setActionBusy(`charge-${row.id}`)
    setError('')
    try {
      await api(`/api/admin/reconciliation/pending/${row.id}/charge`, { method: 'POST' })
      setDone({ restored: 1, skipped: 0, failed: 0, amount: row.amount, pendingCharge: true })
      await load(days)
    } catch (err) {
      setError(err.message || 'Не удалось списать заказ')
    } finally {
      setActionBusy('')
    }
  }

  const cancelPending = async (row) => {
    const reason = window.prompt(
      `Причина отмены заказа #${row.orderId} на ${money(row.amount)}?`,
      'Отменено администратором',
    )
    if (reason === null) return
    setActionBusy(`cancel-${row.id}`)
    setError('')
    try {
      await api(`/api/admin/reconciliation/pending/${row.id}/cancel`, {
        method: 'POST',
        body: { reason },
      })
      await load(days)
    } catch (err) {
      setError(err.message || 'Не удалось отменить заказ')
    } finally {
      setActionBusy('')
    }
  }

  const reconcileCompany = async (companyId) => {
    setActionBusy(`reconcile-${companyId}`)
    setError('')
    try {
      await api(`/api/admin/companies/${companyId}/reconcile`, { method: 'POST' })
      await load(days)
    } catch (err) {
      setError(err.message || 'Не удалось пересчитать состояние')
    } finally {
      setActionBusy('')
    }
  }

  const missing = report?.missing || []
  const mapped = missing.filter((m) => m.companyId)
  const unmapped = missing.filter((m) => !m.companyId)
  const pending = report?.pending || []
  const blockedCompanies = report?.blockedCompanies || []
  const blockedProjects = (report?.blockedProjects || []).filter(
    (p) => Number(p.archived_by_us) === 1 || p.last_error,
  )

  const pendingReason = (row) =>
    row.reason === 'overdraft_limit'
      ? 'кредитный лимит'
      : row.reason === 'manual'
        ? 'вручную'
        : 'недостаточно баланса'

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
          {done.pendingCharge
            ? `Заказ списан из пограничной зоны — на сумму ${money(done.amount)}`
            : `Восстановлено списаний: ${done.restored}`}
          {!done.pendingCharge && done.queued ? `, в пограничную зону: ${done.queued}` : ''}
          {!done.pendingCharge && done.skipped ? `, пропущено как повтор: ${done.skipped}` : ''}
          {!done.pendingCharge && done.failed ? `, ошибок: ${done.failed}` : ''}
          {!done.pendingCharge ? ` — на сумму ${money(done.amount)}` : ''}
        </div>
      )}

      {report && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <div className={card}>
              <div className={label}>Пограничная зона</div>
              <div className={`mt-1 text-2xl font-bold ${pending.length ? 'text-[#ffcf70]' : 'text-[#7ee2a8]'}`}>
                {pending.length}
                {pending.length > 0 && (
                  <span className="ml-2 text-base font-semibold text-[#ffe4b0]">
                    {money(report.pendingAmount)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {blockedCompanies.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e4a73] px-4 py-3">
                <span className="inline-flex items-center gap-2 font-bold">
                  <ShieldAlert size={16} className="text-[#ffcf70]" />
                  Остановленные клиенты и проекты
                </span>
                <span className="text-xs text-[#9db8d4]">
                  {report.blockedCompanies?.some((c) => Number(c.dry_run) === 1)
                    ? 'Включён dry-run: реальные проекты пока не архивируются'
                    : 'Архивация проектов SalesRender включена'}
                </span>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[#9db8d4]">
                      <th className="px-4 py-3">Клиент</th>
                      <th className="px-4 py-3 text-right">Доступно</th>
                      <th className="px-4 py-3 text-right">В очереди</th>
                      <th className="px-4 py-3">Режим</th>
                      <th className="px-4 py-3">Ошибка</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {blockedCompanies.map((company) => (
                      <tr key={company.company_id} className="border-t border-[#1e4a73]">
                        <td className="px-4 py-3">
                          {company.company_name}
                          {company.reason && (
                            <span className="ml-2 text-xs text-[#9db8d4]">
                              {company.reason === 'pending' ? 'есть неоплаченные заказы' : 'лимит исчерпан'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">{money(company.available)}</td>
                        <td className="px-4 py-3 text-right">
                          {company.pending_count} / {money(company.pending_amount)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {Number(company.dry_run) === 1 ? (
                            <span className="rounded-full bg-[#3a2a10] px-2 py-1 font-bold text-[#ffe4b0]">
                              dry-run
                            </span>
                          ) : Number(company.applied) === 1 ? (
                            <span className="rounded-full bg-[#3a1414] px-2 py-1 font-bold text-[#ffc9c9]">
                              остановлен
                            </span>
                          ) : (
                            <span className="rounded-full bg-[#1e4a73] px-2 py-1 font-bold text-[#cfe6ff]">
                              в процессе
                            </span>
                          )}
                        </td>
                        <td className="max-w-[260px] px-4 py-3 text-xs text-[#ffc9c9]">
                          {company.last_error || '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={actionBusy === `reconcile-${company.company_id}`}
                            onClick={() => reconcileCompany(company.company_id)}
                            className="rounded-full border border-[#2a5f8f] bg-transparent px-3 py-1.5 text-xs font-bold text-[#cfe6ff] hover:bg-white/5 disabled:opacity-50"
                          >
                            Пересчитать
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {blockedProjects.length > 0 && (
                <div className="border-t border-[#1e4a73] px-4 py-3 text-xs text-[#9db8d4]">
                  Проекты SalesRender:{' '}
                  {blockedProjects.map((p) => (
                    <span key={`${p.company_id}-${p.salesrender_project_id}`} className="mr-3 inline-block">
                      <b className="text-[#cfe6ff]">{p.company_name}</b> / {p.salesrender_project_id}
                      {Number(p.archived_by_us) === 1 ? ' — архивирован нами' : ' — ошибка'}
                      {p.last_error ? ` (${p.last_error})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {pending.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e4a73] px-4 py-3">
                <span className="font-bold">Пограничная зона</span>
                <span className="text-xs text-[#9db8d4]">
                  Заказы после исчерпания лимита. Списываются после пополнения; проект остаётся
                  остановленным, пока очередь не пуста.
                </span>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#0b1f3a]">
                    <tr className="text-left text-xs uppercase tracking-wide text-[#9db8d4]">
                      <th className="px-4 py-3">Заказ</th>
                      <th className="px-4 py-3">Клиент</th>
                      <th className="px-4 py-3">Тип</th>
                      <th className="px-4 py-3">Причина</th>
                      <th className="px-4 py-3">Дата</th>
                      <th className="px-4 py-3 text-right">Сумма</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((row) => (
                      <tr key={row.id} className="border-t border-[#1e4a73]">
                        <td className="px-4 py-3 font-mono">{row.orderId}</td>
                        <td className="px-4 py-3">{row.companyName}</td>
                        <td className="px-4 py-3">{row.kind === 'delivered' ? 'выкуп' : 'обзвон'}</td>
                        <td className="px-4 py-3 text-xs text-[#ffe4b0]">{pendingReason(row)}</td>
                        <td className="px-4 py-3 text-xs text-[#9db8d4]">
                          {row.createdAt ? new Date(row.createdAt).toLocaleString('ru-RU') : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-[#ffe4b0]">
                          {money(row.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {isAdmin ? (
                              <>
                                <button
                                  type="button"
                                  disabled={actionBusy === `charge-${row.id}`}
                                  onClick={() => chargePending(row)}
                                  className="rounded-full bg-[#258dff] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#3b9eff] disabled:opacity-50"
                                >
                                  Списать
                                </button>
                                <button
                                  type="button"
                                  disabled={actionBusy === `cancel-${row.id}`}
                                  onClick={() => cancelPending(row)}
                                  className="rounded-full border border-red-400/50 bg-transparent px-3 py-1.5 text-xs font-bold text-[#ffc9c9] hover:bg-red-500/10 disabled:opacity-50"
                                >
                                  Отменить
                                </button>
                              </>
                            ) : (
                              <span className="text-xs text-[#9db8d4]">только просмотр</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!missing.length && !pending.length && !blockedCompanies.length ? (
            <div className={`${card} flex items-center gap-3 text-[#b7f7cf]`}>
              <CheckCircle2 size={20} />
              <span className="font-semibold">Расхождений нет — все заказы за период списаны.</span>
            </div>
          ) : (
            <>
              {missing.length > 0 && (
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
                  {isAdmin && mapped.length > 0 && (
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
        </>
      )}
    </div>
  )
}
