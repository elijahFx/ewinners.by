import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { statusLabel } from '../../statusLabels'

const emptyForm = {
  amount: '',
  payerName: '',
  payerUnp: '',
  purpose: '',
  companyId: '',
  invoiceId: '',
}

export default function AdminPaymentsPage() {
  const [items, setItems] = useState([])
  const [companies, setCompanies] = useState([])
  const [invoices, setInvoices] = useState([])
  const [form, setForm] = useState(emptyForm)

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

  const companyById = useMemo(() => {
    const map = new Map()
    for (const c of companies) map.set(Number(c.id), c)
    return map
  }, [companies])

  const filteredInvoices = useMemo(() => {
    if (!form.companyId) return invoices
    return invoices.filter((i) => String(i.company_id) === String(form.companyId))
  }, [invoices, form.companyId])

  function fillFromCompany(companyId, prev = form, extras = {}) {
    const company = companyById.get(Number(companyId))
    if (!company) {
      return { ...prev, companyId, ...extras }
    }
    return {
      ...prev,
      ...extras,
      companyId: String(company.id),
      payerName: company.name || prev.payerName,
      payerUnp: company.unp || prev.payerUnp,
    }
  }

  function onCompanyChange(companyId) {
    setForm((prev) => {
      const next = fillFromCompany(companyId, prev, { companyId })
      // If current invoice belongs to another company — clear it
      if (next.invoiceId) {
        const inv = invoices.find((i) => String(i.id) === String(next.invoiceId))
        if (inv && String(inv.company_id) !== String(companyId)) {
          next.invoiceId = ''
        }
      }
      return next
    })
  }

  function onInvoiceChange(invoiceId) {
    if (!invoiceId) {
      setForm((prev) => ({ ...prev, invoiceId: '' }))
      return
    }
    const inv = invoices.find((i) => String(i.id) === String(invoiceId))
    if (!inv) {
      setForm((prev) => ({ ...prev, invoiceId }))
      return
    }

    setForm((prev) => {
      const company = companyById.get(Number(inv.company_id))
      return {
        ...prev,
        invoiceId: String(inv.id),
        companyId: String(inv.company_id),
        amount: prev.amount || String(inv.amount ?? ''),
        purpose: prev.purpose || `Оплата по счёту ${inv.number}`,
        payerName: company?.name || inv.company_name || prev.payerName,
        payerUnp: company?.unp || inv.company_unp || prev.payerUnp,
      }
    })
  }

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
      setForm(emptyForm)
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
          <p>Выберите счёт или организацию — плательщик и УНП подставятся сами.</p>
        </div>
      </div>

      <div className="cab-grid">
        <div className="cab-card span-4">
          <form className="cab-form grid-2" onSubmit={create}>
            <label>
              Компания
              <select value={form.companyId} onChange={(e) => onCompanyChange(e.target.value)}>
                <option value="">Не указана</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.unp ? ` · УНП ${c.unp}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Счёт
              <select value={form.invoiceId} onChange={(e) => onInvoiceChange(e.target.value)}>
                <option value="">Не указан</option>
                {filteredInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} — {i.company_name} — {Number(i.amount).toFixed(2)} BYN
                  </option>
                ))}
              </select>
            </label>
            <label>
              Сумма
              <input
                type="number"
                required
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <label>
              Назначение
              <input
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              />
            </label>
            <label>
              Плательщик
              <input
                value={form.payerName}
                onChange={(e) => setForm({ ...form, payerName: e.target.value })}
              />
            </label>
            <label>
              УНП плательщика
              <input
                value={form.payerUnp}
                onChange={(e) => setForm({ ...form, payerUnp: e.target.value })}
              />
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
                  <th>УНП</th>
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
                    <td>{p.payer_unp || '—'}</td>
                    <td>{p.company_name || '—'}</td>
                    <td>{p.invoice_number || '—'}</td>
                    <td><span className="cab-chip">{statusLabel(p.status)}</span></td>
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
