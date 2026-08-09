import { useEffect, useState } from 'react'
import { api } from '../api'

export default function CompanyPage() {
  const [form, setForm] = useState({
    name: '',
    unp: '',
    legalAddress: '',
    bankName: '',
    iban: '',
    bic: '',
  })
  const [busy, setBusy] = useState(false)
  const [ibanStatus, setIbanStatus] = useState('')

  useEffect(() => {
    api('/api/cabinet/company')
      .then((d) => {
        const c = d.company || {}
        setForm({
          name: c.name || '',
          unp: c.unp || '',
          legalAddress: c.legal_address || '',
          bankName: c.bank_name || '',
          iban: c.iban || '',
          bic: c.bic || '',
        })
      })
      .catch((e) => alert(e.message))
  }, [])

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

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/api/cabinet/company', {
        method: 'PUT',
        body: {
          legalAddress: form.legalAddress,
          bankName: form.bankName,
          iban: form.iban,
          bic: form.bic,
        },
      })
      alert('Реквизиты сохранены')
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
          <h1>Реквизиты компании</h1>
          <p>При вводе IBAN банк и БИК подставятся автоматически. Название и УНП меняет администратор.</p>
        </div>
      </div>
      <div className="cab-card" style={{ maxWidth: 720 }}>
        <form className="cab-form grid-2" onSubmit={save}>
          <label>
            Компания
            <input value={form.name} disabled />
          </label>
          <label>
            УНП
            <input value={form.unp} disabled />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Юридический адрес
            <input
              value={form.legalAddress}
              onChange={(e) => setForm({ ...form, legalAddress: e.target.value })}
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
            <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
          </label>
          <label>
            БИК
            <input value={form.bic} onChange={(e) => setForm({ ...form, bic: e.target.value.toUpperCase() })} />
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="cab-btn primary" disabled={busy} type="submit">
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
