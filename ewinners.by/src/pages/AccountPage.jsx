import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../cabinet/AuthContext'

export default function AccountPage() {
  const { login, user, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && user) {
      navigate(user.role === 'client' ? '/cabinet' : '/cabinet/admin', { replace: true })
    }
  }, [user, loading, navigate])

  async function onSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const logged = await login(email, password)
      navigate(logged.role === 'client' ? '/cabinet' : '/cabinet/admin', { replace: true })
    } catch (err) {
      setError(err.message || 'Ошибка входа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout
      shellClass="home-shell account-shell"
      contactHref="/#contact"
      footerTagline="Внешние команды для продаж, найма и продвижения бизнеса."
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
              Личный кабинет
            </div>
            <h1 style={{ color: '#f7f9ff' }}>Вход для партнеров E-Winners</h1>
            <p className="hero-copy" style={{ color: 'rgba(224, 239, 255, 0.74)' }}>
              Войдите, чтобы видеть баланс, формировать счета и контролировать списания по проекту.
            </p>

            <form className="contact-form" onSubmit={onSubmit} style={{ marginTop: 24, position: 'relative', zIndex: 2 }}>
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  placeholder="you@company.by"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                Пароль
                <input
                  type="password"
                  name="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {error && <p style={{ color: '#ffb4b4', margin: 0 }}>{error}</p>}
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Вход…' : 'Войти'}
              </button>
            </form>

            <div className="hero-actions" style={{ marginTop: 18 }}>
              <Link className="secondary-button" to="/#contact">
                Оставить заявку
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  )
}
