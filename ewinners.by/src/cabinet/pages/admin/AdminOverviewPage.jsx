import { useEffect, useState } from 'react'
import { api } from '../../api'

function money(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`
}

export default function AdminOverviewPage() {
  const [data, setData] = useState(null)

  useEffect(() => {
    api('/api/admin/overview')
      .then(setData)
      .catch((e) => alert(e.message))
  }, [])

  if (!data) return <div className="cab-muted">Загрузка…</div>

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Админ-панель</h1>
          <p>Клиенты, балансы, платежи и журнал операций.</p>
        </div>
      </div>
      <div className="cab-grid">
        <div className="cab-card cab-kpi"><span>Клиенты</span><strong>{data.companies}</strong></div>
        <div className="cab-card cab-kpi"><span>Пользователи</span><strong>{data.users}</strong></div>
        <div className="cab-card cab-kpi"><span>Низкий баланс</span><strong>{data.lowBalanceCompanies}</strong></div>
        <div className="cab-card cab-kpi"><span>Сумма балансов</span><strong>{money(data.totalBalances)}</strong></div>
        <div className="cab-card span-4">
          <h3 style={{ margin: '0 0 14px', color: '#f7f9ff' }}>Последние операции</h3>
          <div className="cab-table-wrap">
            <table className="cab-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Клиент</th>
                  <th>Тип</th>
                  <th>Сумма</th>
                  <th>Баланс</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTx.map((t) => (
                  <tr key={t.id}>
                    <td>{new Date(t.created_at).toLocaleString('ru-RU')}</td>
                    <td>{t.company_name}</td>
                    <td>{t.category}</td>
                    <td className={t.type === 'credit' ? 'cab-ok' : 'cab-bad'}>{money(t.amount)}</td>
                    <td>{money(t.balance_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
