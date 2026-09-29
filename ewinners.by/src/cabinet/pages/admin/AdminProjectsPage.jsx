import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { statusLabel } from '../../statusLabels'

const emptyForm = { companyId: '', name: '', description: '' }

// Базовый прайс товарки — подставляется одной кнопкой, дальше можно поправить.
const TOVARKA_PRESET = {
  sr_order_base: '3.00',
  sr_order_upsell: '5.00',
  sr_order_delivered: '1.50',
}

export default function AdminProjectsPage() {
  const [items, setItems] = useState([])
  const [companies, setCompanies] = useState([])
  const [form, setForm] = useState(emptyForm)

  const [selected, setSelected] = useState(null)
  const [tariffs, setTariffs] = useState([])
  const [draft, setDraft] = useState({})
  const [loadingTariffs, setLoadingTariffs] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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

  async function openTariffs(project) {
    setSelected(project)
    setMessage('')
    setError('')
    setLoadingTariffs(true)
    try {
      const data = await api(`/api/admin/projects/${project.id}/tariffs`)
      const list = data.items || []
      setSelected(data.project || project)
      setTariffs(list)
      const next = {}
      for (const t of list) next[t.service_id] = t.price == null ? '' : String(Number(t.price))
      setDraft(next)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingTariffs(false)
    }
  }

  async function create(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      const res = await api('/api/admin/projects', {
        method: 'POST',
        body: {
          companyId: Number(form.companyId),
          name: form.name,
          description: form.description,
        },
      })
      setForm(emptyForm)
      await load()
      // Сразу открываем прайс нового проекта — по логике «проект + его тарифы».
      await openTariffs(res.project)
    } catch (err) {
      alert(err.message)
    }
  }

  const filledCount = useMemo(
    () => tariffs.filter((t) => String(draft[t.service_id] ?? '').trim() !== '').length,
    [tariffs, draft],
  )

  function applyPreset() {
    const next = { ...draft }
    for (const t of tariffs) {
      const preset = TOVARKA_PRESET[t.code]
      if (preset !== undefined) next[t.service_id] = preset
    }
    setDraft(next)
  }

  async function saveTariffs() {
    if (!selected) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const payload = tariffs.map((t) => ({
        serviceId: t.service_id,
        price: String(draft[t.service_id] ?? '').trim(),
      }))
      const res = await api(`/api/admin/projects/${selected.id}/tariffs`, {
        method: 'PUT',
        body: { items: payload },
      })
      setMessage(
        `Сохранено тарифов: ${res.saved}${res.removed ? `, удалено: ${res.removed}` : ''}`,
      )
      await load()
      await openTariffs(selected)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Проекты</h1>
          <p>
            Подключение проектов к клиентским компаниям. У каждого проекта — свой прайс на услуги,
            списание идёт по нему.
          </p>
        </div>
      </div>

      <div className="cab-grid">
        <div className="cab-card span-2">
          <form className="cab-form" onSubmit={create}>
            <label>
              Компания
              <select
                required
                value={form.companyId}
                onChange={(e) => setForm({ ...form, companyId: e.target.value })}
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
              Название проекта
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Товарка, холодный обзвон…"
              />
            </label>
            <label>
              Описание
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <button className="cab-btn primary" type="submit">
              Создать проект
            </button>
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
                  <th>Тарифы</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.id}
                    style={selected?.id === p.id ? { background: 'rgba(37, 141, 255, 0.12)' } : undefined}
                  >
                    <td>{p.id}</td>
                    <td>{p.name}</td>
                    <td>{p.company_name}</td>
                    <td>
                      <span className="cab-chip">{statusLabel(p.status)}</span>
                    </td>
                    <td>
                      {Number(p.tariffs_count) > 0 ? (
                        <span className="cab-chip">{p.tariffs_count}</span>
                      ) : (
                        <span className="cab-muted">не заданы</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="cab-btn"
                        onClick={() => openTariffs(p)}
                      >
                        Тарифы
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <div className="cab-empty">Проектов пока нет</div>}
          </div>
        </div>

        {selected ? (
          <div className="cab-card span-4">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>
                  Прайс проекта «{selected.name}»
                </h2>
                <p className="cab-muted" style={{ margin: '4px 0 0' }}>
                  {selected.company_name} · задано услуг: {filledCount} из {tariffs.length}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="cab-btn" onClick={applyPreset}>
                  Подставить 3 / 5 / 1,5
                </button>
                <button
                  type="button"
                  className="cab-btn primary"
                  disabled={saving || loadingTariffs}
                  onClick={saveTariffs}
                >
                  {saving ? 'Сохранение…' : 'Сохранить прайс'}
                </button>
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

            <p className="cab-muted" style={{ marginTop: 0 }}>
              Цена в BYN. Пустое поле — услуга в этом проекте не используется, тариф не создаётся.
              Эти цены действуют для всех клиентов проекта; индивидуальный прайс клиента их
              перекрывает.
            </p>

            {loadingTariffs ? (
              <div className="cab-empty">Загрузка…</div>
            ) : (
              <div className="cab-table-wrap">
                <table className="cab-table">
                  <thead>
                    <tr>
                      <th>Услуга</th>
                      <th>Код</th>
                      <th>Ед.</th>
                      <th>Цена, BYN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tariffs.map((t) => (
                      <tr key={t.service_id}>
                        <td>{t.name}</td>
                        <td className="cab-muted">{t.code}</td>
                        <td className="cab-muted">{t.unit}</td>
                        <td style={{ maxWidth: 180 }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="не используется"
                            value={draft[t.service_id] ?? ''}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, [t.service_id]: e.target.value }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}
