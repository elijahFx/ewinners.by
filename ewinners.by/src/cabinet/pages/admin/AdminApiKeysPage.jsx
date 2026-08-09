import { useEffect, useState } from 'react'
import { Copy, KeyRound, RefreshCw } from 'lucide-react'
import { api } from '../../api'

export default function AdminApiKeysPage() {
  const [items, setItems] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [revealed, setRevealed] = useState({})

  async function load() {
    const data = await api('/api/admin/api-keys')
    setItems(data.items)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  async function regenerate(companyId, name) {
    const ok = window.confirm(
      `Перегенерировать API-ключ для «${name}»? Старый ключ перестанет работать.`,
    )
    if (!ok) return
    setBusyId(companyId)
    try {
      const data = await api(`/api/admin/api-keys/${companyId}/regenerate`, { method: 'POST' })
      setItems((prev) =>
        prev.map((row) =>
          row.companyId === companyId
            ? {
                ...row,
                apiKey: data.apiKey,
                createdAt: data.createdAt,
                hasKey: true,
              }
            : row,
        ),
      )
      setRevealed((prev) => ({ ...prev, [companyId]: true }))
    } catch (err) {
      alert(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div>
        <h1 className="m-0 text-[28px] font-bold leading-tight text-white">API-ключи CRM</h1>
        <p className="mt-1 text-sm text-[#9db8d4]">
          Ключи всех компаний. Клиент генерирует свой в разделе «Интеграция CRM».
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a]">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="bg-[#071529] text-xs uppercase tracking-wide text-[#9db8d4]">
            <tr>
              <th className="px-3 py-3 font-bold">ID</th>
              <th className="px-3 py-3 font-bold">Компания</th>
              <th className="px-3 py-3 font-bold">Статус</th>
              <th className="px-3 py-3 font-bold">API-ключ</th>
              <th className="px-3 py-3 font-bold">Создан</th>
              <th className="px-3 py-3 font-bold">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.companyId} className="border-t border-[#2a5f8f]/60 align-middle">
                <td className="px-3 py-3 text-[#9db8d4]">{row.companyId}</td>
                <td className="px-3 py-3">
                  <div className="font-semibold text-white">{row.name}</div>
                  {row.unp ? <div className="text-xs text-[#9db8d4]">УНП {row.unp}</div> : null}
                </td>
                <td className="px-3 py-3 text-[#cfe6ff]">{row.status}</td>
                <td className="px-3 py-3">
                  {row.apiKey ? (
                    <div className="flex max-w-md items-center gap-2">
                      <code
                        style={{
                          display: 'inline-block',
                          maxWidth: 280,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          borderRadius: 8,
                          border: '1px solid rgba(143, 210, 255, 0.28)',
                          background: '#071529',
                          padding: '6px 10px',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#8fd2ff',
                        }}
                      >
                        {revealed[row.companyId]
                          ? row.apiKey
                          : `${row.apiKey.slice(0, 8)}…${row.apiKey.slice(-4)}`}
                      </code>
                      <button
                        type="button"
                        className="cab-btn ghost"
                        style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }}
                        onClick={() =>
                          setRevealed((prev) => ({
                            ...prev,
                            [row.companyId]: !prev[row.companyId],
                          }))
                        }
                      >
                        {revealed[row.companyId] ? 'Скрыть' : 'Показать'}
                      </button>
                      <button
                        type="button"
                        title="Копировать"
                        className="cab-btn ghost"
                        style={{
                          minHeight: 30,
                          width: 34,
                          padding: 0,
                          color: '#8fd2ff',
                        }}
                        onClick={() => navigator.clipboard?.writeText(row.apiKey)}
                      >
                        <Copy size={14} color="#8fd2ff" />
                      </button>
                    </div>
                  ) : (
                    <span style={{ color: '#9db8d4' }}>Нет ключа</span>
                  )}
                </td>
                <td className="px-3 py-3 text-xs text-[#9db8d4]">
                  {row.createdAt ? new Date(row.createdAt).toLocaleString('ru-RU') : '—'}
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    className="cab-btn ghost"
                    style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
                    disabled={busyId === row.companyId}
                    onClick={() => regenerate(row.companyId, row.name)}
                  >
                    <RefreshCw size={13} />
                    {row.hasKey ? 'Перегенерировать' : 'Сгенерировать'}
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-[#9db8d4]">
                  <KeyRound size={18} className="mr-2 inline opacity-60" />
                  Компаний пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
