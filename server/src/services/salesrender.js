/**
 * SalesRender → E-Winners billing (read-only towards CRM).
 *
 * Deduct when order reaches status «Вручено» (id=5):
 *  - krossejl OR apseil true  → service sr_order_upsell (default 5 BYN)
 *  - otherwise                → service sr_order_base   (default 3 BYN)
 *  - optional + sr_order_delivered (default 1.5) only if company has its own tariff
 *
 * Never writes/updates anything in SalesRender.
 */
import { query } from '../db.js';
import {
  debitBalance,
  getEffectiveTariff,
  notifyCompanyUsers,
  tariffMissingReason,
} from './billing.js';

export const SR_STATUS_DELIVERED_ID = 5;
export const SR_SERVICE_BASE = 'sr_order_base';
export const SR_SERVICE_UPSELL = 'sr_order_upsell';
export const SR_SERVICE_DELIVERED = 'sr_order_delivered';

export function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (!s) return false;
    return ['1', 'true', 'yes', 'y', 'да', 'on', 'checked'].includes(s);
  }
  if (typeof value === 'object') {
    if ('value' in value) return isTruthyFlag(value.value);
    if ('checked' in value) return isTruthyFlag(value.checked);
  }
  return Boolean(value);
}

function dig(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null) return null;
    cur = cur[key];
  }
  return cur;
}

/** Flatten SalesRender webhook GraphQL envelope to a single order-like object. */
export function unwrapSalesRenderPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const orders =
    dig(payload, ['data', 'ordersFetcher', 'orders']) ||
    dig(payload, ['ordersFetcher', 'orders']) ||
    dig(payload, ['data', 'orders']) ||
    null;
  if (Array.isArray(orders) && orders[0]) {
    return { ...payload, ...orders[0], order: orders[0] };
  }
  if (payload.order && typeof payload.order === 'object') {
    return { ...payload, ...payload.order };
  }
  return payload;
}

function fieldUri(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const field = entry.field;
  if (typeof field === 'string') return field;
  return String(field?.uri || field?.code || field?.slug || field?.name || entry.uri || entry.code || '');
}

/** Find field by slug in assorted SalesRender / custom webhook shapes. */
export function pickOrderField(payload, slug) {
  const src = unwrapSalesRenderPayload(payload);
  if (!src || typeof src !== 'object') return null;
  const keys = [slug, slug.toLowerCase()];

  for (const key of keys) {
    if (src[key] != null) return src[key];
  }

  const nests = [
    src.fields,
    src.orderFields,
    src.order_fields,
    src.data?.fields,
    src.data?.booleanFields,
    src.data?.stringFields,
    src.data?.integerFields,
    src.order?.data?.booleanFields,
    src.order?.fields,
    src.order,
    src.data,
    src.entity,
    src.variables,
  ].filter(Boolean);

  for (const nest of nests) {
    if (!Array.isArray(nest) && nest?.[slug] != null) return nest[slug];
    if (!Array.isArray(nest) && nest?.[slug.toLowerCase()] != null) return nest[slug.toLowerCase()];
    if (Array.isArray(nest)) {
      const hit = nest.find((f) => fieldUri(f).toLowerCase() === slug.toLowerCase());
      if (hit) return hit.value ?? hit.val ?? hit.checked ?? hit;
    }
  }

  return null;
}

export function extractOrderId(payload) {
  const src = unwrapSalesRenderPayload(payload);
  return (
    src.orderId ||
    src.order_id ||
    src.id ||
    dig(src, ['order', 'id']) ||
    dig(payload, ['data', 'id']) ||
    dig(payload, ['entity', 'id']) ||
    null
  );
}

export function extractStatusId(payload) {
  const src = unwrapSalesRenderPayload(payload);
  const raw =
    src.statusId ??
    src.status_id ??
    dig(src, ['status', 'id']) ??
    dig(src, ['order', 'status', 'id']) ??
    dig(src, ['order', 'statusId']) ??
    dig(payload, ['data', 'status', 'id']);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function extractStatusName(payload) {
  const src = unwrapSalesRenderPayload(payload);
  return String(
    src.statusName ||
      src.status_name ||
      dig(src, ['status', 'name']) ||
      dig(src, ['order', 'status', 'name']) ||
      (typeof src.status === 'string' ? src.status : '') ||
      '',
  ).trim();
}

export function extractCompanyNameFromPayload(payload) {
  const src = unwrapSalesRenderPayload(payload);
  const candidates = [
    src.companyName,
    src.company_name,
    src.organization,
    dig(src, ['project', 'name']),
    dig(src, ['order', 'project', 'name']),
    dig(payload, ['data', 'ordersFetcher', 'orders', 0, 'project', 'name']),
    src.company?.name,
  ];
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (s) return s;
  }
  return '';
}

export function isDeliveredStatus(payload, { statusId = SR_STATUS_DELIVERED_ID } = {}) {
  const id = extractStatusId(payload);
  if (id != null && Number(id) === Number(statusId)) return true;
  const name = extractStatusName(payload).toLowerCase();
  if (name.includes('вручен')) return true;
  return false;
}

export function resolveCallAmountFlags(payload) {
  const cross = isTruthyFlag(pickOrderField(payload, 'krossejl'));
  const upsell = isTruthyFlag(pickOrderField(payload, 'apseil'));
  const hasExtra = cross || upsell;
  return {
    cross,
    upsell,
    hasExtra,
    serviceCode: hasExtra ? SR_SERVICE_UPSELL : SR_SERVICE_BASE,
  };
}

async function loadService(code) {
  const rows = await query(
    `SELECT * FROM services WHERE code = :code AND is_active = 1 LIMIT 1`,
    { code },
  );
  return rows[0] || null;
}

async function debitService({
  companyId,
  projectId,
  service,
  tariff,
  eventId,
  employeeName,
  comment,
  orderId,
}) {
  const unitPrice = Number(tariff.price);
  const amount = Number(unitPrice.toFixed(2));
  const result = await debitBalance({
    companyId,
    projectId,
    category: 'crm_action',
    amount,
    serviceId: service.id,
    tariffId: tariff.id,
    quantity: 1,
    unitPrice,
    crmEventId: eventId,
    employeeName,
    comment,
  });
  return { ...result, amount, serviceCode: service.code, orderId };
}

/**
 * Process SalesRender "delivered" webhook for one company.
 * Idempotent per order via crm_event_id.
 */
export async function processSalesRenderDelivered({
  companyId,
  payload,
  projectId = null,
  employeeName = null,
  deliveredStatusId = SR_STATUS_DELIVERED_ID,
}) {
  if (!isDeliveredStatus(payload, { statusId: deliveredStatusId })) {
    return {
      ok: true,
      skipped: true,
      reason: 'status_not_delivered',
      statusId: extractStatusId(payload),
      statusName: extractStatusName(payload),
    };
  }

  const orderId = extractOrderId(payload);
  if (!orderId) {
    throw new Error('В вебхуке нет orderId');
  }

  const baseEventId = `sr-delivered-${orderId}`;
  const dup = await query(
    `SELECT id FROM transactions WHERE crm_event_id = :event_id LIMIT 1`,
    { event_id: baseEventId },
  );
  if (dup.length) {
    return { ok: true, duplicate: true, eventId: baseEventId, orderId: String(orderId) };
  }

  const flags = resolveCallAmountFlags(payload);
  const baseService = await loadService(flags.serviceCode);
  if (!baseService) {
    throw new Error(`Услуга ${flags.serviceCode} не найдена — выполните seed/migrate`);
  }

  const baseTariff = await getEffectiveTariff({
    companyId,
    projectId,
    serviceId: baseService.id,
  });
  if (!baseTariff) {
    throw new Error(
      `Тариф для услуги «${baseService.name}» не найден. ${await tariffMissingReason({ companyId })}`,
    );
  }

  const crossLabel = [
    flags.cross ? 'кроссейл' : null,
    flags.upsell ? 'апсейл' : null,
  ]
    .filter(Boolean)
    .join('+');

  const baseComment =
    `SalesRender заказ #${orderId}: обзвон` +
    (crossLabel ? ` (${crossLabel})` : ' (без апс/кросс)');

  const charges = [];
  const baseTx = await debitService({
    companyId,
    projectId,
    service: baseService,
    tariff: baseTariff,
    eventId: baseEventId,
    employeeName,
    comment: baseComment,
    orderId: String(orderId),
  });
  charges.push(baseTx);

  const deliveredService = await loadService(SR_SERVICE_DELIVERED);
  if (deliveredService) {
    // Отдел выкупа включается галочкой у клиента: тогда к базовой цене
    // добавляется тариф за выкупленный заказ (обычно 1,50 BYN).
    const companyRows = await query(
      'SELECT buyout_enabled FROM companies WHERE id = :id LIMIT 1',
      { id: companyId },
    );
    const buyoutEnabled = Number(companyRows[0]?.buyout_enabled || 0) === 1;

    const addOn = buyoutEnabled
      ? await getEffectiveTariff({ companyId, projectId, serviceId: deliveredService.id })
      : null;

    if (buyoutEnabled && !addOn) {
      console.warn(
        `[salesrender] у компании ${companyId} включён отдел выкупа, но тариф ${SR_SERVICE_DELIVERED} не задан — доплата не списана`,
      );
    }

    if (addOn) {
      const addEventId = `sr-delivered-bonus-${orderId}`;
      const addDup = await query(
        `SELECT id FROM transactions WHERE crm_event_id = :event_id LIMIT 1`,
        { event_id: addEventId },
      );
      if (!addDup.length) {
        const addTx = await debitService({
          companyId,
          projectId,
          service: deliveredService,
          tariff: addOn,
          eventId: addEventId,
          employeeName,
          comment: `SalesRender заказ #${orderId}: выкуп (вручено)`,
          orderId: String(orderId),
        });
        charges.push(addTx);
      }
    }
  }

  const updated = await query(
    'SELECT balance, notify_threshold FROM companies WHERE id = :id',
    { id: companyId },
  );
  if (updated[0] && Number(updated[0].balance) <= Number(updated[0].notify_threshold)) {
    await notifyCompanyUsers(
      companyId,
      'Низкий баланс',
      `Текущий баланс: ${Number(updated[0].balance).toFixed(2)} BYN`,
    );
  }

  const total = charges.reduce((s, c) => s + Number(c.amount || 0), 0);
  return {
    ok: true,
    orderId: String(orderId),
    flags,
    charges,
    total,
    balanceAfter: updated[0] ? Number(updated[0].balance) : null,
  };
}

/** Ensure SR services + global base tariffs exist. */
export async function ensureSalesRenderServices() {
  const services = [
    [SR_SERVICE_BASE, 'Заказ без апсейла/кроссейла (обзвон)', 'шт'],
    [SR_SERVICE_UPSELL, 'Заказ с апсейлом или кроссейлом (обзвон)', 'шт'],
    [SR_SERVICE_DELIVERED, 'Выкупленный заказ (вручено)', 'шт'],
  ];
  for (const [code, name, unit] of services) {
    await query(
      `INSERT INTO services (code, name, unit, description, is_active)
       VALUES (:code, :name, :unit, :description, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), unit = VALUES(unit), is_active = 1`,
      {
        code,
        name,
        unit,
        description: 'SalesRender / списание при статусе «Вручено»',
      },
    );
  }

  const rows = await query(
    `SELECT id, code FROM services
     WHERE code IN ('${SR_SERVICE_BASE}', '${SR_SERVICE_UPSELL}', '${SR_SERVICE_DELIVERED}')`,
  );
  const byCode = Object.fromEntries(rows.map((r) => [r.code, r.id]));

  const globals = [
    [SR_SERVICE_BASE, 3.0],
    [SR_SERVICE_UPSELL, 5.0],
    // NO global for delivered — only when client tariff is attached
  ];

  for (const [code, price] of globals) {
    const serviceId = byCode[code];
    if (!serviceId) continue;
    // Общий тариф — только запасной вариант для пустой базы. Если на услугу уже
    // задан тариф (например, на уровне проекта «Товарка»), ничего не создаём,
    // иначе при каждом старте появлялся бы дубль.
    const anyTariff = await query(
      `SELECT id FROM tariffs WHERE service_id = :service_id AND valid_to IS NULL LIMIT 1`,
      { service_id: serviceId },
    );
    if (anyTariff.length) continue;

    await query(
      `INSERT INTO tariffs (company_id, project_id, service_id, price, billing_type, valid_from)
       VALUES (NULL, NULL, :service_id, :price, 'unit', CURDATE())`,
      { service_id: serviceId, price },
    );
  }

  return byCode;
}
