import { useEffect, useState } from 'react'
import { api } from '../../api'

export default function AdminUsersPage() {
  const [items, setItems] = useState([])
  const [companies, setCompanies] = useState([])
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    phone: '',
    role: 'client',
    companyId: '',
    password: 'ChangeMe123!',
    mustSetPassword: true,
  })
  const [created, setCreated] = useState(null)

  async function load() {
    const [users, comps] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/companies'),
    ])
    setItems(users.items)
    setCompanies(comps.items)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  async function create(e) {
    e.preventDefault()
    try {
      const result = await api('/api/admin/users', {
        method: 'POST',
        body: {
          ...form,
          companyId: form.companyId ? Number(form.companyId) : null,
        },
      })
      setCreated(result)
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  async function toggleStatus(user) {
    const status = user.status === 'blocked' ? 'active' : 'blocked'
    await api(`/api/admin/users/${user.id}/status`, { method: 'PATCH', body: { status } })
    await load()
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Пользователи</h1>
          <p>Выдача доступов клиентам и внутренним ролям.</p>
        </div>
      </div>

      {created && (
        <div className="cab-alert">
          Пользователь создан: {created.email}. Временный пароль: <strong>{created.temporaryPassword}</strong>
        </div>
      )}

      <div className="cab-grid">
        <div className="cab-card span-4">
          <form className="cab-form grid-2" onSubmit={create}>
            <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>ФИО<input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
            <label>Телефон<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label>
              Роль
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="client">client</option>
                <option value="manager">manager</option>
                <option value="accountant">accountant</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label>
              Компания
              <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
                <option value="">Без компании</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label>Временный пароль<input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            <div style={{ gridColumn: '1 / -1' }}>
              <button className="cab-btn primary" type="submit">Создать пользователя</button>
            </div>
          </form>
        </div>

        <div className="cab-card span-4">
          <div className="cab-table-wrap">
            <table className="cab-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>ФИО</th>
                  <th>Email</th>
                  <th>Роль</th>
                  <th>Компания</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.full_name}</td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>{u.company_name || '—'}</td>
                    <td><span className="cab-chip">{u.status}</span></td>
                    <td>
                      <button type="button" className="cab-btn ghost" onClick={() => toggleStatus(u)}>
                        {u.status === 'blocked' ? 'Разблокировать' : 'Блокировать'}
                      </button>
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
