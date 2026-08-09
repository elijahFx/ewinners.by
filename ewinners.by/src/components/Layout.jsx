import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'

export default function Layout({ shellClass, contactHref, footerTagline, children }) {
  const location = useLocation()

  useEffect(() => {
    if (location.hash) {
      const el = document.querySelector(location.hash)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    window.scrollTo(0, 0)
  }, [location.pathname, location.hash])

  return (
    <div className={`site-shell ${shellClass}`.trim()}>
      <Header contactHref={contactHref} />
      <main id="top">{children}</main>
      <Footer contactHref={contactHref} tagline={footerTagline} />
    </div>
  )
}
