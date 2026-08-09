import { useEffect, useState } from 'react'
import { api, apiDownload } from '../api'

export default function DocumentsPage() {
  const [items, setItems] = useState([])

  useEffect(() => {
    api('/api/cabinet/documents')
      .then((d) => setItems(d.items))
      .catch((e) => alert(e.message))
  }, [])

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Документы</h1>
          <p>Счета, акты, договоры и отчёты вашей компании.</p>
        </div>
      </div>
      <div className="cab-card">
        <div className="cab-table-wrap">
          <table className="cab-table">
            <thead>
              <tr>
                <th>Тип</th>
                <th>Название</th>
                <th>Номер</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td>{d.type}</td>
                  <td>{d.title}</td>
                  <td>{d.number || '—'}</td>
                  <td>{d.amount != null ? `${Number(d.amount).toFixed(2)} BYN` : '—'}</td>
                  <td><span className="cab-chip">{d.status}</span></td>
                  <td>
                    {d.file_path ? (
                      <button
                        type="button"
                        className="cab-btn ghost"
                        onClick={() => apiDownload(`/api/cabinet/documents/${d.id}/download`, `${d.number || d.id}.pdf`)}
                      >
                        Скачать
                      </button>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <div className="cab-empty">Документов пока нет</div>}
        </div>
      </div>
    </>
  )
}
