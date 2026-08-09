import { useEffect, useState } from 'react'
import { api } from '../../api'

export default function AdminPaymentsPage() {
  const [items, setItems] = useState([])
  const [companies, setCompanies] = useState([])
  const [invoices, setInvoices] = useState([])
  const [form, setForm] = useState({
    amount: '',
    payerName: '',
    payerUnp: '',
    purpose: '',
    companyId: '',
    invoiceId: '',
  })

  async function load() {
    const [payments, comps, inv] = await Promise.all([
      api('/api/admin/payments'),
      api('/api/admin/companies'),
      api('/api/admin/invoices'),
    ])
    setItems(payments.items)
    setCompanies(comps.items)
    setInvoices(inv.items)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  async function create(e) {
    e.preventDefault()
    try {
      await api('/api/admin/payments', {
        method: 'POST',
        body: {
          amount: Number(form.amount),
          payerName: form.payerName,
          payerUnp: form.payerUnp,
          purpose: form.purpose,
          companyId: form.companyId ? Number(form.companyId) : null,
          invoiceId: form.invoiceId ? Number(form.invoiceId) : null,
        },
      })
      setForm({ amount: '', payerName: '', payerUnp: '', purpose: '', companyId: '', invoiceId: '' })
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  async function credit(id) {
    try {
      await api(`/api/admin/payments/${id}/credit`, { method: 'POST', body: {} })
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Банковские платежи</h1>
          <p>Ручное внесение поступлений и зачисление на баланс клиента.</p>
        </div>
      </div>

      <div className="cab-grid">
        <div className="cab-card span-4">
          <form className="cab-form grid-2" onSubmit={create}>
            <label>Сумма<input type="number" required step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label>Плательщик<input value={form.payerName} onChange={(e) => setForm({ ...form, payerName: e.target.value })} /></label>
            <label>УНП плательщика<input value={form.payerUnp} onChange={(e) => setForm({ ...form, payerUnp: e.target.value })} /></label>
            <label>Назначение<input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
            <label>
              Компания
              <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
                <option value="">Не указана</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>
              Счёт
              <select value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })}>
                <option value="">Не указан</option>
                {invoices.map((i) => <option key={i.id} value={i.id}>{i.number} — {i.company_name}</option>)}
              </select>
            </label>
            <div style={{ gridColumn: '1 / -1' }}>
              <button className="cab-btn primary" type="submit">Добавить платёж</button>
            </div>
          </form>
        </div>

        <div className="cab-card span-4">
          <div className="cab-table-wrap">
            <table className="cab-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Сумма</th>
                  <th>Плательщик</th>
                  <th>Компания</th>
                  <th>Счёт</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{Number(p.amount).toFixed(2)}</td>
                    <td>{p.payer_name || '—'}</td>
                    <td>{p.company_name || '—'}</td>
                    <td>{p.invoice_number || '—'}</td>
                    <td><span className="cab-chip">{p.status}</span></td>
                    <td>
                      {p.status !== 'credited' && (
                        <button type="button" className="cab-btn primary" onClick={() => credit(p.id)}>
                          Зачислить
                        </button>
                      )}
                    </td>
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
