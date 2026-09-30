import { useEffect, useState } from 'react'
import { api } from '../api'
import { statusLabel } from '../statusLabels'

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('ru-RU')
}

export default function TariffsPage() {
  const [items, setItems] = useState([])
  const [scope, setScope] = useState('project')

  useEffect(() => {
    api('/api/cabinet/tariffs')
      .then((d) => {
        setItems(d.items || [])
        setScope(d.scope || 'project')
      })
      .catch((e) => alert(e.message))
  }, [])

  const individual = scope === 'individual'

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Тарифы</h1>
          <p>
            {individual
              ? 'Индивидуальный прайс, подключённый для вашей организации.'
              : 'Тарифы, подключённые для ваших проектов.'}
          </p>
        </div>
      </div>
      <div className="cab-card">
        <div className="cab-table-wrap">
          <table className="cab-table">
            <thead>
              <tr>
                <th>Услуга</th>
                <th>Проект</th>
                <th>Тип</th>
                <th>Цена</th>
                <th>Действует с</th>
                <th>Область</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>{t.service_name}</td>
                  <td>{t.project_name || (individual ? 'Все проекты' : '—')}</td>
                  <td>{statusLabel(t.billing_type)}</td>
                  <td>
                    {Number(t.price).toFixed(2)} BYN / {t.unit}
                  </td>
                  <td>{formatDate(t.valid_from)}</td>
                  <td>
                    <span className="cab-chip">
                      {individual ? 'Индивидуальный' : 'Проект'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <div className="cab-empty">
              Тарифы пока не подключены. Обратитесь к вашему менеджеру.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
