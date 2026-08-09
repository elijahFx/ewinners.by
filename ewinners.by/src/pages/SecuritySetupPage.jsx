import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import LoadingScreen from '../components/LoadingScreen'
import { api } from '../cabinet/api'
import { useAuth } from '../cabinet/AuthContext'

const BOT = 'https://t.me/ewinnersnotifierbot'

export default function SecuritySetupPage() {
  const { user, loading, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const [chatId, setChatId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && !user) {
      navigate('/account', { replace: true })
    }
  }, [user, loading, navigate])

  useEffect(() => {
    if (user?.telegramChatId) setChatId(user.telegramChatId)
  }, [user])

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    setError('')
    try {
      await api('/api/auth/notification-prefs', {
        method: 'PATCH',
        body: {
          notifyEmail: user?.notifyEmail !== false,
          notifyTelegram: true,
          telegramChatId: chatId.trim(),
        },
      })
      const data = await refresh()
      setMsg('Telegram привязан. При следующем входе потребуется код из бота.')
      setTimeout(() => {
        navigate(
          data?.user?.role === 'client' ? '/cabinet' : '/cabinet/admin',
          { replace: true },
        )
      }, 800)
    } catch (err) {
      setError(err.message || 'Ошибка сохранения')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !user) {
    return <LoadingScreen label="Загрузка…" />
  }

  if (busy) {
    return <LoadingScreen label="Сохраняем настройки…" />
  }

  return (
    <Layout
      shellClass="home-shell account-shell"
      contactHref="/#contact"
      footerTagline="Настройка двухфакторной защиты администратора."
    >
      <section className="hero-section" style={{ marginBottom: 80 }}>
        <div className="hero-grid" style={{ gridTemplateColumns: '1fr', maxWidth: 560, margin: '0 auto' }}>
          <div
            className="hero-main"
            style={{
              background: 'rgba(4, 25, 55, 0.82)',
              borderColor: 'rgba(154, 211, 255, 0.2)',
              color: '#f2f8ff',
            }}
          >
            <div className="eyebrow" style={{ color: '#8fd2ff' }}>
              Безопасность
            </div>
            <h1 style={{ color: '#f7f9ff' }}>Привязка Telegram</h1>
            <p className="hero-copy" style={{ color: 'rgba(224, 239, 255, 0.74)' }}>
              Напишите боту <code>/start</code> — он пришлёт ваш Chat ID. Вставьте его ниже.
            </p>

            <form
              className="contact-form"
              onSubmit={save}
              style={{ marginTop: 24, position: 'relative', zIndex: 2 }}
            >
              <p style={{ margin: 0, lineHeight: 1.5, color: 'rgba(224, 239, 255, 0.8)' }}>
                1. Откройте{' '}
                <a href={BOT} target="_blank" rel="noreferrer" style={{ color: '#8fd2ff', fontWeight: 800 }}>
                  @ewinnersnotifierbot
                </a>
                <br />
                2. Отправьте <code>/start</code>
                <br />
                3. Скопируйте Chat ID сюда
              </p>
              <label>
                Telegram Chat ID
                <input
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="Например 123456789"
                  required
                />
              </label>
              {msg && <p style={{ color: '#8fd2ff', margin: 0 }}>{msg}</p>}
              {error && <p style={{ color: '#ffb4b4', margin: 0 }}>{error}</p>}
              <button className="primary-button" type="submit" disabled={!chatId.trim()}>
                Сохранить и продолжить
              </button>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    logout()
                    navigate('/account', { replace: true })
                  }}
                >
                  Выйти
                </button>
                {!user.mustSetupTelegram2fa ? (
                  <Link className="secondary-button" to="/cabinet/admin">
                    В кабинет
                  </Link>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      </section>
    </Layout>
  )
}
