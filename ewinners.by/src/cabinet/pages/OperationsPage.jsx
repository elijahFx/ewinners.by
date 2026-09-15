import { useEffect, useState } from 'react'
import { api, apiDownload } from '../api'

function money(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`
}

export default function OperationsPage() {
  const [items, setItems] = useState([])
  const [type, setType] = useState('')
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      const q = type ? `?type=${type}` : ''
      const data = await api(`/api/cabinet/transactions${q}`)
      setItems(data.items)
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    load()
  }, [type])

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Детализация расходов</h1>
          <p>История поступлений и списаний по тарифам и CRM-действиям.</p>
        </div>
        <div className="cab-actions">
          <select
            className="cab-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{
              minHeight: 42,
              borderRadius: 12,
              padding: '0 14px',
              minWidth: 180,
            }}
          >
            <option value="">Все операции</option>
            <option value="debit">Списания</option>
            <option value="credit">Пополнения</option>
          </select>
          <button
            type="button"
            className="cab-btn ghost"
            onClick={() =>
              apiDownload('/api/cabinet/export/transactions.csv', 'operations.csv').catch((e) =>
                setError(e.message),
              )
            }
          >
            Экспорт Excel
          </button>
        </div>
      </div>

      {error && <div className="cab-alert">{error}</div>}

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
              {items.map((t) => (
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
          {!items.length && <div className="cab-empty">Операций нет</div>}
        </div>
      </div>
    </>
  )
}
