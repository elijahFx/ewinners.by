import { useEffect, useState } from 'react'
import { api } from '../../api'
import useLiveBalance from '../../useLiveBalance'

export default function AdminBalancePage() {
  const [companies, setCompanies] = useState([])
  const [form, setForm] = useState({
    companyId: '',
    type: 'credit',
    amount: '',
    comment: '',
  })

  async function load() {
    try {
      const d = await api('/api/admin/companies')
      setCompanies(d.items)
    } catch (e) {
      alert(e.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Балансы в списке обновляются без перезагрузки.
  useLiveBalance(load)

  async function submit(e) {
    e.preventDefault()
    try {
      await api('/api/admin/balance/adjust', {
        method: 'POST',
        body: {
          companyId: Number(form.companyId),
          type: form.type,
          amount: Number(form.amount),
          comment: form.comment,
        },
      })
      alert('Корректировка выполнена')
      setForm({ companyId: '', type: 'credit', amount: '', comment: '' })
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Корректировка баланса</h1>
          <p>Ручные зачисления и списания только с указанием причины.</p>
        </div>
      </div>
      <div className="cab-card" style={{ maxWidth: 640 }}>
        <form className="cab-form" onSubmit={submit}>
          <label>
            Компания
            <select required value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">Выберите</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({Number(c.balance).toFixed(2)} BYN)
                </option>
              ))}
            </select>
          </label>
          <label>
            Тип
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="credit">Зачисление</option>
              <option value="debit">Списание</option>
            </select>
          </label>
          <label>
            Сумма
            <input type="number" required min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label>
            Причина (обязательно)
            <textarea required value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
          </label>
          <button className="cab-btn primary" type="submit">Провести корректировку</button>
        </form>
      </div>
    </>
  )
}
