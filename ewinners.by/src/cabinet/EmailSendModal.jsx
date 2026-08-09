import { useEffect, useState } from 'react'

export default function EmailSendModal({ open, defaultEmail = '', title = 'Отправить на email', onClose, onSend }) {
  const [email, setEmail] = useState(defaultEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setEmail(defaultEmail || '')
      setError('')
      setBusy(false)
    }
  }, [open, defaultEmail])

  if (!open) return null

  async function submit(e) {
    e.preventDefault()
    const value = String(email || '').trim()
    if (!value) {
      setError('Укажите email')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSend(value)
      onClose()
    } catch (err) {
      setError(err.message || 'Не удалось отправить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cab-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cab-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cab-modal-head">
          <h3>{title}</h3>
          <button type="button" className="cab-btn ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <form className="cab-form" onSubmit={submit}>
          <label>
            Email получателя
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          {error && <div className="cab-alert" style={{ margin: 0 }}>{error}</div>}
          <div className="cab-actions">
            <button type="button" className="cab-btn ghost" onClick={onClose} disabled={busy}>
              Отмена
            </button>
            <button type="submit" className="cab-btn primary" disabled={busy}>
              {busy ? 'Отправка…' : 'Отправить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
