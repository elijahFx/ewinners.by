import { useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'

export default function AccountPage() {
  const [status, setStatus] = useState('idle')

  function onSubmit(event) {
    event.preventDefault()
    setStatus('sent')
  }

  return (
    <Layout
      shellClass="home-shell account-shell"
      contactHref="/#contact"
      footerTagline="Внешние команды для продаж, найма и продвижения бизнеса."
    >
      <section className="hero-section" style={{ marginBottom: 80 }}>
        <div className="hero-grid" style={{ gridTemplateColumns: '1fr', maxWidth: 560, margin: '0 auto' }}>
          <div className="hero-main" style={{ background: 'rgba(4, 25, 55, 0.82)', borderColor: 'rgba(154, 211, 255, 0.2)', color: '#f2f8ff' }}>
            <div className="eyebrow" style={{ color: '#8fd2ff' }}>Личный кабинет</div>
            <h1 style={{ color: '#f7f9ff' }}>Вход для партнеров E-Winners</h1>
            <p className="hero-copy" style={{ color: 'rgba(224, 239, 255, 0.74)' }}>
              Войдите, чтобы смотреть статусы проектов, отчеты и обращения. Если доступа еще нет —
              оставьте заявку на главной странице.
            </p>

            {status === 'sent' ? (
              <p style={{ color: 'rgba(224, 239, 255, 0.85)' }}>
                Демо-вход принят. Полноценный кабинет подключается индивидуально для партнеров.
              </p>
            ) : (
              <form className="contact-form" onSubmit={onSubmit} style={{ marginTop: 24 }}>
                <label>
                  Email
                  <input type="email" name="email" placeholder="you@company.by" required />
                </label>
                <label>
                  Пароль
                  <input type="password" name="password" placeholder="••••••••" required />
                </label>
                <button className="primary-button" type="submit">
                  Войти
                </button>
              </form>
            )}

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
