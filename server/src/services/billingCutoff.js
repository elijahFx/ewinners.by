/**
 * Ограничение списаний по дате создания заказа.
 *
 * Заказы, которые старше этой даты, не рассматриваются: до этого момента
 * ewinners.by не работал в полную силу, и такие заказы списывать нельзя.
 *
 * Дату создания триггер SalesRender может не присылать. Тогда мы запрашиваем
 * её у самого SalesRender — но только для заказов с «подозрительно старым»
 * номером, чтобы не делать лишний запрос на каждый вебхук.
 */

export function billingStartDate() {
  const raw = String(process.env.BILLING_START_DATE || '').trim();
  const d = raw ? new Date(`${raw.slice(0, 10)}T00:00:00+03:00`) : new Date('2026-09-01T00:00:00+03:00');
  return Number.isNaN(d.getTime()) ? new Date('2026-09-01T00:00:00+03:00') : d;
}

/** Дата начала биллинга как ГГГГ-ММ-ДД по минскому времени. */
export function billingStartDateLabel() {
  return billingStartDate().toLocaleDateString('sv-SE', { timeZone: 'Europe/Minsk' });
}

/** Ниже этого номера заказ может быть старым — тогда дату проверяем через API. */function verifyBelowOrderId() {
  const n = Number(process.env.BILLING_VERIFY_BELOW_ORDER_ID || 325000);
  return Number.isFinite(n) && n > 0 ? n : 325000;
}

function apiBase() {
  const token = String(process.env.SALESRENDER_API_KEY || '').trim();
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload?.cid ? `https://de.backend.salesrender.com/companies/${payload.cid}/CRM` : null;
  } catch {
    return null;
  }
}

/** Дата создания заказа из тела вебхука, если триггер её присылает. */
export function orderCreatedAtFromPayload(payload) {
  const candidates = [
    payload?.createdAt,
    payload?.created_at,
    payload?.data?.createdAt,
    payload?.order?.createdAt,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Запрашивает дату создания заказа у SalesRender. */
async function fetchOrderCreatedAt(orderId) {
  const url = apiBase();
  const token = String(process.env.SALESRENDER_API_KEY || '').trim();
  if (!url || !token) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ ordersFetcher(filters: { include: { ids: [${Number(orderId)}] } }, pagination: { pageNumber: 1, pageSize: 1 }) { orders { id createdAt } } }`,
      }),
    });
    const data = await res.json();
    const iso = data?.data?.ordersFetcher?.orders?.[0]?.createdAt;
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Нужно ли пропустить заказ как слишком старый.
 *
 * Если дату установить не удалось — не пропускаем: лучше списать лишнее,
 * чем потерять выручку.
 */
export async function isOrderTooOld({ payload, orderId }) {
  const cutoff = billingStartDate();
  let created = orderCreatedAtFromPayload(payload);
  let source = created ? 'payload' : null;

  if (!created && Number(orderId) < verifyBelowOrderId()) {
    created = await fetchOrderCreatedAt(orderId);
    source = created ? 'api' : null;
  }

  if (!created) return { tooOld: false, created: null, cutoff, source: null };
  return { tooOld: created < cutoff, created, cutoff, source };
}
