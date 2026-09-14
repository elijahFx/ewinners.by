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
  const { user, company } = useAuth()
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [emailTarget, setEmailTarget] = useState(null)

  async function load() {
    const d = await api('/api/cabinet/documents')
    setItems(d.items || [])
  }

  useEffect(() => {
    setError('')
    load().catch((e) => setError(e.message))
  }, [company?.id])

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
        body: { companyId: company?.id || user?.companyId },
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

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Документы</h1>
          <p>Счета, акты, детализация услуг. Просмотр на сайте, скачивание и отправка на email.</p>
        </div>
        <button type="button" className="cab-btn primary" disabled={busy} onClick={generateDetail}>
          {busy ? 'Формирование…' : 'Сформировать детализацию'}
        </button>
      </div>

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
                  <td><span className="cab-chip">{d.status}</span></td>
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
          setMessage(`Отправлено на ${result.to}`)
        }}
      />
    </>
  )
}
