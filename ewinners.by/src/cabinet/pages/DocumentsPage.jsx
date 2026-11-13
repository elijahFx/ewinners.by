import { useEffect, useState } from 'react'
import { api, apiDownload, apiOpen } from '../api'
import { useAuth } from '../AuthContext'
import EmailSendModal from '../EmailSendModal'
import { statusLabel } from '../statusLabels'

const typeMap = {
  invoice: 'Счёт',
  act: 'Акт',
  detail: 'Детализация',
  contract: 'Договор',
  report: 'Отчёт',
  other: 'Документ',
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function monthStartIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function previousMonthIso() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthEndIso(month) {
  const [year, monthNumber] = String(month).split('-').map(Number)
  const lastDay = new Date(year, monthNumber, 0).getDate()
  return `${year}-${String(monthNumber).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

export default function DocumentsPage() {
  const { user, company } = useAuth()
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [emailTarget, setEmailTarget] = useState(null)
  const [from, setFrom] = useState(monthStartIso)
  const [to, setTo] = useState(todayIso)
  const [actPanelOpen, setActPanelOpen] = useState(false)
  const [actMonth, setActMonth] = useState(previousMonthIso)
  const [actBusy, setActBusy] = useState(false)

  async function load(range = { from, to }) {
    const params = new URLSearchParams()
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    const q = params.toString()
    const d = await api(`/api/cabinet/documents${q ? `?${q}` : ''}`)
    setItems(d.items || [])
  }

  useEffect(() => {
    setError('')
    load().catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id])

  async function applyPeriod(e) {
    e?.preventDefault?.()
    if (from && to && from > to) {
      setError('Дата «с» не может быть позже даты «по»')
      return
    }
    setBusy(true)
    setError('')
    try {
      await load({ from, to })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function resetPeriod() {
    const nextFrom = monthStartIso()
    const nextTo = todayIso()
    setFrom(nextFrom)
    setTo(nextTo)
    setBusy(true)
    setError('')
    try {
      await load({ from: nextFrom, to: nextTo })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function generateDetail() {
    if (!company?.id && !user?.companyId) {
      setError('Сначала выберите или создайте организацию')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const data = await api('/api/cabinet/documents/detail/generate', {
        method: 'POST',
        body: { companyId: company?.id || user?.companyId, from, to },
      })
      await load()
      const doc = data.document
      setMessage(
        data.message ||
          (data.updated
            ? 'Детализация за этот период уже была — PDF обновлён.'
            : 'Детализация сформирована.'),
      )
      if (doc?.id) {
        try {
          await apiOpen(`/api/cabinet/documents/${doc.id}/view`)
        } catch {
          /* list still updated */
        }
      }
    } catch (err) {
      setError(err.message || 'Не удалось сформировать детализацию')
    } finally {
      setBusy(false)
    }
  }

  async function requestAct(e) {
    e?.preventDefault?.()
    const companyId = company?.id || user?.companyId
    if (!companyId) {
      setError('Сначала выберите организацию')
      return
    }
    if (!actMonth) {
      setError('Выберите месяц')
      return
    }
    setActBusy(true)
    setError('')
    setMessage('')
    try {
      const data = await api('/api/cabinet/acts/request', {
        method: 'POST',
        body: { companyId, month: actMonth },
      })
      setMessage(
        data.created
          ? `Акт за ${data.periodLabel} сформирован.`
          : `Акт за ${data.periodLabel} уже сформирован — открываю.`,
      )
      setActPanelOpen(false)
      // Показываем именно тот месяц, за который запросили акт.
      const nextFrom = `${actMonth}-01`
      const nextTo = monthEndIso(actMonth)
      setFrom(nextFrom)
      setTo(nextTo)
      await load({ from: nextFrom, to: nextTo })
      if (data.document?.id) {
        await apiOpen(`/api/cabinet/documents/${data.document.id}/view`).catch(() => {})
      }
    } catch (err) {
      setError(err.message || 'Не удалось запросить акт')
    } finally {
      setActBusy(false)
    }
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Документы</h1>
          <p>
            Счета, акты, детализация услуг. Акт оказанных услуг формируется автоматически по
            итогам месяца и отражает только списания с баланса. Акт за прошедший месяц можно
            запросить отдельной кнопкой.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="cab-btn primary"
            onClick={() => {
              setError('')
              setMessage('')
              setActPanelOpen((open) => !open)
            }}
          >
            Запросить акт за месяц
          </button>
          <button type="button" className="cab-btn ghost" disabled={busy} onClick={generateDetail}>
            {busy ? 'Формирование…' : 'Сформировать детализацию'}
          </button>
        </div>
      </div>

      {actPanelOpen ? (
        <form className="cab-card ew-docs-period" onSubmit={requestAct}>
          <div className="ew-docs-period-title">Запросить акт за месяц</div>
          <div className="ew-docs-period-fields">
            <label>
              <span>Месяц</span>
              <input
                type="month"
                className="cab-select"
                value={actMonth}
                max={previousMonthIso()}
                onChange={(e) => setActMonth(e.target.value)}
              />
            </label>
            <button type="submit" className="cab-btn primary" disabled={actBusy}>
              {actBusy ? 'Формирую…' : 'Запросить акт'}
            </button>
            <button
              type="button"
              className="cab-btn ghost"
              disabled={actBusy}
              onClick={() => setActPanelOpen(false)}
            >
              Отмена
            </button>
          </div>
          <p style={{ margin: '10px 0 0', color: '#9db8d4', fontSize: 13 }}>
            Акт собирается только по фактическим списаниям с баланса за выбранный месяц. Если
            списаний не было, акт не формируется.
          </p>
        </form>
      ) : null}

      <form className="cab-card ew-docs-period" onSubmit={applyPeriod}>
        <div className="ew-docs-period-title">Период</div>
        <div className="ew-docs-period-fields">
          <label>
            <span>С</span>
            <input
              type="date"
              className="cab-select"
              value={from}
              min="2026-09-01"
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            <span>По</span>
            <input
              type="date"
              className="cab-select"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button type="submit" className="cab-btn primary" disabled={busy}>
            Показать
          </button>
          <button type="button" className="cab-btn ghost" disabled={busy} onClick={resetPeriod}>
            Сбросить
          </button>
        </div>
      </form>

      {error ? <div className="cab-alert">{error}</div> : null}
      {message ? (
        <div
          className="cab-alert"
          style={{
            borderColor: 'rgba(143, 210, 255, 0.4)',
            color: '#cfe6ff',
            background: 'rgba(37, 141, 255, 0.12)',
          }}
        >
          {message}
        </div>
      ) : null}

      <div className="cab-card">
        <div className="cab-table-wrap">
          <table className="cab-table">
            <thead>
              <tr>
                <th>Тип</th>
                <th>Название</th>
                <th>Номер</th>
                <th>Дата</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td>{typeMap[d.type] || d.type}</td>
                  <td>{d.title}</td>
                  <td>{d.number || '—'}</td>
                  <td>
                    {d.created_at
                      ? new Date(d.created_at).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td>{d.amount != null ? `${Number(d.amount).toFixed(2)} BYN` : '—'}</td>
                  <td>
                    <span className="cab-chip">{statusLabel(d.status)}</span>
                  </td>
                  <td>
                    {d.file_path ? (
                      <div className="cab-actions">
                        <button
                          type="button"
                          className="cab-btn ghost"
                          onClick={() =>
                            apiOpen(`/api/cabinet/documents/${d.id}/view`).catch((e) =>
                              setError(e.message),
                            )
                          }
                        >
                          Смотреть
                        </button>
                        <button
                          type="button"
                          className="cab-btn ghost"
                          onClick={() =>
                            apiDownload(
                              `/api/cabinet/documents/${d.id}/download`,
                              `${d.number || d.id}.pdf`,
                            ).catch((e) => setError(e.message))
                          }
                        >
                          Скачать
                        </button>
                        <button type="button" className="cab-btn ghost" onClick={() => setEmailTarget(d)}>
                          Email
                        </button>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <div className="cab-empty">Документов за выбранный период нет</div>}
        </div>
      </div>

      <EmailSendModal
        open={Boolean(emailTarget)}
        defaultEmail={user?.email || ''}
        title={emailTarget ? `Отправить: ${emailTarget.title || emailTarget.number}` : 'Отправить на email'}
        onClose={() => setEmailTarget(null)}
        onSend={async (email) => {
          const result = await api(`/api/cabinet/documents/${emailTarget.id}/email`, {
            method: 'POST',
            body: { email },
          })
          setMessage(`Отправлено на ${result.to}`)
        }}
      />
    </>
  )
}
