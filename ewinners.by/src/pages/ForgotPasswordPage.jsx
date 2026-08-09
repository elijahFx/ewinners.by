import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import LoadingScreen from '../components/LoadingScreen'
import { api } from '../cabinet/api'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const data = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: { email },
      })
      setInfo(data.message || 'Письмо отправлено, если аккаунт существует')
    } catch (err) {
      setError(err.message || 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  if (busy) return <LoadingScreen label="Отправляем письмо…" />

  return (
    <Layout shellClass="home-shell account-shell" contactHref="/#contact" footerTagline="Восстановление доступа.">
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
            <h1 style={{ color: '#f7f9ff' }}>Восстановление пароля</h1>
            <p className="hero-copy" style={{ color: 'rgba(224, 239, 255, 0.74)' }}>
              Укажите email — мы отправим ссылку для создания нового пароля.
            </p>
            <form className="contact-form" onSubmit={onSubmit} style={{ marginTop: 24 }}>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              {info && <p style={{ color: '#8fd2ff', margin: 0 }}>{info}</p>}
              {error && <p style={{ color: '#ffb4b4', margin: 0 }}>{error}</p>}
              <button className="primary-button" type="submit">
                Отправить ссылку
              </button>
              <button type="button" className="secondary-button" onClick={() => navigate('/account')}>
                Назад ко входу
              </button>
            </form>
          </div>
        </div>
      </section>
    </Layout>
  )
}
