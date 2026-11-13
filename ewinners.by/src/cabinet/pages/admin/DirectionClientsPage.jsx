import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { DIRECTIONS, useDirection } from '../../DirectionContext'
import useLiveBalance from '../../useLiveBalance'
import SearchField from '../../ui/SearchField'

function money(value) {
  return `${Number(value || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} BYN`
}

/**
 * Клиенты только своего направления — для HR-сотрудника.
 *
 * Полный список с балансами, лимитами и редактированием остаётся админу;
 * здесь достаточно карточки клиента, чтобы не смешивать направления.
 */
export default function DirectionClientsPage() {
  const { direction } = useDirection()
  const directionLabel = DIRECTIONS.find((d) => d.code === direction)?.label || 'HR'
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setError('')
      const params = new URLSearchParams({ direction })
      const data = await api(`/api/direction/companies?${params.toString()}`)
      setItems(data.items || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [direction])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  useLiveBalance(() => load())

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return items
    return items.filter((c) =>
      `${c.name} ${c.unp || ''} ${c.iban || ''}`.toLowerCase().includes(needle),
    )
  }, [items, search])

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Клиенты направления {directionLabel}</h1>
          <p>
            Только клиенты выбранного направления. Полное управление клиентами — в кабинете
            администратора.
          </p>
        </div>
      </div>

      <div className="cab-card">
        <div
          className="flex flex-wrap items-center gap-3"
          style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid rgba(154,211,255,0.14)' }}
        >
          <SearchField
            className="basis-[320px] flex-1 min-w-0"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию, УНП или IBAN"
          />
          <span className="cab-muted" style={{ fontSize: '0.78rem' }}>
            Показано {visible.length} из {items.length}
          </span>
        </div>

        {error ? <div className="cab-alert">{error}</div> : null}

        <div className="cab-table-wrap">
          <table className="cab-table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>УНП</th>
                <th>IBAN</th>
                <th>Баланс</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 28 }}>
                    Загрузка…
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 28 }}>
                    Клиентов направления {directionLabel} пока нет
                  </td>
                </tr>
              ) : (
                visible.map((company) => (
                  <tr key={company.id}>
                    <td>{company.name}</td>
                    <td>{company.unp || '—'}</td>
                    <td>{company.iban || '—'}</td>
                    <td>{money(company.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
