import { query } from '../db.js';
import { billingStartDate, billingStartDateLabel } from './billingCutoff.js';
import { listBlockedCompanies, listProjectStates } from './financialState.js';

/**
 * Сверка заказов SalesRender с нашими списаниями.
 *
 * Заказ считается несписанным, если он находится в платном статусе
 * («Принят» и далее), а операции с его номером у нас нет. Такое случается,
 * когда вебхук не дошёл: SalesRender отбрасывает событие после 5 неудачных
 * попыток и больше его не присылает.
 */

/**
 * В работе только два статуса:
 *   Принят  — основной, списание идёт всем клиентам;
 *   Вручено — доплата 1,50 BYN, только если у клиента включён отдел выкупа.
 *
 * Остальные статусы (Рекламация, Решено, Комплектация, Отправлен, Отмена,
 * Спам, Дубли и прочие) в сверке не участвуют: списание по ним не делается.
 * Заказ, который прошёл «Принят», уже списан — если позже он уехал в другой
 * статус, списание остаётся, и повторно мы его не ищем.
 */
const STATUSES_BILLABLE = [2, 5];

const UPSELL_SLUGS = ['apseil', 'upsell', 'apsell', 'up_sell', 'up-sell'];
const CROSS_SLUGS = ['krossejl', 'crosssell', 'cross_sell', 'cross-sell', 'cross'];

function apiBase() {
  const token = String(process.env.SALESRENDER_API_KEY || '').trim();
  if (!token) return null;
  // cid в токене — это компания SalesRender, её и подставляем в адрес
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const cid = payload?.cid;
    if (!cid) return null;
    return `https://de.backend.salesrender.com/companies/${cid}/CRM`;
  } catch {
    return null;
  }
}

async function graphql(q) {
  const url = apiBase();
  const token = String(process.env.SALESRENDER_API_KEY || '').trim();
  if (!url || !token) throw new Error('SalesRender API недоступен: нет токена');

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.errors) {
    const first = data.errors[0]?.message || 'неизвестная ошибка';
    throw new Error(`SalesRender API: ${first}`);
  }
  return data.data;
}

const ORDER_FIELDS = `id status { id name } project { id } createdAt updatedAt
  cart { pricing { price } }
  data { stringFields { field { id name } value } booleanFields { field { id name } value }
         humanNameFields { field { id name } value { firstName lastName } }
         phoneFields { field { id name } value { international } } }`;

/** Все заказы в платных статусах за период. */
export async function fetchBillableOrders({ from, to }) {
  // Старше даты начала биллинга не смотрим: тогда ewinners.by ещё не работал
  // в полную силу, и такие заказы списывать не нужно.
  const cutoff = billingStartDate();
  const effectiveFrom = new Date(from) < cutoff ? cutoff.toISOString() : from;
  const range = [`gte: "${effectiveFrom}"`, to ? `lte: "${to}"` : null].filter(Boolean).join(', ');
  const pageQuery = (page) =>
    graphql(`{ ordersFetcher(filters: { include: { statusIds: [${STATUSES_BILLABLE.join(',')}], createdAt: { ${range} } } }, pagination: { pageNumber: ${page}, pageSize: 100 }) {
      orders { ${ORDER_FIELDS} } pageInfo { itemsCount pagesCount } } }`);

  // Первую страницу берём отдельно, чтобы узнать общее число страниц,
  // дальше качаем пачками — иначе месяц заказов собирается целую минуту.
  const first = await pageQuery(1);
  const out = [...first.ordersFetcher.orders];
  const pages = Math.min(first.ordersFetcher.pageInfo.pagesCount || 1, 300);

  const BATCH = 5;
  for (let start = 2; start <= pages; start += BATCH) {
    const nums = [];
    for (let p = start; p < start + BATCH && p <= pages; p += 1) nums.push(p);
    const batch = await Promise.all(nums.map((p) => pageQuery(p).catch(() => null)));
    for (const d of batch) if (d) out.push(...d.ordersFetcher.orders);
  }
  return out;
}

function orderFlags(order) {
  const names = (order.data?.booleanFields || [])
    .filter((f) => f.value === true)
    .map((f) => String(f.field?.name || '').toLowerCase());
  return {
    upsell: names.some((n) => UPSELL_SLUGS.includes(n)),
    cross: names.some((n) => CROSS_SLUGS.includes(n)),
  };
}

/** Сколько должно быть списано за заказ по базовому тарифу. */
function expectedBase(order) {
  const { upsell, cross } = orderFlags(order);
  return upsell || cross ? 5 : 3;
}

export function orderSummary(order) {
  const flags = orderFlags(order);
  const name = (order.data?.humanNameFields || [])
    .map((f) => [f.value?.lastName, f.value?.firstName].filter(Boolean).join(' '))
    .find(Boolean);
  const phone = (order.data?.phoneFields || [])
    .map((f) => f.value?.international || f.value?.national)
    .find(Boolean);
  const orderNo = (order.data?.stringFields || [])
    .find((f) => f.field?.name === 'nomer_zakaza_u_klienta')?.value;
  return {
    id: String(order.id),
    projectId: String(order.project?.id ?? ''),
    projectName: order.project?.name || null,
    statusId: Number(order.status?.id),
    statusName: order.status?.name || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    cartTotal: order.cart?.pricing?.price != null ? Number(order.cart.pricing.price) : null,
    clientOrderNumber: orderNo || null,
    customerName: name || null,
    customerPhone: phone || null,
    upsell: flags.upsell,
    cross: flags.cross,
    expected: expectedBase(order),
  };
}

/** Находит компанию по ID проекта SalesRender (основной или дополнительный). */
async function companyByProject(projectId) {
  const rows = await query(
    `SELECT c.id, c.name, c.buyout_enabled
       FROM companies c
      WHERE c.salesrender_id = :sr
      UNION
     SELECT c.id, c.name, c.buyout_enabled
       FROM companies c
       JOIN company_salesrender_projects p ON p.company_id = c.id
      WHERE p.salesrender_id = :sr
      LIMIT 1`,
    { sr: String(projectId) },
  );
  return rows[0] || null;
}

async function loadPendingReport({ from, to = null }) {
  const params = { from };
  let where = `p.status = 'pending' AND p.created_at >= :from`;
  if (to) {
    where += ' AND p.created_at < DATE_ADD(:to, INTERVAL 1 DAY)';
    params.to = to;
  }
  const rows = await query(
    `SELECT p.*, c.name AS company_name
       FROM salesrender_pending_charges p
       JOIN companies c ON c.id = p.company_id
      WHERE ${where}
      ORDER BY p.created_at, p.id`,
    params,
  );
  const items = rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    companyId: row.company_id,
    companyName: row.company_name,
    salesrenderProjectId: row.salesrender_project_id,
    kind: row.kind,
    amount: Number(row.amount),
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    attempts: Number(row.attempts || 0),
    lastError: row.last_error,
  }));
  const byCompany = new Map();
  for (const item of items) {
    const key = item.companyId;
    if (!byCompany.has(key)) {
      byCompany.set(key, {
        companyId: key,
        companyName: item.companyName,
        count: 0,
        amount: 0,
      });
    }
    const agg = byCompany.get(key);
    agg.count += 1;
    agg.amount += item.amount;
  }
  return {
    items,
    amount: Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2)),
    byCompany: [...byCompany.values()].sort((a, b) => b.amount - a.amount),
    eventIds: new Set(items.map((item) => `sr-accepted-${item.orderId}`)),
    baseOrderIds: new Set(
      items.filter((item) => item.kind === 'accepted').map((item) => String(item.orderId)),
    ),
  };
}

/**
 * Сверяет заказы SalesRender со списаниями.
 * Возвращает отчёт: что не списано, кому и на какую сумму.
 */
export async function buildReconciliationReport({ from, to = null }) {
  const orders = await fetchBillableOrders({ from, to });
  const [pendingReport, blockedCompanies, blockedProjects] = await Promise.all([
    loadPendingReport({ from, to }),
    listBlockedCompanies(),
    listProjectStates(),
  ]);
  if (!orders.length) {
    return {
      from,
      to,
      billingStartDate: billingStartDateLabel(),
      ordersChecked: 0,
      charged: 0,
      missing: [],
      missingAmount: 0,
      byCompany: [],
      pending: pendingReport.items,
      pendingAmount: pendingReport.amount,
      pendingByCompany: pendingReport.byCompany,
      blockedCompanies,
      blockedProjects,
    };
  }

  const ids = orders.map((o) => String(o.id));
  const chargedIds = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await query(
      `SELECT crm_event_id FROM transactions
        WHERE crm_event_id IN (${chunk.map((id) => `'sr-accepted-${id}'`).join(',')})`,
    );
    rows.forEach((r) => chargedIds.add(String(r.crm_event_id).replace('sr-accepted-', '')));
  }

  const missingRaw = orders.filter(
    (o) => !chargedIds.has(String(o.id)) && !pendingReport.baseOrderIds.has(String(o.id)),
  );
  const missing = [];
  const byCompany = new Map();
  let missingAmount = 0;

  for (const order of missingRaw) {
    const summary = orderSummary(order);
    const company = await companyByProject(summary.projectId);
    // Заказ из непривязанного проекта: списывать не с кого — показываем отдельно
    summary.companyId = company?.id || null;
    summary.companyName = company?.name || null;
    const delivered = Number(order.status?.id) === 5;
    summary.addon = delivered && Number(company?.buyout_enabled) === 1 ? 1.5 : 0;
    summary.amount = summary.expected + summary.addon;
    missingAmount += company ? summary.amount : 0;
    missing.push(summary);

    if (company) {
      const key = company.id;
      if (!byCompany.has(key)) byCompany.set(key, { companyId: key, companyName: company.name, count: 0, amount: 0 });
      const agg = byCompany.get(key);
      agg.count += 1;
      agg.amount += summary.amount;
    }
  }

  return {
    from,
    to,
    billingStartDate: billingStartDateLabel(),
    ordersChecked: orders.length,
    charged: orders.filter((o) => chargedIds.has(String(o.id))).length,
    missing,
    missingAmount: Number(missingAmount.toFixed(2)),
    unmappedProjects: [...new Set(missing.filter((m) => !m.companyId).map((m) => m.projectId))],
    byCompany: [...byCompany.values()].sort((a, b) => b.amount - a.amount),
    pending: pendingReport.items,
    pendingAmount: pendingReport.amount,
    pendingByCompany: pendingReport.byCompany,
    blockedCompanies,
    blockedProjects,
  };
}

/**
 * Повторяет вебхук для заказа — через обычный обработчик, чтобы сработали
 * тариф, защита от двойного списания и запись деталей заказа.
 */
async function replayOrder(order, status) {
  const token = String(process.env.SALESRENDER_API_KEY || '').trim();
  const port = process.env.PORT || 5000;
  const payload = {
    id: String(order.id),
    project: { id: String(order.project?.id ?? '') },
    status: { id: String(status.id), name: status.name },
    data: {
      stringFields: order.data?.stringFields || [],
      booleanFields: order.data?.booleanFields || [],
      humanNameFields: order.data?.humanNameFields || [],
      phoneFields: order.data?.phoneFields || [],
    },
    cart: order.cart || null,
  };
  const res = await fetch(`http://127.0.0.1:${port}/api/crm/salesrender/delivered`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': token },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (out.error) return { ok: false, error: out.error, amount: 0, queued: false };
  const charges = out.charges || [];
  const amount = charges
    .filter((c) => !c.queued && !c.skipped)
    .reduce((s, c) => s + Number(c.amount || 0), 0);
  const pendingAmount = charges
    .filter((c) => c.queued)
    .reduce((s, c) => s + Number(c.amount || 0), 0);
  const duplicate = !!(out.duplicate || charges.some((c) => c.duplicate));
  const queued = !!out.queued || charges.some((c) => c.queued);
  return { ok: true, duplicate, queued, amount, pendingAmount };
}

/**
 * Восстанавливает несписанные заказы.
 * orderIds — какие именно; если не переданы, берутся все найденные за период.
 */
export async function recoverMissingOrders({ from, to = null, orderIds = null }) {
  const report = await buildReconciliationReport({ from, to });
  const wanted = orderIds ? new Set(orderIds.map(String)) : null;
  const targets = report.missing.filter((m) => m.companyId && (!wanted || wanted.has(String(m.id))));

  // Нужны полные заказы — берём их ещё раз тем же запросом
  const orders = await fetchBillableOrders({ from, to });
  const byId = new Map(orders.map((o) => [String(o.id), o]));

  const results = [];
  let total = 0;
  for (const item of targets) {
    const order = byId.get(String(item.id));
    if (!order) continue;
    const base = await replayOrder(order, { id: 2, name: 'Принят' });
    if (!base.ok) {
      results.push({ id: item.id, ok: false, error: base.error, amount: 0 });
      continue;
    }
    let amount = base.duplicate || base.queued ? 0 : base.amount;
    let queued = base.queued;
    if (item.addon > 0) {
      const add = await replayOrder(order, { id: 5, name: 'Вручено' });
      if (add.ok && !add.duplicate && !add.queued) amount += add.amount;
      if (add.queued) queued = true;
    }
    total += amount;
    results.push({ id: item.id, ok: true, duplicate: base.duplicate, queued, amount });
  }

  return {
    restored: results.filter((r) => r.ok && !r.duplicate && !r.queued).length,
    queued: results.filter((r) => r.queued).length,
    skipped: results.filter((r) => r.duplicate).length,
    failed: results.filter((r) => !r.ok).length,
    amount: Number(total.toFixed(2)),
    results,
  };
}

