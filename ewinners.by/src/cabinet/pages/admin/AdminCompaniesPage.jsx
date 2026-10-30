import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { statusLabel } from '../../statusLabels'
import useLiveBalance from '../../useLiveBalance'
import EditCompanyModal from './EditCompanyModal'

const empty = {
  name: '',
  salesrenderId: '',
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

/** SalesRender ID можно поправить прямо в списке — по нему ищется клиент при списании. */
function SalesRenderIdCell({ company, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(company.salesrender_id || '')

  useEffect(() => {
    if (!editing) setDraft(company.salesrender_id || '')
  }, [company.salesrender_id, editing])

  async function commit() {
    const next = draft.trim()
    setEditing(false)
    if (next === (company.salesrender_id || '')) return
    try {
      await onSave(company, next)
    } catch (err) {
      alert(err.message)
      setDraft(company.salesrender_id || '')
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Нажмите, чтобы изменить ID проекта в SalesRender"
        style={{
          background: company.salesrender_id ? 'rgba(37, 141, 255, 0.18)' : 'transparent',
          border: company.salesrender_id ? '1px solid rgba(143, 210, 255, 0.35)' : '1px dashed #2a5f8f',
          borderRadius: 8,
          color: company.salesrender_id ? '#8fd2ff' : '#9db8d4',
          cursor: 'pointer',
          fontSize: '0.8rem',
          fontWeight: 700,
          padding: '3px 10px',
        }}
      >
        {company.salesrender_id || 'задать'}
      </button>
    )
  }

  return (
    <input
      autoFocus
      value={draft}
      placeholder="например, 87"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setDraft(company.salesrender_id || '')
          setEditing(false)
        }
      }}
      style={{ maxWidth: 160 }}
    />
  )
}

export default function AdminCompaniesPage() {
  const [items, setItems] = useState([])
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [unpStatus, setUnpStatus] = useState('')
  const [ibanStatus, setIbanStatus] = useState('')
  const [lookingUnp, setLookingUnp] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [filters, setFilters] = useState({ q: '', status: '', buyout: '', price: '' })
  const [savingBuyout, setSavingBuyout] = useState(0)
  const [buyoutError, setBuyoutError] = useState('')

  // Поиск и фильтры считаем на клиенте: список клиентов небольшой,
  // так фильтр срабатывает мгновенно и не гоняет лишние запросы.
  const visible = useMemo(() => {
    const needle = filters.q.trim().toLowerCase();
    return items.filter((c) => {
      if (filters.status && c.status !== filters.status) return false;
      if (filters.buyout === 'on' && Number(c.buyout_enabled) !== 1) return false;
      if (filters.buyout === 'off' && Number(c.buyout_enabled) === 1) return false;
      if (filters.price === 'own' && !Number(c.has_own_tariffs)) return false;
      if (filters.price === 'common' && Number(c.has_own_tariffs)) return false;
      if (!needle) return true;
      const haystack = [
        c.name,
        c.unp,
        c.salesrender_id,
        c.iban,
        c.bank_name,
        c.manager_name,
        c.manager_email,
        c.manager_phone,
        c.legal_address,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, filters]);

  async function load() {
    const data = await api('/api/admin/companies')
    setItems(data.items)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  // Балансы клиентов в таблице обновляются без перезагрузки.
  useLiveBalance(() => load().catch(() => {}))

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

  // Переключатель «Отдел выкупа» прямо в списке.
  async function toggleBuyout(company) {
    const next = !Number(company.buyout_enabled)
    setSavingBuyout(company.id)
    setBuyoutError('')
    try {
      const res = await api(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        body: { buyoutEnabled: next },
      })
      // Берём значение из ответа сервера, а не из предположения
      const saved = res?.company ? Number(res.company.buyout_enabled) : next ? 1 : 0
      setItems((prev) =>
        prev.map((c) => (c.id === company.id ? { ...c, buyout_enabled: saved } : c)),
      )
    } catch (err) {
      setBuyoutError(`Не удалось изменить статус: ${err.message}`)
    } finally {
      setSavingBuyout(0)
    }
  }

  // SalesRender ID можно поправить прямо в списке — по нему ищется клиент при списании.
  async function saveSalesRenderId(company, value) {
    const res = await api(`/api/admin/companies/${company.id}`, {
      method: 'PATCH',
      body: { salesrenderId: value },
    })
    setItems((prev) =>
      prev.map((c) =>
        c.id === company.id ? { ...c, salesrender_id: res.company?.salesrender_id ?? null } : c,
      ),
    )
  }

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Клиенты (юрлица)</h1>
          <p>
            Введите УНП — название и адрес подтянутся из реестра. По IBAN определится банк и БИК.
            ID проекта в SalesRender можно изменить прямо в таблице.
          </p>
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
              ID проекта в SalesRender (обязательно)
              <input
                required
                value={form.salesrenderId}
                onChange={(e) => setForm({ ...form, salesrenderId: e.target.value })}
                placeholder="например, 87"
              />
              <small className="cab-muted">
                В SalesRender клиенты заведены как проекты: Проекты → ID. По нему находится клиент при списании — важнее названия.
              </small>
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
          <div
            className="flex flex-wrap items-end gap-3"
            style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid rgba(154,211,255,0.14)' }}
          >
            <label className="cab-muted" style={{ flex: '1 1 260px', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em' }}>
              ПОИСК
              <input
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="Название, УНП, ID проекта, IBAN, менеджер…"
                style={{ marginTop: 6, width: '100%' }}
              />
            </label>
            <label className="cab-muted" style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em' }}>
              СТАТУС
              <select
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                style={{ marginTop: 6, display: 'block', minWidth: 150 }}
              >
                <option value="">Все</option>
                <option value="active">Активные</option>
                <option value="suspended">Приостановленные</option>
                <option value="blocked">Заблокированные</option>
              </select>
            </label>
            <label className="cab-muted" style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em' }}>
              ОТДЕЛ ВЫКУПА
              <select
                value={filters.buyout}
                onChange={(e) => setFilters((f) => ({ ...f, buyout: e.target.value }))}
                style={{ marginTop: 6, display: 'block', minWidth: 130 }}
              >
                <option value="">Все</option>
                <option value="on">Включён</option>
                <option value="off">Выключен</option>
              </select>
            </label>
            <label className="cab-muted" style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em' }}>
              ПРАЙС
              <select
                value={filters.price}
                onChange={(e) => setFilters((f) => ({ ...f, price: e.target.value }))}
                style={{ marginTop: 6, display: 'block', minWidth: 170 }}
              >
                <option value="">Все</option>
                <option value="own">Индивидуальный</option>
                <option value="common">Общий</option>
              </select>
            </label>
            <button
              type="button"
              className="cab-btn ghost"
              style={{ minHeight: 38 }}
              onClick={() => setFilters({ q: '', status: '', buyout: '', price: '' })}
            >
              Сбросить
            </button>
            <span className="cab-muted" style={{ fontSize: '0.78rem', marginLeft: 'auto' }}>
              Показано {visible.length} из {items.length}
            </span>
          </div>

          <div className="cab-table-wrap">
            {buyoutError ? (
              <div className="cab-alert" style={{ marginBottom: 10 }}>{buyoutError}</div>
            ) : null}

            <table className="cab-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Компания</th>
                  <th>ID проекта в SR</th>
                  <th>УНП</th>
                  <th>Баланс</th>
                  <th>Лимит</th>
                  <th>Статус</th>
                  <th>Отдел выкупа</th>
                  <th>Прайс</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setEditingId(c.id)}
                    title="Нажмите, чтобы открыть карточку клиента"
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <SalesRenderIdCell company={c} onSave={saveSalesRenderId} />
                    </td>
                    <td>{c.unp || '—'}</td>
                    <td>{Number(c.balance).toFixed(2)}</td>
                    <td>{Number(c.credit_limit).toFixed(2)}</td>
                    <td>
                      <span className="cab-chip">{statusLabel(c.status)}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        title="Клиенту дополнительно списывается 1,50 BYN за каждый выкупленный заказ. Нажмите, чтобы включить или отключить."
                        disabled={savingBuyout === c.id}
                        onClick={() => toggleBuyout(c)}
                        className={`cab-buyout-toggle${Number(c.buyout_enabled) === 1 ? ' is-on' : ''}`}
                      >
                        <span className="cab-buyout-toggle__dot" />
                        {savingBuyout === c.id
                          ? '…'
                          : Number(c.buyout_enabled) === 1
                            ? 'вкл'
                            : 'выкл'}
                      </button>
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
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="cab-btn ghost"
                        style={{ minHeight: 32, padding: '0 12px', fontSize: '0.78rem' }}
                        onClick={() => setEditingId(c.id)}
                      >
                        Изменить
                      </button>
                    </td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td colSpan={10} className="cab-muted" style={{ textAlign: 'center', padding: '36px 0' }}>
                      {items.length ? 'По заданным условиям клиентов не найдено' : 'Клиентов пока нет'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <EditCompanyModal
        company={items.find((c) => c.id === editingId) || null}
        onClose={() => setEditingId(null)}
        onSaved={(updated) => {
          if (!updated) return
          setItems((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)))
        }}
      />
    </>
  )
}
