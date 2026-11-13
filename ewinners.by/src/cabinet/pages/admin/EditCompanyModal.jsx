import { useEffect, useState } from 'react'
import { api } from '../../api'

const empty = {
  name: '',
  salesrenderId: '',
  extraSalesrenderIds: '',
  unp: '',
  legalAddress: '',
  iban: '',
  bankName: '',
  bic: '',
  creditLimit: 0,
  minBalance: 0,
  notifyThreshold: 500,
  lowBalanceAction: 'allow_credit',
  buyoutEnabled: false,
  status: 'active',
  direction: 'kc',
  managerName: '',
  managerPhone: '',
  managerEmail: '',
}

function toForm(company) {
  return {
    name: company.name || '',
    salesrenderId: company.salesrender_id || '',
    extraSalesrenderIds: company.extra_salesrender_ids || '',
    unp: company.unp || '',
    legalAddress: company.legal_address || '',
    iban: company.iban || '',
    bankName: company.bank_name || '',
    bic: company.bic || '',
    creditLimit: company.credit_limit ?? 0,
    minBalance: company.min_balance ?? 0,
    notifyThreshold: company.notify_threshold ?? 500,
    lowBalanceAction: company.low_balance_action || 'allow_credit',
    buyoutEnabled: Number(company.buyout_enabled) === 1,
    status: company.status || 'active',
    direction: company.direction || 'kc',
    managerName: company.manager_name || '',
    managerPhone: company.manager_phone || '',
    managerEmail: company.manager_email || '',
  }
}

function money(v) {
  return `${Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`
}

const sectionStyle = {
  gridColumn: '1 / -1',
  margin: '4px 0 0',
  color: '#8fd2ff',
  fontSize: '0.72rem',
  fontWeight: 800,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
}

/** Модальное окно редактирования клиента. */
export default function EditCompanyModal({ company, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const companyId = company?.id

  // Форму перезаполняем только при открытии другого клиента: при обновлении
  // баланса (живые события) объект company меняется, и ввод нельзя сбрасывать.
  useEffect(() => {
    if (company) {
      setForm(toForm(company))
      setError('')
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  useEffect(() => {
    if (!company) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [company, onClose])

  if (!company) return null

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        body: {
          name: form.name.trim(),
          unp: form.unp.trim(),
          legalAddress: form.legalAddress.trim(),
          iban: form.iban.trim(),
          bankName: form.bankName.trim(),
          bic: form.bic.trim(),
          creditLimit: Number(form.creditLimit || 0),
          minBalance: Number(form.minBalance || 0),
          notifyThreshold: Number(form.notifyThreshold || 0),
          lowBalanceAction: form.lowBalanceAction,
          buyoutEnabled: form.buyoutEnabled,
          salesrenderId: form.salesrenderId.trim(),
          status: form.status,
          direction: form.direction,
          managerName: form.managerName.trim(),
          managerPhone: form.managerPhone.trim(),
          managerEmail: form.managerEmail.trim(),
        },
      })
      // Дополнительные проекты SalesRender сохраняем отдельно: у клиента
      // баланс один, а проектов может быть несколько.
      await api(`/api/admin/companies/${company.id}/salesrender-projects`, {
        method: 'PUT',
        body: {
          ids: form.extraSalesrenderIds
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        },
      })
      onSaved(res.company || null)
      onClose()
    } catch (err) {
      setError(err.message || 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!company) return
    const ok = window.confirm(
      `Удалить клиента «${company.name}»?\n\nБудут удалены его неоплаченные счета и документы. Это действие необратимо.`,
    )
    if (!ok) return
    setDeleting(true)
    setError('')
    try {
      await api(`/api/admin/companies/${company.id}`, { method: 'DELETE' })
      onDeleted?.(company.id)
      onClose?.()
    } catch (err) {
      setError(err.message || 'Не удалось удалить клиента')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="cab-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cab-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Редактирование клиента ${company.name}`}
        style={{
          width: 'min(780px, 100%)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cab-modal-head">
          <div>
            <h3>{company.name}</h3>
            <span className="cab-muted" style={{ fontSize: '0.78rem' }}>
              Клиент #{company.id} · баланс {money(company.balance)}
            </span>
          </div>
          <button type="button" className="cab-btn ghost" onClick={onClose} style={{ minHeight: 32 }}>
            Закрыть
          </button>
        </div>

        {error && <div className="cab-alert" style={{ marginBottom: 12 }}>{error}</div>}

        <form
          onSubmit={submit}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
        >
          <div
            className="cab-form grid-2"
            style={{ overflowY: 'auto', minHeight: 0, flex: 1, paddingRight: 4 }}
          >
          <div style={sectionStyle}>Реквизиты</div>
          <label style={{ gridColumn: '1 / -1' }}>
            Название
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            УНП
            <input
              inputMode="numeric"
              maxLength={9}
              value={form.unp}
              onChange={(e) => setForm({ ...form, unp: e.target.value.replace(/\D/g, '').slice(0, 9) })}
            />
          </label>
          <label>
            ID проекта в SalesRender
            <input
              value={form.salesrenderId}
              onChange={(e) => setForm({ ...form, salesrenderId: e.target.value })}
              placeholder="например, 87"
            />
            <small className="cab-muted">По нему SalesRender находит клиента при списании.</small>
          </label>
          <label>
            Другие проекты SalesRender
            <input
              value={form.extraSalesrenderIds}
              onChange={(e) => setForm({ ...form, extraSalesrenderIds: e.target.value })}
              placeholder="например, 32, 33"
            />
            <small className="cab-muted">
              Через запятую. Если у клиента несколько проектов — списание идёт с одного баланса.
            </small>
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Адрес
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
            />
          </label>
          <label>
            Банк
            <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
          </label>
          <label>
            БИК
            <input
              value={form.bic}
              onChange={(e) => setForm({ ...form, bic: e.target.value.toUpperCase() })}
            />
          </label>

          <div style={sectionStyle}>Условия работы</div>
          <label>
            Статус
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Активен</option>
              <option value="suspended">Приостановлен</option>
              <option value="blocked">Заблокирован</option>
            </select>
          </label>
          <label>
            Направление
            <select
              value={form.direction}
              onChange={(e) => setForm({ ...form, direction: e.target.value })}
            >
              <option value="hr">HR</option>
              <option value="digital">Digital</option>
              <option value="kc">КЦ</option>
            </select>
            <small className="cab-muted">
              В каком рабочем месте показывать клиента и его счета.
            </small>
          </label>
          <label>
            При нулевом балансе
            <select
              value={form.lowBalanceAction}
              onChange={(e) => setForm({ ...form, lowBalanceAction: e.target.value })}
            >
              <option value="hard_stop">Жёсткая остановка</option>
              <option value="allow_credit">Разрешённый минус</option>
              <option value="allow_debt">Разрешить задолженность</option>
            </select>
          </label>
          <label>
            Кредитный лимит
            <input
              type="number"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            />
          </label>
          <label>
            Порог уведомления
            <input
              type="number"
              value={form.notifyThreshold}
              onChange={(e) => setForm({ ...form, notifyThreshold: e.target.value })}
            />
          </label>
          <label>
            Минимальный баланс
            <input
              type="number"
              value={form.minBalance}
              onChange={(e) => setForm({ ...form, minBalance: e.target.value })}
            />
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

          <div style={sectionStyle}>Менеджер</div>
          <label>
            Менеджер
            <input
              value={form.managerName}
              onChange={(e) => setForm({ ...form, managerName: e.target.value })}
            />
          </label>
          <label>
            Телефон менеджера
            <input
              value={form.managerPhone}
              onChange={(e) => setForm({ ...form, managerPhone: e.target.value })}
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Email менеджера
            <input
              value={form.managerEmail}
              onChange={(e) => setForm({ ...form, managerEmail: e.target.value })}
            />
          </label>

          </div>

          <div
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'flex-end',
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid rgba(154, 211, 255, 0.14)',
            }}
          >
            <button
              type="button"
              className="cab-btn ghost"
              style={{
                marginRight: 'auto',
                color: '#ff9b9b',
                borderColor: 'rgba(255,107,107,0.45)',
              }}
              onClick={remove}
              disabled={busy || deleting}
            >
              {deleting ? 'Удаление…' : 'Удалить'}
            </button>
            <button
              type="button"
              className="cab-btn ghost"
              onClick={onClose}
              disabled={busy || deleting}
            >
              Отмена
            </button>
            <button type="submit" className="cab-btn primary" disabled={busy || deleting}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
