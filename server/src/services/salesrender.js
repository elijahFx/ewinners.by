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
  notifyCompanyUsers,
  resolveTariffAndProject,
  tariffMissingReason,
} from './billing.js';

// Статусы SalesRender, по которым списываем.
// «Принят» — базовый тариф за обзвон, «Вручено» — доплата за выкуп.
export const SR_STATUS_ACCEPTED_ID = 2;
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
// Наборы полей заказа в разных формах payload.
const FIELD_GROUPS = [
  'fields',
  'orderFields',
  'order_fields',
  'booleanFields',
  'stringFields',
  'integerFields',
  'floatFields',
  'enumFields',
  'dateTimeFields',
  'uriFields',
  'emailFields',
  'phoneFields',
  'humanNameFields',
  'addressFields',
  'imageFields',
  'fileFields',
  'userFields',
];

/**
 * Все места, где могут лежать поля заказа.
 *
 * Вебхук SalesRender присылает GraphQL-вид, где данные обёрнуты в `data`,
 * а внутри заказа ещё раз `data` — то есть путь `data.data.booleanFields`.
 * Поэтому корни перебираем на разной глубине, а не только верхний уровень.
 */
function fieldNests(payload) {
  const src = unwrapSalesRenderPayload(payload);
  if (!src || typeof src !== 'object') return [];

  const roots = [
    src,
    src.data,
    src.data?.data,
    src.order,
    src.order?.data,
    src.order?.data?.data,
    src.entity,
    src.variables,
  ].filter((r) => r && typeof r === 'object');

  const nests = [];
  for (const root of roots) {
    nests.push(root);
    for (const group of FIELD_GROUPS) {
      if (root[group]) nests.push(root[group]);
    }
  }
  return nests;
}

export function pickOrderField(payload, slug) {
  const src = unwrapSalesRenderPayload(payload);
  if (!src || typeof src !== 'object') return null;

  for (const key of [slug, slug.toLowerCase()]) {
    if (src[key] != null) return src[key];
  }

  const target = slug.toLowerCase();
  for (const nest of fieldNests(payload)) {
    if (!Array.isArray(nest)) {
      if (nest[slug] != null) return nest[slug];
      if (nest[target] != null) return nest[target];
    } else {
      const hit = nest.find((f) => fieldUri(f).toLowerCase() === target);
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
      // GraphQL-вид вебхука SalesRender
      dig(payload, ['data', 'status', 'name']) ||
      dig(payload, ['data', 'statusName']) ||
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

/**
 * Сопоставление статуса заказа.
 *
 * Сначала по id — он надёжнее. По названию сверяем только если id не пришёл,
 * и строго: иначе «Ждет вручения» совпало бы с «Вручено».
 */
function statusMatches(payload, { id, namePart }) {
  const gotId = extractStatusId(payload);
  if (gotId != null && String(gotId).trim() !== '') {
    return Number(gotId) === Number(id);
  }
  const name = extractStatusName(payload).trim().toLowerCase();
  if (!name) return false;
  return name === namePart || name.startsWith(namePart);
}

/** «Принят» — по нему списывается базовый тариф за обзвон. */
export function isAcceptedStatus(payload, { statusId = SR_STATUS_ACCEPTED_ID } = {}) {
  return statusMatches(payload, { id: statusId, namePart: 'принят' });
}

/** «Вручено» — по нему списывается доплата за выкуп (если включён отдел выкупа). */
export function isDeliveredStatus(payload, { statusId = SR_STATUS_DELIVERED_ID } = {}) {
  return statusMatches(payload, { id: statusId, namePart: 'вручено' });
}

// Названия полей «апсейл» и «кроссейл» в SalesRender у разных клиентов
// отличаются, поэтому пробуем несколько вариантов. `apsejl` в список НЕ входит:
// в CRM пользователя это архивный дубль поля «Апсейл».
const CROSS_SLUGS = ['krossejl', 'crosssell', 'cross_sell', 'cross-sell', 'cross'];
const UPSELL_SLUGS = ['apseil', 'upsell', 'up_sell', 'up-sell', 'apsell'];

function anyFlag(payload, slugs) {
  return slugs.some((slug) => isTruthyFlag(pickOrderField(payload, slug)));
}

export function resolveCallAmountFlags(payload) {
  const cross = anyFlag(payload, CROSS_SLUGS);
  const upsell = anyFlag(payload, UPSELL_SLUGS);
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
 * Process SalesRender order webhook for one company.
 *
 * «Принят»  → базовый тариф за обзвон (3 BYN, либо 5 BYN с апсейлом/кроссейлом)
 * «Вручено» → доплата за выкуп (+1,50 BYN), только если у клиента включён
 *             «Отдел выкупа»
 *
 * Idempotent per order via crm_event_id.
 */
export async function processSalesRenderDelivered({
  companyId,
  payload,
  projectId = null,
  employeeName = null,
  acceptedStatusId = SR_STATUS_ACCEPTED_ID,
  deliveredStatusId = SR_STATUS_DELIVERED_ID,
}) {
  const statusId = extractStatusId(payload);
  const statusName = extractStatusName(payload);
  const flags = resolveCallAmountFlags(payload);

  const accepted = isAcceptedStatus(payload, { statusId: acceptedStatusId });
  const delivered = isDeliveredStatus(payload, { statusId: deliveredStatusId });

  if (!accepted && !delivered) {
    return { ok: true, skipped: true, reason: 'status_not_billable', statusId, statusName };
  }

  const orderId = extractOrderId(payload);
  if (!orderId) {
    throw new Error('В вебхуке нет orderId');
  }

  const charges = [];
  let usedProjectId = projectId;

  // 1. «Принят» — базовый тариф за обзвон.
  if (accepted) {
    const baseEventId = `sr-accepted-${orderId}`;
    // Заказы, списанные до перехода на «Принят», лежат под старым id —
    // учитываем его, чтобы не списать повторно.
    const legacyEventId = `sr-delivered-${orderId}`;
    const dup = await query(
      `SELECT id FROM transactions WHERE crm_event_id IN (:new_id, :legacy_id) LIMIT 1`,
      { new_id: baseEventId, legacy_id: legacyEventId },
    );

    if (dup.length) {
      charges.push({ skipped: true, duplicate: true, eventId: baseEventId });
    } else {
      const baseService = await loadService(flags.serviceCode);
      if (!baseService) {
        throw new Error(`Услуга ${flags.serviceCode} не найдена — выполните seed/migrate`);
      }

      // Баланс у клиента один, проект влияет только на цену — подбираем его по услуге.
      const resolved = await resolveTariffAndProject({
        companyId,
        projectId,
        serviceId: baseService.id,
      });
      if (!resolved.tariff) {
        throw new Error(
          `Тариф для услуги «${baseService.name}» не найден. ${await tariffMissingReason({ companyId })}`,
        );
      }
      usedProjectId = resolved.projectId;

      const crossLabel = [flags.cross ? 'кроссейл' : null, flags.upsell ? 'апсейл' : null]
        .filter(Boolean)
        .join('+');

      charges.push(
        await debitService({
          companyId,
          projectId: resolved.projectId,
          service: baseService,
          tariff: resolved.tariff,
          eventId: baseEventId,
          employeeName,
          comment:
            `SalesRender заказ #${orderId}: обзвон` +
            (crossLabel ? ` (${crossLabel})` : ' (без апс/кросс)'),
          orderId: String(orderId),
        }),
      );
    }
  }

  // 2. «Вручено» — доплата за выкупленный заказ.
  if (delivered) {
    const deliveredService = await loadService(SR_SERVICE_DELIVERED);
    if (deliveredService) {
      const companyRows = await query(
        'SELECT buyout_enabled FROM companies WHERE id = :id LIMIT 1',
        { id: companyId },
      );
      const buyoutEnabled = Number(companyRows[0]?.buyout_enabled || 0) === 1;

      if (buyoutEnabled) {
        const addEventId = `sr-delivered-bonus-${orderId}`;
        const addDup = await query(
          `SELECT id FROM transactions WHERE crm_event_id = :event_id LIMIT 1`,
          { event_id: addEventId },
        );

        if (addDup.length) {
          charges.push({ skipped: true, duplicate: true, eventId: addEventId });
        } else {
          const addOn = (
            await resolveTariffAndProject({
              companyId,
              projectId: usedProjectId,
              serviceId: deliveredService.id,
            })
          ).tariff;

          if (addOn) {
            charges.push(
              await debitService({
                companyId,
                projectId: usedProjectId,
                service: deliveredService,
                tariff: addOn,
                eventId: addEventId,
                employeeName,
                comment: `SalesRender заказ #${orderId}: выкуп (вручено)`,
                orderId: String(orderId),
              }),
            );
          } else {
            console.warn(
              `[salesrender] у компании ${companyId} включён отдел выкупа, но тариф ${SR_SERVICE_DELIVERED} не задан — доплата не списана`,
            );
          }
        }
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
    statusId,
    statusName,
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
