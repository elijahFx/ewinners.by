import { useEffect, useState } from 'react'
import { api } from '../../api'

export default function AdminProjectsPage() {
  const [items, setItems] = useState([])
  const [companies, setCompanies] = useState([])
  const [form, setForm] = useState({ companyId: '', name: '', description: '' })

  async function load() {
    const [projects, comps] = await Promise.all([
      api('/api/admin/projects'),
      api('/api/admin/companies'),
    ])
    setItems(projects.items)
    setCompanies(comps.items)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  async function create(e) {
    e.preventDefault()
    try {
      await api('/api/admin/projects', {
        method: 'POST',
        body: {
          companyId: Number(form.companyId),
          name: form.name,
          description: form.description,
        },
      })
      setForm({ companyId: '', name: '', description: '' })
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Проекты</h1>
          <p>Подключение проектов к клиентским компаниям.</p>
        </div>
      </div>
      <div className="cab-grid">
        <div className="cab-card span-2">
          <form className="cab-form" onSubmit={create}>
            <label>
              Компания
              <select required value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
                <option value="">Выберите</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Название проекта<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Описание<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <button className="cab-btn primary" type="submit">Создать проект</button>
          </form>
        </div>
        <div className="cab-card span-4">
          <div className="cab-table-wrap">
            <table className="cab-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Проект</th>
                  <th>Клиент</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{p.name}</td>
                    <td>{p.company_name}</td>
                    <td><span className="cab-chip">{p.status}</span></td>
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
