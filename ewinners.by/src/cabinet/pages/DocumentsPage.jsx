import { useEffect, useState } from 'react'
import { api, apiDownload, apiOpen } from '../api'
import { useAuth } from '../AuthContext'
import EmailSendModal from '../EmailSendModal'

const typeMap = {
  invoice: 'Счёт',
  act: 'Акт',
  detail: 'Детализация',
  contract: 'Договор',
  report: 'Отчёт',
  other: 'Документ',
}

export default function DocumentsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [emailTarget, setEmailTarget] = useState(null)

  async function load() {
    const d = await api('/api/cabinet/documents')
    setItems(d.items)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  async function generateDetail() {
    setBusy(true)
    try {
      await api('/api/cabinet/documents/detail/generate', { method: 'POST', body: {} })
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Документы</h1>
          <p>Счета, акты, детализация услуг. Просмотр на сайте, скачивание и отправка на email.</p>
        </div>
        <button type="button" className="cab-btn primary" disabled={busy} onClick={generateDetail}>
          Сформировать детализацию
        </button>
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
                  <td>{typeMap[d.type] || d.type}</td>
                  <td>{d.title}</td>
                  <td>{d.number || '—'}</td>
                  <td>{d.amount != null ? `${Number(d.amount).toFixed(2)} BYN` : '—'}</td>
                  <td><span className="cab-chip">{d.status}</span></td>
                  <td>
                    {d.file_path ? (
                      <div className="cab-actions">
                        <button
                          type="button"
                          className="cab-btn ghost"
                          onClick={() => apiOpen(`/api/cabinet/documents/${d.id}/view`).catch((e) => alert(e.message))}
                        >
                          Смотреть
                        </button>
                        <button
                          type="button"
                          className="cab-btn ghost"
                          onClick={() => apiDownload(`/api/cabinet/documents/${d.id}/download`, `${d.number || d.id}.pdf`)}
                        >
                          Скачать
                        </button>
                        <button type="button" className="cab-btn ghost" onClick={() => setEmailTarget(d)}>
                          Email
                        </button>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <div className="cab-empty">Документов пока нет</div>}
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
          alert(`Отправлено на ${result.to}`)
        }}
      />
    </>
  )
}
