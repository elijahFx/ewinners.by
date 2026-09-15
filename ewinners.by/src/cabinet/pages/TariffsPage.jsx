import { useEffect, useState } from 'react'
import { api } from '../api'
import { statusLabel } from '../statusLabels'

export default function TariffsPage() {
  const [items, setItems] = useState([])

  useEffect(() => {
    api('/api/cabinet/tariffs')
      .then((d) => setItems(d.items))
      .catch((e) => alert(e.message))
  }, [])

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Тарифы</h1>
          <p>Актуальные тарифы по услугам и проектам.</p>
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
                  <td>{t.project_name || 'Все проекты'}</td>
                  <td>{statusLabel(t.billing_type)}</td>
                  <td>
                    {Number(t.price).toFixed(2)} BYN / {t.unit}
                  </td>
                  <td>{t.valid_from}</td>
                  <td>{t.company_id ? 'Индивидуальный' : 'Базовый'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <div className="cab-empty">Тарифы не назначены</div>}
        </div>
      </div>
    </>
  )
}
