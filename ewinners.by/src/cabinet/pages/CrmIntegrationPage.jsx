import { useEffect, useState } from 'react'
import { Cable, Copy, KeyRound, Link2, RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from '../api'

const API_BASE = (import.meta.env.VITE_API_URL || 'https://test.zkh.by').replace(/\/$/, '')

const SERVICES = [
  ['call_minute', 'Минута разговора', 'мин'],
  ['confirmed_lead', 'Подтверждённая заявка', 'шт'],
  ['processed_lead', 'Обработанный лид', 'шт'],
  ['message', 'Отправленное сообщение', 'шт'],
  ['meeting', 'Назначенная встреча', 'шт'],
  ['subscription', 'Абонентская плата', 'мес'],
]

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/crm/me',
    title: 'Компания и баланс',
    description: 'Кто вы по API-ключу: companyId, название, баланс, доступный лимит.',
    response: `{
  "companyId": 12,
  "name": "ООО Ромашка",
  "unp": "123456789",
  "status": "active",
  "balance": 150.00,
  "creditLimit": 50.00,
  "available": 200.00,
  "notifyThreshold": 500
}`,
  },
  {
    method: 'GET',
    path: '/api/crm/balance',
    title: 'Баланс',
    description: 'Текущий баланс и кредитный лимит компании.',
    response: `{
  "companyId": 12,
  "balance": 150.00,
  "creditLimit": 50.00,
  "available": 200.00,
  "notifyThreshold": 500,
  "status": "active"
}`,
  },
  {
    method: 'GET',
    path: '/api/crm/projects',
    title: 'Проекты',
    description: 'Список проектов (заказов) вашей компании.',
    response: `{
  "items": [
    {
      "id": 4,
      "name": "Колл-центр Q2",
      "status": "active",
      "description": null,
      "createdAt": "2026-03-01T10:00:00.000Z"
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/crm/calls',
    title: 'Звонки',
    description:
      'Все звонки по вашим заказам (списания call_minute). Query: ?limit=100&from=&to=',
    response: `{
  "items": [
    {
      "id": 1840,
      "minutes": 12.5,
      "amount": 6.25,
      "unitPrice": 0.50,
      "projectId": 4,
      "projectName": "Колл-центр Q2",
      "employeeName": "Иванова А.",
      "comment": "Минута разговора × 12.5",
      "crmEventId": "call-55102",
      "createdAt": "2026-08-09T12:01:00.000Z"
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/crm/leads',
    title: 'Заявки / лиды',
    description: 'Подтверждённые и обработанные заявки (confirmed_lead, processed_lead).',
    response: `{
  "items": [
    {
      "id": 1842,
      "type": "confirmed_lead",
      "typeName": "Подтверждённая заявка",
      "quantity": 1,
      "amount": 4.50,
      "projectId": 4,
      "projectName": "Колл-центр Q2",
      "employeeName": "Иванова А.",
      "comment": "Заявка с формы сайта",
      "crmEventId": "crm-lead-98231",
      "createdAt": "2026-08-09T12:05:00.000Z"
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/crm/transactions',
    title: 'Все операции',
    description: 'Полная история списаний и пополнений. Query: ?limit=100&from=&to=',
    response: `{
  "items": [
    {
      "id": 1842,
      "type": "debit",
      "category": "crm_action",
      "amount": 4.50,
      "quantity": 1,
      "unitPrice": 4.50,
      "balanceAfter": 145.50,
      "serviceCode": "confirmed_lead",
      "serviceName": "Подтверждённая заявка",
      "projectId": 4,
      "projectName": "Колл-центр Q2",
      "employeeName": "Иванова А.",
      "comment": "Заявка с формы сайта",
      "crmEventId": "crm-lead-98231",
      "createdAt": "2026-08-09T12:05:00.000Z"
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/crm/invoices',
    title: 'Счета',
    description: 'Счета на оплату вашей компании.',
    response: `{
  "items": [
    {
      "id": 88,
      "number": "СЧ-2026-0088",
      "amount": 500.00,
      "paidAmount": 500.00,
      "status": "paid",
      "purpose": "Пополнение баланса",
      "projectId": null,
      "createdAt": "2026-08-01T09:00:00.000Z",
      "paidAt": "2026-08-02T11:20:00.000Z"
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/api/crm/services',
    title: 'Услуги и тарифы',
    description: 'Справочник услуг с вашими актуальными ценами. Опционально ?projectId=',
    response: `{
  "items": [
    {
      "code": "call_minute",
      "name": "Минута разговора",
      "unit": "мин",
      "description": null,
      "price": 0.50,
      "billingType": "minute"
    }
  ]
}`,
  },
  {
    method: 'POST',
    path: '/api/crm/events',
    title: 'Списание за событие',
    description:
      'Отправьте действие из CRM. companyId берётся из API-ключа (если передан — должен совпадать). eventId уникален.',
    request: `{
  "eventId": "crm-lead-98231",
  "projectId": 4,
  "serviceCode": "confirmed_lead",
  "quantity": 1,
  "employeeName": "Иванова А.",
  "comment": "Заявка с формы сайта"
}`,
    response: `{
  "ok": true,
  "transactionId": 1842,
  "balanceBefore": 150.00,
  "balanceAfter": 145.50,
  "amount": 4.50
}`,
    extraResponses: [
      { title: '200 — повтор eventId', body: `{ "ok": true, "duplicate": true }` },
      { title: '401', body: `{ "error": "Неверный CRM API key" }` },
      { title: '400', body: `{ "error": "eventId обязателен" }` },
      { title: '400', body: `{ "error": "Тариф не найден" }` },
      { title: '400', body: `{ "error": "Недостаточно средств на балансе" }` },
    ],
  },
]

function CodeBlock({ title, children, language = 'json' }) {
  const [copied, setCopied] = useState(false)
  const text = String(children).trim()

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#2a5f8f] bg-[#071529]">
      <div className="flex items-center justify-between gap-3 border-b border-[#2a5f8f]/70 px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-[#9db8d4]">
          {title}
          {language ? <span className="ml-2 opacity-60">{language}</span> : null}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a5f8f] bg-white/5 px-2 py-1 text-xs font-bold text-[#cfe6ff] hover:bg-white/10"
        >
          <Copy size={12} />
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto p-3 text-[12.5px] leading-relaxed text-[#d7ebff]">
        <code>{text}</code>
      </pre>
    </div>
  )
}

export default function CrmIntegrationPage() {
  const [keyInfo, setKeyInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)

  async function load() {
    const data = await api('/api/cabinet/api-key')
    setKeyInfo(data)
  }

  useEffect(() => {
    load().catch((e) => alert(e.message))
  }, [])

  async function regenerate() {
    const has = keyInfo?.hasKey
    const ok = window.confirm(
      has
        ? 'Старый ключ перестанет работать. Сгенерировать новый?'
        : 'Сгенерировать API-ключ для вашей компании?',
    )
    if (!ok) return
    setBusy(true)
    try {
      const data = await api('/api/cabinet/api-key/regenerate', { method: 'POST' })
      setKeyInfo(data)
      setRevealed(true)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const curlExample = `curl -X GET ${API_BASE}/api/crm/calls \\
  -H "X-Api-Key: ${keyInfo?.apiKey || 'YOUR_CRM_API_KEY'}"`

  const postCurl = `curl -X POST ${API_BASE}/api/crm/events \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: ${keyInfo?.apiKey || 'YOUR_CRM_API_KEY'}" \\
  -d '{"eventId":"crm-lead-98231","projectId":4,"serviceCode":"confirmed_lead","quantity":1}'`

  return (
    <div className="mx-auto max-w-3xl space-y-5 text-[#f3f8ff]">
      <div>
        <h1 className="m-0 text-[28px] font-bold leading-tight text-white">Интеграция с CRM</h1>
        <p className="mt-1 text-sm text-[#9db8d4]">
          API-ключ компании, эндпоинты и примеры ответов для подключения сторонней CRM.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <KeyRound size={16} className="text-[#8fd2ff]" />
          Ваш API-ключ
        </div>
        <p className="m-0 text-sm text-[#cfe6ff]">
          Компания:{' '}
          <strong>
            {keyInfo?.companyName || '…'} (ID {keyInfo?.companyId ?? '—'})
          </strong>
          . Ключ передавайте в заголовке{' '}
          <code className="rounded bg-white/10 px-1">X-Api-Key</code>.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-[#2a5f8f] bg-[#071529] px-3 py-2.5 font-mono text-xs text-[#8fd2ff]">
            {keyInfo?.apiKey
              ? revealed
                ? keyInfo.apiKey
                : `${keyInfo.apiKey.slice(0, 8)}…${keyInfo.apiKey.slice(-4)}`
              : 'Ключ ещё не создан'}
          </code>
          <div className="flex flex-wrap gap-2">
            {keyInfo?.apiKey ? (
              <>
                <button
                  type="button"
                  className="cab-btn ghost"
                  onClick={() => setRevealed((v) => !v)}
                >
                  {revealed ? 'Скрыть' : 'Показать'}
                </button>
                <button
                  type="button"
                  className="cab-btn ghost"
                  onClick={() => navigator.clipboard?.writeText(keyInfo.apiKey)}
                >
                  <Copy size={14} />
                  Копировать
                </button>
              </>
            ) : null}
            <button type="button" className="cab-btn primary" disabled={busy} onClick={regenerate}>
              <RefreshCw size={14} />
              {keyInfo?.hasKey ? 'Перегенерировать' : 'Сгенерировать'}
            </button>
          </div>
        </div>
        {keyInfo?.createdAt ? (
          <p className="m-0 text-xs text-[#9db8d4]">
            Создан: {new Date(keyInfo.createdAt).toLocaleString('ru-RU')}
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Cable size={16} className="text-[#8fd2ff]" />
          Как подключить
        </div>
        <ol className="m-0 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[#cfe6ff]">
          <li>Сгенерируйте API-ключ выше.</li>
          <li>
            Базовый URL: <code className="rounded bg-white/10 px-1">{API_BASE}</code>
          </li>
          <li>
            Читайте данные (звонки, лиды, баланс) через GET или списывайте действия через{' '}
            <code className="rounded bg-white/10 px-1">POST /api/crm/events</code>.
          </li>
          <li>
            Один <code className="rounded bg-white/10 px-1">eventId</code> списывается только один
            раз — безопасны ретраи.
          </li>
        </ol>
      </section>

      <section className="space-y-3 rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <ShieldCheck size={16} className="text-[#8fd2ff]" />
          Коды услуг (serviceCode)
        </div>
        <div className="overflow-x-auto rounded-xl border border-[#2a5f8f]">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[#071529] text-xs uppercase tracking-wide text-[#9db8d4]">
              <tr>
                <th className="px-3 py-2 font-bold">code</th>
                <th className="px-3 py-2 font-bold">Название</th>
                <th className="px-3 py-2 font-bold">Ед.</th>
              </tr>
            </thead>
            <tbody className="text-[#cfe6ff]">
              {SERVICES.map(([code, name, unit]) => (
                <tr key={code} className="border-t border-[#2a5f8f]/60">
                  <td className="px-3 py-2 font-mono text-[12.5px] text-[#8fd2ff]">{code}</td>
                  <td className="px-3 py-2">{name}</td>
                  <td className="px-3 py-2 text-[#9db8d4]">{unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Link2 size={16} className="text-[#8fd2ff]" />
          API: запросы и ответы
        </div>

        {ENDPOINTS.map((ep) => (
          <article
            key={ep.path + ep.method}
            className="space-y-3 rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4 sm:p-5"
          >
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
                    ep.method === 'POST'
                      ? 'bg-[#258dff]/25 text-[#8fd2ff]'
                      : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {ep.method}
                </span>
                <code className="text-sm font-bold text-white">
                  {API_BASE}
                  {ep.path}
                </code>
              </div>
              <h3 className="m-0 text-sm font-bold text-[#eaf4ff]">{ep.title}</h3>
              <p className="mt-1 mb-0 text-sm text-[#9db8d4]">{ep.description}</p>
            </div>
            {ep.request ? (
              <CodeBlock title="Request body" language="json">
                {ep.request}
              </CodeBlock>
            ) : null}
            <CodeBlock title="Response 200" language="json">
              {ep.response}
            </CodeBlock>
            {ep.extraResponses?.map((ex) => (
              <CodeBlock key={ex.title + ex.body} title={ex.title} language="json">
                {ex.body}
              </CodeBlock>
            ))}
          </article>
        ))}
      </section>

      <section className="space-y-3 rounded-2xl border border-[#2a5f8f] bg-[#0b1f3a] p-4 sm:p-5">
        <h2 className="m-0 text-sm font-bold text-white">Примеры cURL</h2>
        <CodeBlock title="Список звонков" language="bash">
          {curlExample}
        </CodeBlock>
        <CodeBlock title="Списание события" language="bash">
          {postCurl}
        </CodeBlock>
      </section>
    </div>
  )
}
