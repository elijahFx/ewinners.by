import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import LoadingScreen from '../components/LoadingScreen'
import { api, setToken } from '../cabinet/api'
import { useAuth } from '../cabinet/AuthContext'
import { CHALLENGE_KEY } from './TwoFaPage'

export default function InviteAcceptPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [booting, setBooting] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('В ссылке нет токена приглашения')
      setBooting(false)
      return
    }
    api(`/api/auth/token-info?type=invite&token=${encodeURIComponent(token)}`)
      .then((data) => {
        setEmail(data.email)
        setFullName(data.fullName || '')
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
      const data = await api('/api/auth/accept-invite', {
        method: 'POST',
        body: { token, password },
      })
      if (data.requires2fa) {
        sessionStorage.setItem(CHALLENGE_KEY, data.challengeId)
        navigate('/account/2fa', { replace: true })
        return
      }
      setToken(data.token)
      const me = await refresh()
      const user = me?.user || data.user
      navigate(
        user?.mustSetupTelegram2fa
          ? '/account/security'
          : user?.role === 'client'
            ? '/cabinet'
            : '/cabinet/admin',
        { replace: true },
      )
    } catch (err) {
      setError(err.message || 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  if (booting || busy) {
    return <LoadingScreen label={busy ? 'Активируем кабинет…' : 'Проверяем приглашение…'} />
  }

  return (
    <Layout
      shellClass="home-shell account-shell"
      contactHref="/#contact"
      footerTagline="Приглашение в личный кабинет E-Winners."
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
              Приглашение
            </div>
            <h1 style={{ color: '#f7f9ff' }}>Задайте пароль</h1>
            <p className="hero-copy" style={{ color: 'rgba(224, 239, 255, 0.74)' }}>
              {fullName || email
                ? `${fullName ? `${fullName}, ` : ''}аккаунт ${email}`
                : 'Создайте пароль для входа в кабинет.'}
            </p>
            {error && !email ? (
              <div style={{ marginTop: 18 }}>
                <p style={{ color: '#ffb4b4' }}>{error}</p>
                <Link className="secondary-button" to="/account">
                  Ко входу
                </Link>
              </div>
            ) : (
              <form className="contact-form" onSubmit={onSubmit} style={{ marginTop: 24 }}>
                <label>
                  Пароль
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
                  Активировать кабинет
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </Layout>
  )
}
