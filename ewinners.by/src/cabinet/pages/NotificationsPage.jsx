import { useEffect, useState } from 'react'
import { Bell, Mail, Send } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../AuthContext'

function Toggle({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-[#2a5f8f] bg-[#071529]/60 px-3.5 py-3 text-left transition hover:border-[#4ea8ff]/50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[#f3f8ff]">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-[#9db8d4]">{hint}</span> : null}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-[#258dff]' : 'bg-[#1e4a73]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}

export default function NotificationsPage() {
  const { user, refresh } = useAuth()
  const [items, setItems] = useState([])
  const [prefs, setPrefs] = useState({
    notifyEmail: true,
    notifyTelegram: false,
    telegramChatId: '',
  })
  const [channels, setChannels] = useState({ emailConfigured: false, telegramConfigured: false })
  const [saving, setSaving] = useState(false)

  async function load() {
    const [data, status] = await Promise.all([
      api('/api/cabinet/notifications'),
      api('/api/cabinet/notify-status'),
    ])
    setItems(data.items)
    setChannels(status)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  useEffect(() => {
    if (!user) return
    setPrefs({
      notifyEmail: user.notifyEmail !== false,
      notifyTelegram: !!user.notifyTelegram,
      telegramChatId: user.telegramChatId || '',
    })
  }, [user])

  async function savePrefs(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await api('/api/auth/notification-prefs', {
        method: 'PATCH',
        body: prefs,
      })
      await refresh()
      alert('Настройки сохранены')
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 text-[#f3f8ff]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Уведомления</h1>
          <p className="mt-1 text-sm text-[#9db8d4]">
            Счета, пополнения, акты. Настройте Email и Telegram.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-[#2a5f8f] bg-white/5 px-4 py-2 text-sm font-bold text-[#eaf4ff] hover:bg-white/10"
          onClick={async () => {
            await api('/api/cabinet/notifications/read-all', { method: 'POST' })
            await load()
          }}
        >
          Прочитать все
        </button>
      </div>

      <form
        onSubmit={savePrefs}
        className="max-w-xl space-y-4 rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4 sm:p-5"
      >
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Bell size={16} className="text-[#8fd2ff]" />
          Каналы уведомлений
        </div>

        <div className="space-y-2.5">
          <Toggle
            checked={prefs.notifyEmail}
            onChange={(v) => setPrefs({ ...prefs, notifyEmail: v })}
            label={
              <span className="inline-flex items-center gap-2">
                <Mail size={14} className="text-[#8fd2ff]" /> Email
              </span>
            }
            hint={
              channels.emailConfigured
                ? 'Письма на ваш логин-email'
                : 'SMTP на сервере пока не настроен'
            }
          />

          <Toggle
            checked={prefs.notifyTelegram}
            onChange={(v) => setPrefs({ ...prefs, notifyTelegram: v })}
            label={
              <span className="inline-flex items-center gap-2">
                <Send size={14} className="text-[#8fd2ff]" /> Telegram
              </span>
            }
            hint={
              channels.telegramConfigured
                ? 'Сообщения в личный чат с ботом'
                : 'Бот на сервере пока не настроен'
            }
          />
        </div>

        <div className="rounded-xl border border-[#2a5f8f] bg-[#071529]/70 p-3 text-sm leading-relaxed text-[#cfe6ff]">
          <p className="m-0">
            Для уведомлений откройте бота{' '}
            <a
              href="https://t.me/ewinnersnotifierbot"
              target="_blank"
              rel="noreferrer"
              className="font-extrabold text-[#8fd2ff] hover:underline"
            >
              @ewinnersnotifierbot
            </a>
            , напишите ему <code className="rounded bg-white/10 px-1">/start</code> и укажите ниже
            ваш Telegram Chat ID.
          </p>
          <a
            href="https://web.telegram.org/k/#@ewinnersnotifierbot"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block font-bold text-[#8fd2ff] hover:underline"
          >
            Открыть бота в Telegram Web →
          </a>
        </div>

        <label className="block text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
          Telegram Chat ID
          <input
            value={prefs.telegramChatId}
            onChange={(e) => setPrefs({ ...prefs, telegramChatId: e.target.value })}
            placeholder="Например 123456789"
            className="mt-1.5 h-10 w-full rounded-lg border border-[#2a5f8f] bg-[#071529] px-3 text-sm font-medium text-[#f3f8ff] outline-none focus:border-[#4ea8ff]"
          />
          <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-[#9db8d4]">
            Chat ID можно узнать у бота после первого сообщения или через @userinfobot.
          </span>
        </label>

        <div className="flex justify-end border-t border-[#2a5f8f]/60 pt-4">
          <button type="submit" className="cab-btn primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить настройки'}
          </button>
        </div>
      </form>

      <div className="grid gap-3 md:grid-cols-2">
        {items.map((n) => (
          <div
            key={n.id}
            className={`rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4 ${
              n.is_read ? 'opacity-70' : ''
            }`}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <strong className="text-sm text-white">{n.title}</strong>
              <span className="shrink-0 text-xs text-[#9db8d4]">
                {new Date(n.created_at).toLocaleString('ru-RU')}
              </span>
            </div>
            <p className="m-0 text-sm leading-relaxed text-[#9db8d4]">{n.body}</p>
          </div>
        ))}
        {!items.length && (
          <div className="rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-8 text-center text-[#9db8d4] md:col-span-2">
            Уведомлений нет
          </div>
        )}
      </div>
    </div>
  )
}
