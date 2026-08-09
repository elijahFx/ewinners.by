import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import LoadingScreen from '../components/LoadingScreen'
import { api, setToken } from '../cabinet/api'
import { useAuth } from '../cabinet/AuthContext'
import { CHALLENGE_KEY } from './TwoFaPage'

async function applySession(data, refresh) {
  if (data.requires2fa) {
    sessionStorage.setItem(CHALLENGE_KEY, data.challengeId)
    return { requires2fa: true }
  }
  setToken(data.token)
  await refresh()
  return data.user
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [booting, setBooting] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('В ссылке нет токена')
      setBooting(false)
      return
    }
    api(`/api/auth/token-info?type=password_reset&token=${encodeURIComponent(token)}`)
      .then((data) => {
        setEmail(data.email)
      })
      .catch((err) => setError(err.message || 'Ссылка недействительна'))
      .finally(() => setBooting(false))
  }, [token])

  async function onSubmit(e) {
    e.preventDefault()
    if (password !== password2) {
      setError('Пароли не совпадают')
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await api('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      })
      const result = await applySession(data, refresh)
      if (result?.requires2fa) {
        navigate('/account/2fa', { replace: true })
        return
      }
      navigate(result.role === 'client' ? '/cabinet' : '/cabinet/admin', { replace: true })
    } catch (err) {
      setError(err.message || 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  if (booting || busy) {
    return <LoadingScreen label={busy ? 'Сохраняем пароль…' : 'Проверяем ссылку…'} />
  }

  return (
    <Layout shellClass="home-shell account-shell" contactHref="/#contact" footerTagline="Новый пароль.">
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
              Восстановление
            </div>
            <h1 style={{ color: '#f7f9ff' }}>Новый пароль</h1>
            <p className="hero-copy" style={{ color: 'rgba(224, 239, 255, 0.74)' }}>
              {email ? `Аккаунт: ${email}` : 'Задайте новый пароль для входа.'}
            </p>
            {error && !email ? (
              <div style={{ marginTop: 18 }}>
                <p style={{ color: '#ffb4b4' }}>{error}</p>
                <Link className="secondary-button" to="/account/forgot">
                  Запросить новую ссылку
                </Link>
              </div>
            ) : (
              <form className="contact-form" onSubmit={onSubmit} style={{ marginTop: 24 }}>
                <label>
                  Новый пароль
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Повторите пароль
                  <input
                    type="password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                </label>
                {error && <p style={{ color: '#ffb4b4', margin: 0 }}>{error}</p>}
                <button className="primary-button" type="submit">
                  Сохранить и войти
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </Layout>
  )
}
