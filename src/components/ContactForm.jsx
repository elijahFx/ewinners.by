import { useState } from 'react'
import { MessageCircle, PhoneCall } from 'lucide-react'

export default function ContactForm({
  id = 'contact',
  source,
  title,
  description,
  messageLabel = 'Что нужно обсудить',
  messagePlaceholder = 'Коротко опишите задачу',
  companyPlaceholder = 'Например, товарный бизнес',
}) {
  const [status, setStatus] = useState('idle')

  function onSubmit(event) {
    event.preventDefault()
    setStatus('sending')
    window.setTimeout(() => setStatus('sent'), 500)
  }

  return (
    <section className="contact-section" id={id}>
      <div className="contact-copy">
        <span className="section-kicker">Заявка</span>
        <h2>{title}</h2>
        <p>{description}</p>
        <a className="contact-phone" href="tel:+375255056917">
          <PhoneCall size={22} aria-hidden="true" />
          +375 (25) 505-69-17
        </a>
      </div>

      {status === 'sent' ? (
        <div className="contact-form" role="status">
          <h3 style={{ margin: 0 }}>Заявка отправлена</h3>
          <p style={{ marginBottom: 0 }}>
            Мы свяжемся с вами в ближайшее время по указанному контакту.
          </p>
        </div>
      ) : (
        <form className="contact-form" onSubmit={onSubmit}>
          <input type="hidden" name="source" value={source} />
          <label>
            Имя
            <input type="text" name="name" placeholder="Как к вам обращаться" required />
          </label>
          <label>
            Телефон или Telegram
            <input type="text" name="contact" placeholder="+375 / @username" required />
          </label>
          <label>
            Компания или ниша
            <input type="text" name="company" placeholder={companyPlaceholder} />
          </label>
          <label>
            {messageLabel}
            <textarea name="message" placeholder={messagePlaceholder} />
          </label>
          <button className="primary-button" type="submit" disabled={status === 'sending'}>
            Отправить заявку
            <MessageCircle size={18} aria-hidden="true" />
          </button>
        </form>
      )}
    </section>
  )
}
