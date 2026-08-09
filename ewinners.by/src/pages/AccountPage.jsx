import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../cabinet/AuthContext'
import { CHALLENGE_KEY } from './TwoFaPage'

export default function AccountPage() {
  const { login, user, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && user) {
      navigate(
        user.mustSetupTelegram2fa
          ? '/account/security'
          : user.role === 'client'
            ? '/cabinet'
            : '/cabinet/admin',
        { replace: true },
      )
    }
  }, [user, loading, navigate])

  async function onSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await login(email, password)
      if (result?.requires2fa) {
        sessionStorage.setItem(CHALLENGE_KEY, result.challengeId)
        navigate('/account/2fa', { replace: true })
        return
      }
      navigate(
        result.mustSetupTelegram2fa
          ? '/account/security'
          : result.role === 'client'
            ? '/cabinet'
            : '/cabinet/admin',
        { replace: true },
      )
    } catch (err) {
      setError(err.message || 'Ошибка входа')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <LoadingScreen label="Проверяем сессию…" />
  }

  if (busy) {
    return <LoadingScreen label="Вход…" />
  }

  if (user) {
    return <LoadingScreen label="Переход в кабинет…" />
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

            <form
              className="contact-form"
              onSubmit={onSubmit}
              style={{ marginTop: 24, position: 'relative', zIndex: 2 }}
            >
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  placeholder="you@company.by"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
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
                  autoComplete="current-password"
                />
              </label>
              {error && <p style={{ color: '#ffb4b4', margin: 0 }}>{error}</p>}
              <button className="primary-button" type="submit">
                Войти
              </button>
              <Link
                to="/account/forgot"
                style={{ color: '#8fd2ff', fontWeight: 700, textDecoration: 'none' }}
              >
                Забыли пароль?
              </Link>
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
