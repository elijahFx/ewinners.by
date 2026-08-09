import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../cabinet/AuthContext'

const CHALLENGE_KEY = 'ew_2fa_challenge'

export default function TwoFaPage() {
  const { verify2fa, resend2fa, user, loading } = useAuth()
  const navigate = useNavigate()
  const [challengeId, setChallengeId] = useState(() => sessionStorage.getItem(CHALLENGE_KEY) || '')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('Код отправлен в Telegram')
  const [busy, setBusy] = useState(false)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    const id = sessionStorage.getItem(CHALLENGE_KEY)
    if (!id) {
      navigate('/account', { replace: true })
      return
    }
    setChallengeId(id)
    setBooting(false)
  }, [navigate])

  useEffect(() => {
    if (!loading && user) {
      sessionStorage.removeItem(CHALLENGE_KEY)
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

  async function onSubmitCode(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const logged = await verify2fa(challengeId, code)
      sessionStorage.removeItem(CHALLENGE_KEY)
      navigate(
        logged.mustSetupTelegram2fa
          ? '/account/security'
          : logged.role === 'client'
            ? '/cabinet'
            : '/cabinet/admin',
        { replace: true },
      )
    } catch (err) {
      setError(err.message || 'Неверный код')
    } finally {
      setBusy(false)
    }
  }

  async function onResend() {
    setBusy(true)
    setError('')
    try {
      const data = await resend2fa(challengeId)
      setChallengeId(data.challengeId)
      sessionStorage.setItem(CHALLENGE_KEY, data.challengeId)
      setInfo(data.message || 'Код отправлен повторно')
      setCode('')
    } catch (err) {
      setError(err.message || 'Не удалось отправить код')
    } finally {
      setBusy(false)
    }
  }

  if (booting || loading) {
    return <LoadingScreen label="Подготовка подтверждения…" />
  }

  if (busy) {
    return <LoadingScreen label={code ? 'Проверяем код…' : 'Отправляем код…'} />
  }

  return (
    <Layout
      shellClass="home-shell account-shell"
      contactHref="/#contact"
      footerTagline="Двухфакторная защита входа администратора."
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
              Двухфакторная аутентификация
            </div>
            <h1 style={{ color: '#f7f9ff' }}>Код из Telegram</h1>
            <p className="hero-copy" style={{ color: 'rgba(224, 239, 255, 0.74)' }}>
              Откройте бота E-Winners и введите 6-значный код. Код действует 10 минут.
            </p>

            <form
              className="contact-form"
              onSubmit={onSubmitCode}
              style={{ marginTop: 24, position: 'relative', zIndex: 2 }}
            >
              <label>
                Код
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  name="code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    setError('')
                  }}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                />
              </label>
              {info && <p style={{ color: '#8fd2ff', margin: 0 }}>{info}</p>}
              {error && <p style={{ color: '#ffb4b4', margin: 0 }}>{error}</p>}
              <button className="primary-button" type="submit" disabled={code.length < 6}>
                Подтвердить вход
              </button>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="secondary-button" onClick={onResend}>
                  Отправить код ещё раз
                </button>
                <Link
                  className="secondary-button"
                  to="/account"
                  onClick={() => sessionStorage.removeItem(CHALLENGE_KEY)}
                >
                  Назад ко входу
                </Link>
              </div>
            </form>
          </div>
        </div>
      </section>
    </Layout>
  )
}

export { CHALLENGE_KEY }
