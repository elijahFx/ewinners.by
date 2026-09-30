import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { statusLabel } from '../statusLabels'
import useLiveBalance from '../useLiveBalance'

function money(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState('1000')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      setError('')
      setData(await api('/api/cabinet/dashboard'))
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Баланс поменялся на сервере — обновляем карточку без перезагрузки.
  useLiveBalance(load)

  async function createInvoice(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/api/cabinet/invoices', {
        method: 'POST',
        body: { amount: Number(amount) },
      })
      await load()
      alert('Счёт сформирован. Откройте раздел «Счета».')
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return <div className="cab-alert">{error}</div>
  }
  if (!data) return <div className="cab-muted">Загрузка…</div>

  const c = data.company

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>{c.name}</h1>
          <p>Добро пожаловать, {user?.fullName}. Контролируйте баланс, счета и списания.</p>
        </div>
        <div className="cab-actions">
          <Link className="cab-btn ghost" to="/cabinet/operations">
            Детализация
          </Link>
        </div>
      </div>

      {data.lowBalance && (
        <div className="cab-alert">
          Баланс ниже порога уведомления ({money(c.notifyThreshold)}). Рекомендуем пополнить счёт.
        </div>
      )}

      <div className="cab-grid">
        <div className="cab-card cab-kpi">
          <span>Баланс</span>
          <strong>{money(c.balance)}</strong>
          <em>Доступно с лимитом: {money(c.availableLimit)}</em>
        </div>
        <div className="cab-card cab-kpi">
          <span>Расходы за месяц</span>
          <strong>{money(data.monthSpend)}</strong>
        </div>
        <div className="cab-card cab-kpi">
          <span>Пополнено за месяц</span>
          <strong>{money(data.monthTopup)}</strong>
        </div>
        <div className="cab-card cab-kpi">
          <span>Статус обслуживания</span>
          <strong style={{ fontSize: '1.35rem' }}>
            {statusLabel(c.status)}
          </strong>
        </div>

        <div className="cab-card span-2">
          <h3 style={{ margin: '0 0 14px', color: '#f7f9ff' }}>Пополнить баланс</h3>
          <form className="cab-form" onSubmit={createInvoice}>
            <label>
              Сумма, BYN
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <button className="cab-btn primary" disabled={busy} type="submit">
              Сформировать счёт
            </button>
          </form>
        </div>

        <div className="cab-card span-2">
          <h3 style={{ margin: '0 0 14px', color: '#f7f9ff' }}>Закреплённый менеджер</h3>
          <p className="cab-muted" style={{ margin: 0, lineHeight: 1.6 }}>
            {c.managerName || 'Не назначен'}
            <br />
            {c.managerPhone || '—'}
            <br />
            {c.managerEmail || '—'}
          </p>
        </div>

        <div className="cab-card span-2">
          <h3 style={{ margin: '0 0 14px', color: '#f7f9ff' }}>Активные проекты</h3>
          {data.projects.length === 0 ? (
            <div className="cab-empty">Проекты пока не подключены</div>
          ) : (
            <div className="cab-table-wrap">
              <table className="cab-table">
                <thead>
                  <tr>
                    <th>Проект</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {data.projects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        <span className="cab-chip">{statusLabel(p.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="cab-card span-2">
          <h3 style={{ margin: '0 0 14px', color: '#f7f9ff' }}>Последние операции</h3>
          {data.recent.length === 0 ? (
            <div className="cab-empty">Операций пока нет</div>
          ) : (
            <div className="cab-table-wrap">
              <table className="cab-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Тип</th>
                    <th>Сумма</th>
                    <th>Баланс</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((t) => (
                    <tr key={t.id}>
                      <td>{new Date(t.created_at).toLocaleString('ru-RU')}</td>
                      <td>{t.service_name || t.category}</td>
                      <td className={t.type === 'credit' ? 'cab-ok' : 'cab-bad'}>
                        {t.type === 'credit' ? '+' : '-'}
                        {money(t.amount)}
                      </td>
                      <td>{money(t.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
