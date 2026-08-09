import { Link } from 'react-router-dom'

export default function Footer({ contactHref = '#contact', tagline }) {
  return (
    <footer className="footer">
      <div className="footer-brand">
        <Link className="logo" to="/" aria-label="E-Winners">
          <img className="logo-image" src="/e-winners-logo.jpeg" alt="" />
          <span className="nowrap">E-Winners</span>
        </Link>
        <p>{tagline}</p>
      </div>

      <nav className="footer-nav" aria-label="Навигация в футере">
        <div>
          <span>Компания</span>
          <Link to="/#about">О компании</Link>
          <Link to="/#reviews">Яндекс отзывы</Link>
          <Link to="/#news">Новости</Link>
        </div>
        <div>
          <span>Наши услуги</span>
          <Link to="/call-center">Колл-центр</Link>
          <Link to="/hr">HR-услуги</Link>
          <Link to="/target">Маркетинг</Link>
        </div>
        <div className="footer-documents">
          <span>Документы</span>
          <a href="/documents/dogovor-koll-tsentr.pdf" target="_blank" rel="noreferrer">
            Договор колл-центра
          </a>
          <a href="/documents/dogovor-hr-podbor-personala.pdf" target="_blank" rel="noreferrer">
            Договор HR
          </a>
          <a href="/documents/dogovor-marketing.pdf" target="_blank" rel="noreferrer">
            Договор маркетинга
          </a>
        </div>
      </nav>

      <div className="footer-actions">
        <a className="footer-phone" href="tel:+375255056917">
          +375 (25) 505-69-17
        </a>
        <a className="primary-button small" href={contactHref}>
          Оставить заявку
        </a>
      </div>
    </footer>
  )
}
