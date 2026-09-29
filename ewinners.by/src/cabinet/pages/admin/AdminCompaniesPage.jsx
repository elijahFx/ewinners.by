import { useEffect, useState } from 'react'
import { api } from '../../api'
import { statusLabel } from '../../statusLabels'

const empty = {
  name: '',
  unp: '',
  legalAddress: '',
  bankName: '',
  iban: '',
  bic: '',
  creditLimit: '0',
  notifyThreshold: '500',
  lowBalanceAction: 'allow_credit',
  managerName: '',
  managerPhone: '',
  managerEmail: '',
  buyoutEnabled: false,
}

export default function AdminCompaniesPage() {
  const [items, setItems] = useState([])
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [unpStatus, setUnpStatus] = useState('')
  const [ibanStatus, setIbanStatus] = useState('')
  const [lookingUnp, setLookingUnp] = useState(false)

  async function load() {
    const data = await api('/api/admin/companies')
    setItems(data.items)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  useEffect(() => {
    const unp = String(form.unp || '').replace(/\D/g, '')
    if (unp.length !== 9) {
      setUnpStatus(unp.length ? 'УНП: 9 цифр' : '')
      return
    }

    const t = setTimeout(async () => {
      setLookingUnp(true)
      setUnpStatus('Поиск в реестре…')
      try {
        const data = await api(`/api/lookup/unp/${unp}`)
        setForm((prev) => ({
          ...prev,
          unp: data.unp,
          name: data.name || prev.name,
          legalAddress: data.address || prev.legalAddress,
        }))
        setUnpStatus(
          data.status
            ? `Найдено: ${data.shortName || data.name} (${data.status})`
            : `Найдено: ${data.shortName || data.name}`,
        )
      } catch (err) {
        setUnpStatus(err.message || 'Не найдено')
      } finally {
        setLookingUnp(false)
      }
    }, 450)

    return () => clearTimeout(t)
  }, [form.unp])

  useEffect(() => {
    const iban = String(form.iban || '').replace(/\s+/g, '')
    if (iban.replace(/[^A-Za-z0-9]/g, '').length < 8) {
      setIbanStatus('')
      return
    }

    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/lookup/iban?iban=${encodeURIComponent(iban)}`)
        if (data.bankName || data.bic) {
          setForm((prev) => ({
            ...prev,
            bankName: data.bankName || prev.bankName,
            bic: data.bic || prev.bic,
            iban: data.iban || prev.iban,
          }))
        }
        setIbanStatus(
          data.bankName
            ? `${data.bankName} · ${data.bic}`
            : data.message || (data.bic ? `БИК: ${data.bic}` : ''),
        )
      } catch (err) {
        setIbanStatus(err.message || 'Не удалось определить банк')
      }
    }, 350)

    return () => clearTimeout(t)
  }, [form.iban])

  async function create(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      alert('Укажите УНП, чтобы подтянуть наименование, или введите название вручную')
      return
    }
    setBusy(true)
    try {
      await api('/api/admin/companies', {
        method: 'POST',
        body: {
          ...form,
          creditLimit: Number(form.creditLimit),
          notifyThreshold: Number(form.notifyThreshold),
        },
      })
      setForm(empty)
      setUnpStatus('')
      setIbanStatus('')
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Галочка «Отдел выкупа» переключается прямо в списке.
  async function toggleBuyout(company) {
    const next = !Number(company.buyout_enabled)
    try {
      await api(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        body: { buyoutEnabled: next },
      })
      setItems((prev) =>
        prev.map((c) => (c.id === company.id ? { ...c, buyout_enabled: next ? 1 : 0 } : c)),
      )
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Клиенты (юрлица)</h1>
          <p>Введите УНП — название и адрес подтянутся из реестра. По IBAN определится банк и БИК.</p>
        </div>
      </div>

      <div className="cab-grid">
        <div className="cab-card span-4">
          <form className="cab-form grid-2" onSubmit={create}>
            <label>
              УНП
              <input
                inputMode="numeric"
                maxLength={9}
                placeholder="9 цифр"
                value={form.unp}
                onChange={(e) => setForm({ ...form, unp: e.target.value.replace(/\D/g, '').slice(0, 9) })}
              />
              {unpStatus && <small className="cab-muted">{lookingUnp ? 'Поиск…' : unpStatus}</small>}
            </label>
            <label>
              Название
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Заполнится по УНП"
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Адрес
              <input
                value={form.legalAddress}
                onChange={(e) => setForm({ ...form, legalAddress: e.target.value })}
                placeholder="Заполнится по УНП"
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Расчётный счёт (IBAN)
              <input
                value={form.iban}
                onChange={(e) => setForm({ ...form, iban: e.target.value.toUpperCase() })}
                placeholder="BY00...."
              />
              {ibanStatus && <small className="cab-muted">{ibanStatus}</small>}
            </label>
            <label>
              Банк
              <input
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                placeholder="Определится по счёту"
              />
            </label>
            <label>
              БИК
              <input
                value={form.bic}
                onChange={(e) => setForm({ ...form, bic: e.target.value.toUpperCase() })}
                placeholder="Определится по счёту"
              />
            </label>
            <label>
              Кредитный лимит
              <input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} />
            </label>
            <label>
              Порог уведомления
              <input type="number" value={form.notifyThreshold} onChange={(e) => setForm({ ...form, notifyThreshold: e.target.value })} />
            </label>
            <label>
              При нулевом балансе
              <select value={form.lowBalanceAction} onChange={(e) => setForm({ ...form, lowBalanceAction: e.target.value })}>
                <option value="hard_stop">Жёсткая остановка</option>
                <option value="allow_credit">Разрешённый минус</option>
                <option value="allow_debt">Разрешить задолженность</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={Boolean(form.buyoutEnabled)}
                onChange={(e) => setForm({ ...form, buyoutEnabled: e.target.checked })}
              />
              Отдел выкупа (+1,50 BYN за выкупленный заказ)
            </label>
            <label>
              Менеджер
              <input value={form.managerName} onChange={(e) => setForm({ ...form, managerName: e.target.value })} />
            </label>
            <label>
              Телефон менеджера
              <input value={form.managerPhone} onChange={(e) => setForm({ ...form, managerPhone: e.target.value })} />
            </label>
            <label>
              Email менеджера
              <input value={form.managerEmail} onChange={(e) => setForm({ ...form, managerEmail: e.target.value })} />
            </label>
            <div style={{ gridColumn: '1 / -1' }}>
              <button className="cab-btn primary" disabled={busy || lookingUnp} type="submit">
                Создать клиента
              </button>
            </div>
          </form>
        </div>

        <div className="cab-card span-4">
          <div className="cab-table-wrap">
            <table className="cab-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Компания</th>
                  <th>УНП</th>
                  <th>Баланс</th>
                  <th>Лимит</th>
                  <th>Статус</th>
                  <th>Отдел выкупа</th>
                  <th>Прайс</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    <td>{c.unp || '—'}</td>
                    <td>{Number(c.balance).toFixed(2)}</td>
                    <td>{Number(c.credit_limit).toFixed(2)}</td>
                    <td>
                      <span className="cab-chip">{statusLabel(c.status)}</span>
                    </td>
                    <td>
                      <label
                        title="Клиенту дополнительно списывается 1,50 BYN за каждый выкупленный заказ"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={Number(c.buyout_enabled) === 1}
                          onChange={() => toggleBuyout(c)}
                        />
                        <span className="cab-muted">{Number(c.buyout_enabled) === 1 ? 'вкл' : 'выкл'}</span>
                      </label>
                    </td>
                    <td>
                      {Number(c.has_own_tariffs) ? (
                        <span
                          className="cab-chip"
                          title="У клиента задан индивидуальный прайс: общие и проектные цены для него не применяются"
                        >
                          Индивидуальный
                        </span>
                      ) : (
                        <span className="cab-muted">Общий</span>
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
