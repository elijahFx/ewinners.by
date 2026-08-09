import { useEffect, useState } from 'react'
import { api } from '../api'

export default function NotificationsPage() {
  const [items, setItems] = useState([])

  async function load() {
    const data = await api('/api/cabinet/notifications')
    setItems(data.items)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  return (
    <>
      <div className="cab-page-head">
        <div>
          <h1>Уведомления</h1>
          <p>Счета, пополнения, низкий баланс и корректировки.</p>
        </div>
        <button
          type="button"
          className="cab-btn ghost"
          onClick={async () => {
            await api('/api/cabinet/notifications/read-all', { method: 'POST' })
            await load()
          }}
        >
          Прочитать все
        </button>
      </div>
      <div className="cab-grid">
        {items.map((n) => (
          <div key={n.id} className="cab-card span-2" style={{ opacity: n.is_read ? 0.7 : 1 }}>
            <div className="cab-actions" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ color: '#f7f9ff' }}>{n.title}</strong>
              <span className="cab-muted">{new Date(n.created_at).toLocaleString('ru-RU')}</span>
            </div>
            <p className="cab-muted" style={{ margin: 0, lineHeight: 1.55 }}>{n.body}</p>
          </div>
        ))}
        {!items.length && <div className="cab-card span-4 cab-empty">Уведомлений нет</div>}
      </div>
    </>
  )
}
