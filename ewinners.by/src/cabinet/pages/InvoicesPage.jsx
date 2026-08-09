import { useEffect, useState } from 'react'
import { api, apiDownload, apiOpen } from '../api'
import { useAuth } from '../AuthContext'
import EmailSendModal from '../EmailSendModal'

function money(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`
}

const statusMap = {
  created: 'Создан',
  awaiting_payment: 'Ожидает оплаты',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  overdue: 'Просрочен',
  cancelled: 'Отменён',
  needs_review: 'Требует проверки',
}

export default function InvoicesPage() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [amount, setAmount] = useState('1000')
  const [busy, setBusy] = useState(false)
  const [emailTarget, setEmailTarget] = useState(null)

  async function load() {
    const data = await api('/api/cabinet/invoices')
    setItems(data.items)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  async function createInvoice(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/api/cabinet/invoices', { method: 'POST', body: { amount: Number(amount) } })
      setAmount('1000')
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
          <h1>Счета на оплату</h1>
          <p>После оплаты доступен акт с тем же номером. Документы можно смотреть и отправлять на email.</p>
        </div>
      </div>

      <div className="cab-grid">
        <div className="cab-card span-2">
          <h3 style={{ margin: '0 0 14px', color: '#f7f9ff' }}>Новый счёт</h3>
          <form className="cab-form" onSubmit={createInvoice}>
            <label>
              Сумма пополнения, BYN
              <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
            <button className="cab-btn primary" disabled={busy} type="submit">
              Сформировать PDF
            </button>
          </form>
        </div>

        <div className="cab-card span-4">
          <div className="cab-table-wrap">
            <table className="cab-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Дата</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.number}</td>
                    <td>{new Date(i.created_at).toLocaleString('ru-RU')}</td>
                    <td>{money(i.amount)}</td>
                    <td><span className="cab-chip">{statusMap[i.status] || i.status}</span></td>
                    <td>
                      <div className="cab-actions">
                        <button
                          type="button"
                          className="cab-btn ghost"
                          onClick={() => apiOpen(`/api/cabinet/invoices/${i.id}/view`).catch((e) => alert(e.message))}
                        >
                          Смотреть
                        </button>
                        <button
                          type="button"
                          className="cab-btn ghost"
                          onClick={() => apiDownload(`/api/cabinet/invoices/${i.id}/download`, `${i.number}.pdf`)}
                        >
                          Скачать
                        </button>
                        <button type="button" className="cab-btn ghost" onClick={() => setEmailTarget(i)}>
                          Email
                        </button>
                        {i.status === 'paid' && (
                          <>
                            <button
                              type="button"
                              className="cab-btn primary"
                              onClick={() =>
                                apiOpen(`/api/cabinet/invoices/${i.id}/act?mode=view`).catch((e) => alert(e.message))
                              }
                            >
                              Акт
                            </button>
                            <button
                              type="button"
                              className="cab-btn ghost"
                              onClick={() =>
                                apiDownload(`/api/cabinet/invoices/${i.id}/act`, `act-${i.number}.pdf`)
                              }
                            >
                              Скачать акт
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <div className="cab-empty">Счетов пока нет</div>}
          </div>
        </div>
      </div>

      <EmailSendModal
        open={Boolean(emailTarget)}
        defaultEmail={user?.email || ''}
        title={emailTarget ? `Отправить счёт ${emailTarget.number}` : 'Отправить на email'}
        onClose={() => setEmailTarget(null)}
        onSend={async (email) => {
          const result = await api(`/api/cabinet/invoices/${emailTarget.id}/email`, {
            method: 'POST',
            body: { email },
          })
          alert(`Отправлено на ${result.to}`)
        }}
      />
    </>
  )
}
