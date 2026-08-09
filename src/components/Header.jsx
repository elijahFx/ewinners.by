import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, PhoneCall, X } from 'lucide-react'

export default function Header({ contactHref = '#contact' }) {
  const [open, setOpen] = useState(false)

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
      </nav>

      <div className="header-actions">
        <a className="phone-link" href="tel:+375255056917">
          <PhoneCall size={17} aria-hidden="true" />
          +375 (25) 505-69-17
        </a>
        <a className="primary-button small" href={contactHref} onClick={() => setOpen(false)}>
          Оставить заявку
        </a>
        <Link className="account-button" to="/account" onClick={() => setOpen(false)}>
          Войти в личный кабинет
        </Link>
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
