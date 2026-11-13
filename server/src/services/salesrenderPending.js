import { query, withTransaction } from '../db.js';
import { applyBalanceChange, isInsufficientFundsError } from './billing.js';

/**
 * «Пограничная зона» SalesRender.
 *
 * Если списание не проходит из-за лимита, заказ не теряется: он попадает сюда.
 * После пополнения баланса очередь разбирается в хронологическом порядке.
 * event_id совпадает с ключом идемпотентности транзакции (sr-accepted-…),
 * поэтому повторный вебхук и повторное списание не создают дубль.
 */

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function reasonFromError(err) {
  return err?.code === 'ERR_CREDIT_LIMIT' ? 'overdraft_limit' : 'insufficient_funds';
}

export async function pendingByEvent(eventId) {
  const rows = await query(
    `SELECT * FROM salesrender_pending_charges WHERE event_id = :event_id LIMIT 1`,
    { event_id: String(eventId) },
  );
  return rows[0] || null;
}

export async function pendingSummary(companyId) {
  const rows = await query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
       FROM salesrender_pending_charges
      WHERE company_id = :company_id AND status = 'pending'`,
    { company_id: companyId },
  );
  return {
    count: Number(rows[0]?.count || 0),
    amount: Number(rows[0]?.amount || 0),
  };
}

export async function queuePendingCharge({
  companyId,
  projectId = null,
  salesrenderProjectId = null,
  orderId,
  eventId,
  kind = 'accepted',
  serviceId = null,
  tariffId = null,
  amount,
  reason = null,
  employeeName = null,
  comment = null,
  payload = null,
  details = null,
}) {
  const event = String(eventId || '').trim();
  const order = String(orderId || '').trim();
  const value = Number(amount);
  if (!companyId || !event || !order || !(value > 0)) {
    throw new Error('Некорректные данные для пограничной зоны');
  }

  // Уже есть транзакция — заказ был списан, очередь не нужна.
  const paid = await query(
    `SELECT id FROM transactions WHERE crm_event_id = :event_id LIMIT 1`,
    { event_id: event },
  );
  if (paid[0]) {
    return { id: null, status: 'charged', duplicate: true, transactionId: paid[0].id };
  }

  const existing = await pendingByEvent(event);
  if (existing) {
    return { id: existing.id, status: existing.status, duplicate: true };
  }

  const result = await query(
    `INSERT INTO salesrender_pending_charges
      (company_id, project_id, salesrender_project_id, order_id, event_id, kind,
       service_id, tariff_id, amount, status, reason, employee_name, comment, payload, details,
       last_error)
     VALUES
      (:company_id, :project_id, :salesrender_project_id, :order_id, :event_id, :kind,
       :service_id, :tariff_id, :amount, 'pending', :reason, :employee_name, :comment, :payload, :details,
       :last_error)
     ON DUPLICATE KEY UPDATE
       amount = VALUES(amount),
       service_id = VALUES(service_id),
       tariff_id = VALUES(tariff_id),
       last_error = VALUES(last_error),
       updated_at = NOW()`,
    {
      company_id: companyId,
      project_id: projectId || null,
      salesrender_project_id: salesrenderProjectId ? String(salesrenderProjectId) : null,
      order_id: order,
      event_id: event,
      kind: kind === 'delivered' ? 'delivered' : 'accepted',
      service_id: serviceId || null,
      tariff_id: tariffId || null,
      amount: value,
      reason: reason || 'insufficient_funds',
      employee_name: employeeName || null,
      comment:
        comment ||
        `SalesRender заказ #${order}: ${kind === 'delivered' ? 'выкуп' : 'обзвон'} (пограничная зона)`,
      payload: payload ? JSON.stringify(payload) : null,
      details: details ? JSON.stringify(details) : null,
      last_error: null,
    },
  );

  const saved = await pendingByEvent(event);
  return { id: saved?.id || result.insertId, status: saved?.status || 'pending', duplicate: false };
}

async function chargeRow(row) {
  // Транзакция уже есть (например, вебхук успел списать) — только связываем.
  const paid = await query(
    `SELECT id FROM transactions WHERE crm_event_id = :event_id LIMIT 1`,
    { event_id: row.event_id },
  );
  if (paid[0]) {
    await query(
      `UPDATE salesrender_pending_charges
          SET status = 'charged', charged_at = NOW(), transaction_id = :transaction_id,
              last_error = NULL
        WHERE id = :id`,
      { id: row.id, transaction_id: paid[0].id },
    );
    return {
      ok: true,
      duplicate: true,
      transactionId: paid[0].id,
      companyId: row.company_id,
      amount: Number(row.amount),
    };
  }

  const details = parseJson(row.details) || {};
  try {
    const applied = await withTransaction((conn) =>
      applyBalanceChange({
        conn,
        companyId: row.company_id,
        projectId: row.project_id,
        type: 'debit',
        category: 'crm_action',
        amount: row.amount,
        serviceId: row.service_id,
        tariffId: row.tariff_id,
        quantity: 1,
        unitPrice: row.amount,
        crmEventId: row.event_id,
        employeeName: row.employee_name,
        comment: row.comment,
        clientOrderNumber: details.clientOrderNumber || null,
        customerName: details.customerName || null,
        customerPhone: details.customerPhone || null,
        cartTotal: details.cartTotal ?? null,
        isCross: details.isCross ? 1 : 0,
        isUpsell: details.isUpsell ? 1 : 0,
      }),
    );
    await query(
      `UPDATE salesrender_pending_charges
          SET status = 'charged', charged_at = NOW(), transaction_id = :transaction_id,
              last_error = NULL, attempts = attempts + 1
        WHERE id = :id`,
      { id: row.id, transaction_id: applied.transactionId },
    );
    return {
      ok: true,
      duplicate: false,
      transactionId: applied.transactionId,
      companyId: row.company_id,
      amount: Number(row.amount),
      balanceAfter: applied.balanceAfter,
    };
  } catch (err) {
    await query(
      `UPDATE salesrender_pending_charges
          SET attempts = attempts + 1, last_error = :last_error
        WHERE id = :id`,
      { id: row.id, last_error: String(err.message || err).slice(0, 2000) },
    );
    return {
      ok: false,
      error: err.message,
      stopped: isInsufficientFundsError(err),
      amount: Number(row.amount),
    };
  }
}

const draining = new Set();

/**
 * Разбирает очередь компании по порядку. Останавливается на первом заказе,
 * который не проходит по балансу, — более поздние не перескакивают очередь.
 */
export async function drainPendingCharges(companyId) {
  const id = Number(companyId);
  if (!id) return { charged: 0, amount: 0, stopped: false, remaining: 0 };
  if (draining.has(id)) return { charged: 0, amount: 0, stopped: false, remaining: 0, skipped: true };
  draining.add(id);
  try {
    const rows = await query(
      `SELECT * FROM salesrender_pending_charges
        WHERE company_id = :company_id AND status = 'pending'
        ORDER BY created_at ASC, id ASC`,
      { company_id: id },
    );
    let charged = 0;
    let amount = 0;
    let stopped = false;
    let lastError = null;
    for (const row of rows) {
      const result = await chargeRow(row);
      if (!result.ok) {
        stopped = true;
        lastError = result.error;
        break;
      }
      charged += 1;
      amount += result.amount || 0;
    }
    const remaining = await pendingSummary(id);
    return {
      charged,
      amount: Number(amount.toFixed(2)),
      stopped,
      remaining: remaining.count,
      remainingAmount: remaining.amount,
      lastError,
    };
  } finally {
    draining.delete(id);
  }
}

export async function chargePendingById(id) {
  const rows = await query(
    `SELECT * FROM salesrender_pending_charges WHERE id = :id LIMIT 1`,
    { id: Number(id) },
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('Запись пограничной зоны не найдена');
    err.status = 404;
    throw err;
  }
  if (row.status !== 'pending') {
    const err = new Error(`Заказ уже в статусе ${row.status}`);
    err.status = 400;
    throw err;
  }
  return chargeRow(row);
}

export async function cancelPendingCharge(id, { reason = '', userId = null } = {}) {
  const rows = await query(
    `SELECT * FROM salesrender_pending_charges WHERE id = :id LIMIT 1`,
    { id: Number(id) },
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('Запись пограничной зоны не найдена');
    err.status = 404;
    throw err;
  }
  if (row.status === 'charged') {
    const err = new Error('Заказ уже списан, отменить нельзя');
    err.status = 400;
    throw err;
  }
  await query(
    `UPDATE salesrender_pending_charges
        SET status = 'canceled', canceled_at = NOW(), canceled_by = :user_id,
            last_error = :reason
      WHERE id = :id`,
    { id: row.id, user_id: userId, reason: String(reason || 'Отменено администратором').slice(0, 2000) },
  );
  return { id: row.id, status: 'canceled', companyId: row.company_id };
}

export async function listPendingCharges({ companyId = null, status = 'pending', limit = 200 } = {}) {
  const params = { limit: Math.min(Math.max(Number(limit) || 200, 1), 1000) };
  let where = 'WHERE 1 = 1';
  if (companyId) {
    where += ' AND p.company_id = :company_id';
    params.company_id = Number(companyId);
  }
  if (status) {
    where += ' AND p.status = :status';
    params.status = String(status);
  }
  const rows = await query(
    `SELECT p.*, c.name AS company_name,
            c.balance AS company_balance, c.credit_limit AS company_credit_limit
       FROM salesrender_pending_charges p
       JOIN companies c ON c.id = p.company_id
       ${where}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT :limit`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    details: parseJson(row.details),
    payload: parseJson(row.payload),
  }));
}
