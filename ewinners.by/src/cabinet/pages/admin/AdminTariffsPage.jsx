import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { statusLabel } from '../../statusLabels'

const emptyForm = {
  companyId: '',
  projectId: '',
  serviceId: '',
  price: '',
  billingType: 'unit',
  validFrom: new Date().toISOString().slice(0, 10),
  validTo: '',
}

export default function AdminTariffsPage() {
  const [items, setItems] = useState([])
  const [companies, setCompanies] = useState([])
  const [services, setServices] = useState([])
  const [projects, setProjects] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const companyProjects = useMemo(
    () => projects.filter((p) => String(p.company_id) === String(form.companyId)),
    [projects, form.companyId],
  )

  async function load() {
    const [tariffs, comps, svcs, projs] = await Promise.all([
      api('/api/admin/tariffs'),
      api('/api/admin/companies'),
      api('/api/admin/services'),
      api('/api/admin/projects'),
    ])
    setItems(tariffs.items || [])
    setCompanies(comps.items || [])
    setServices(svcs.items || [])
    setProjects(projs.items || [])
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    if (!form.companyId) {
      setError('Выберите клиента (организацию) для индивидуального тарифа')
      return
    }
    if (!form.serviceId || !(Number(form.price) > 0)) {
      setError('Укажите услугу и цену')
      return
    }
    setBusy(true)
    try {
      await api('/api/admin/tariffs', {
        method: 'POST',
        body: {
          companyId: Number(form.companyId),
          projectId: form.projectId ? Number(form.projectId) : null,
          serviceId: Number(form.serviceId),
          price: Number(form.price),
          billingType: form.billingType,
          validFrom: form.validFrom,
          validTo: form.validTo || null,
        },
      })
      setForm({ ...emptyForm, validFrom: new Date().toISOString().slice(0, 10) })
      setMessage('Индивидуальный тариф создан и назначен клиенту')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Тарифы</h1>
          <p>Создайте индивидуальный тариф и назначьте его организации клиента.</p>
        </div>
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

      <form className="cab-card cab-form grid-2" onSubmit={onSubmit} style={{ marginBottom: 14 }}>
        <label>
          Клиент (организация)
          <select
            className="cab-select"
            required
            value={form.companyId}
            onChange={(e) => setForm({ ...form, companyId: e.target.value, projectId: '' })}
          >
            <option value="">Выберите</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Услуга
          <select
            className="cab-select"
            required
            value={form.serviceId}
            onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
          >
            <option value="">Выберите</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.unit})
              </option>
            ))}
          </select>
        </label>

        <label>
          Проект (необязательно)
          <select
            className="cab-select"
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            disabled={!form.companyId}
          >
            <option value="">Все проекты клиента</option>
            {companyProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Тип тарификации
          <select
            className="cab-select"
            value={form.billingType}
            onChange={(e) => setForm({ ...form, billingType: e.target.value })}
          >
            <option value="unit">За единицу</option>
            <option value="minute">За минуту</option>
            <option value="fixed">Фикс</option>
            <option value="subscription">Подписка</option>
          </select>
        </label>

        <label>
          Цена, BYN
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        </label>

        <label>
          Действует с
          <input
            required
            type="date"
            className="cab-select"
            value={form.validFrom}
            onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
          />
        </label>

        <label>
          Действует по (необязательно)
          <input
            type="date"
            className="cab-select"
            value={form.validTo}
            min={form.validFrom || undefined}
            onChange={(e) => setForm({ ...form, validTo: e.target.value })}
          />
        </label>

        <div className="span-2" style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="cab-btn primary" disabled={busy}>
            {busy ? 'Сохранение…' : 'Создать индивидуальный тариф'}
          </button>
        </div>
      </form>

      <div className="cab-card">
        <div className="cab-table-wrap">
          <table className="cab-table">
            <thead>
              <tr>
                <th>Услуга</th>
                <th>Клиент</th>
                <th>Проект</th>
                <th>Тип</th>
                <th>Цена</th>
                <th>С</th>
                <th>По</th>
                <th>Область</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>{t.service_name}</td>
                  <td>{t.company_name || '—'}</td>
                  <td>{t.project_name || 'Все'}</td>
                  <td>{statusLabel(t.billing_type)}</td>
                  <td>{Number(t.price).toFixed(2)} BYN</td>
                  <td>{t.valid_from}</td>
                  <td>{t.valid_to || '—'}</td>
                  <td>
                    <span className="cab-chip">{t.company_id ? 'Индивидуальный' : 'Базовый'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <div className="cab-empty">Тарифов пока нет</div>}
        </div>
      </div>
    </>
  )
}
