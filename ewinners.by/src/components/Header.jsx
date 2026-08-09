import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut, Menu, PhoneCall, X } from 'lucide-react'
import { useAuth } from '../cabinet/AuthContext'

export default function Header({ contactHref = '#contact' }) {
  const [open, setOpen] = useState(false)
  const { user, logout, loading } = useAuth()
  const navigate = useNavigate()

  function doLogout() {
    logout()
    setOpen(false)
    navigate('/account')
  }

  return (
    <header className="header">
      <Link className="logo" to="/" aria-label="E-Winners" onClick={() => setOpen(false)}>
        <img className="logo-image" src="/e-winners-logo.jpeg" alt="" />
        <span className="nowrap">E-Winners</span>
      </Link>

      <nav className={`nav${open ? ' is-open' : ''}`} aria-label="Основная навигация">
        <Link to="/call-center" onClick={() => setOpen(false)}>
          Колл-центр
        </Link>
        <Link to="/hr" onClick={() => setOpen(false)}>
          HR-услуги
        </Link>
        <Link to="/target" onClick={() => setOpen(false)}>
          Маркетинг
        </Link>
        {user && (
          <>
            <Link to="/cabinet" onClick={() => setOpen(false)}>
              Личный кабинет
            </Link>
            <button type="button" className="nav-logout" onClick={doLogout}>
              Выйти
            </button>
          </>
        )}
      </nav>

      <div className="header-actions">
        <a className="phone-link" href="tel:+375255056917">
          <PhoneCall size={17} aria-hidden="true" />
          +375 (25) 505-69-17
        </a>
        <a className="primary-button small" href={contactHref} onClick={() => setOpen(false)}>
          Оставить заявку
        </a>
        {!loading && user ? (
          <>
            <Link className="account-button" to="/cabinet" onClick={() => setOpen(false)}>
              Кабинет
            </Link>
            <button type="button" className="account-button logout-button" onClick={doLogout}>
              <LogOut size={16} aria-hidden="true" />
              Выйти
            </button>
          </>
        ) : (
          <Link className="account-button" to="/account" onClick={() => setOpen(false)}>
            Войти в личный кабинет
          </Link>
        )}
        <button
          className="menu-button"
          type="button"
          aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>
    </header>
  )
}
