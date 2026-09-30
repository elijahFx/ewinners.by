import { Router } from 'express';
import { query } from '../db.js';
import { crmAuth, salesrenderWebhookAuth } from '../middleware/auth.js';
import {
  debitBalance,
  getEffectiveTariff,
  notifyCompanyUsers,
  tariffMissingReason,
} from '../services/billing.js';
import {
  ensureSalesRenderServices,
  processSalesRenderDelivered,
  SR_STATUS_ACCEPTED_ID,
  SR_STATUS_DELIVERED_ID,
} from '../services/salesrender.js';

const router = Router();

/**
 * SalesRender webhook по заказу.
 *
 * «Принят» (status id=2)   → базовый тариф за обзвон (3 BYN / 5 BYN с апсейлом)
 * «Вручено» (status id=5)  → доплата за выкуп (+1,50 BYN), если у клиента
 *                            включён «Отдел выкупа»
 *
 * Auth: SALESRENDER_API_KEY или api_key компании.
 * Только чтение payload — в CRM ничего не пишем.
 */
router.post('/salesrender/delivered', salesrenderWebhookAuth, async (req, res) => {
  const payload = req.body || {};
  const companyId = req.crmCompany.id;
  const eventIdHint = String(
    payload.eventId ||
      payload.crm_event_id ||
      (payload.orderId || payload.order_id || payload.id
        ? `sr-delivered-${payload.orderId || payload.order_id || payload.id}`
        : '') ||
      '',
  ).trim();

  try {
    await ensureSalesRenderServices();

    // В SalesRender клиенты заведены как «Проекты», поэтому поле projectId в
    // вебхуке обычно содержит ID проекта SalesRender, а не наш внутренний.
    // Если именно этим значением нашли компанию — как наш projectId не трактуем.
    const rawProjectId = payload.projectId ?? payload.project_id ?? null;
    const matchedSalesRenderId = String(req.salesrenderMatchedId || '');
    let projectId = null;

    if (
      rawProjectId != null &&
      String(rawProjectId).trim() !== '' &&
      String(rawProjectId) !== matchedSalesRenderId
    ) {
      const projects = await query(
        `SELECT id FROM projects WHERE id = :id AND company_id = :company_id`,
        { id: Number(rawProjectId), company_id: companyId },
      );
      if (!projects[0]) throw new Error(`Проект ${rawProjectId} не найден у клиента`);
      projectId = projects[0].id;
    }

    // Проект не указан — это не ошибка: проектов у клиента может быть несколько,
    // баланс у него один, а нужный прайс подберётся по услуге
    // (см. resolveTariffAndProject). Если проект ровно один — сразу его и пишем.
    if (!projectId) {
      const own = await query(
        'SELECT id FROM projects WHERE company_id = :company_id ORDER BY id',
        { company_id: companyId },
      );
      if (own.length === 1) projectId = own[0].id;
    }

    const result = await processSalesRenderDelivered({
      companyId,
      payload,
      projectId,
      employeeName: payload.employeeName || payload.operator || null,
      acceptedStatusId: Number(payload.acceptedStatusId || SR_STATUS_ACCEPTED_ID),
      deliveredStatusId: Number(payload.deliveredStatusId || SR_STATUS_DELIVERED_ID),
    });

    await query(
      `INSERT INTO crm_event_log (event_id, payload, status, error_message)
       VALUES (:event_id, :payload, :status, :error_message)`,
      {
        event_id: eventIdHint || result.eventId || result.orderId || null,
        payload: JSON.stringify({
          source: 'salesrender',
          authMode: req.salesrenderAuthMode || null,
          ...payload,
          companyId,
        }),
        status: result.duplicate ? 'duplicate' : result.skipped ? 'skipped' : 'processed',
        error_message: result.reason || null,
      },
    );

    res.json(result);
  } catch (err) {
    console.error('SalesRender webhook error:', err);
    await query(
      `INSERT INTO crm_event_log (event_id, payload, status, error_message)
       VALUES (:event_id, :payload, 'error', :error_message)`,
      {
        event_id: eventIdHint || null,
        payload: JSON.stringify({ source: 'salesrender', ...payload, companyId }),
        error_message: err.message || String(err),
      },
    );
    res.status(400).json({ error: err.message || 'Ошибка обработки SalesRender' });
  }
});

router.use(crmAuth);

function mapTx(row) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    amount: Number(row.amount),
    quantity: row.quantity != null ? Number(row.quantity) : null,
    unitPrice: row.unit_price != null ? Number(row.unit_price) : null,
    balanceAfter: Number(row.balance_after),
    serviceCode: row.service_code || null,
    serviceName: row.service_name || null,
    projectId: row.project_id,
    projectName: row.project_name || null,
    employeeName: row.employee_name,
    comment: row.comment,
    crmEventId: row.crm_event_id,
    createdAt: row.created_at,
  };
}

async function loadTransactions(companyId, { serviceCodes, limit = 100, from, to } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const params = { company_id: companyId };
  let sql = `SELECT t.*, s.code AS service_code, s.name AS service_name, p.name AS project_name
             FROM transactions t
             LEFT JOIN services s ON s.id = t.service_id
             LEFT JOIN projects p ON p.id = t.project_id
             WHERE t.company_id = :company_id AND t.status = 'posted'`;

  if (serviceCodes?.length) {
    sql += ` AND s.code IN (${serviceCodes.map((_, i) => `:sc${i}`).join(',')})`;
    serviceCodes.forEach((code, i) => {
      params[`sc${i}`] = code;
    });
  }
  if (from) {
    sql += ' AND t.created_at >= :from';
    params.from = from;
  }
  if (to) {
    sql += ' AND t.created_at <= :to';
    params.to = to;
  }

  sql += ` ORDER BY t.created_at DESC LIMIT ${lim}`;
  return query(sql, params);
}

/** Компания и баланс по API-ключу */
router.get('/me', async (req, res) => {
  const c = req.crmCompany;
  const balance = Number(c.balance);
  res.json({
    companyId: c.id,
    name: c.name,
    unp: c.unp,
    status: c.status,
    balance,
    creditLimit: Number(c.credit_limit),
    available: balance + Number(c.credit_limit || 0),
    notifyThreshold: Number(c.notify_threshold),
  });
});

router.get('/balance', async (req, res) => {
  const rows = await query(
    `SELECT id, balance, credit_limit, notify_threshold, status FROM companies WHERE id = :id`,
    { id: req.crmCompany.id },
  );
  const c = rows[0];
  const balance = Number(c.balance);
  res.json({
    companyId: c.id,
    balance,
    creditLimit: Number(c.credit_limit),
    available: balance + Number(c.credit_limit || 0),
    notifyThreshold: Number(c.notify_threshold),
    status: c.status,
  });
});

/** Проекты компании */
router.get('/projects', async (req, res) => {
  const rows = await query(
    `SELECT id, name, status, description, created_at
     FROM projects WHERE company_id = :company_id ORDER BY id DESC`,
    { company_id: req.crmCompany.id },
  );
  res.json({
    items: rows.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      description: p.description,
      createdAt: p.created_at,
    })),
  });
});

/** Все операции по компании */
router.get('/transactions', async (req, res) => {
  const rows = await loadTransactions(req.crmCompany.id, {
    limit: req.query.limit,
    from: req.query.from,
    to: req.query.to,
  });
  res.json({ items: rows.map(mapTx) });
});

/**
 * Звонки по вашим заказам/проектам
 * (списания по услуге call_minute)
 */
router.get('/calls', async (req, res) => {
  const rows = await loadTransactions(req.crmCompany.id, {
    serviceCodes: ['call_minute'],
    limit: req.query.limit,
    from: req.query.from,
    to: req.query.to,
  });
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      minutes: r.quantity != null ? Number(r.quantity) : null,
      amount: Number(r.amount),
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      projectId: r.project_id,
      projectName: r.project_name || null,
      employeeName: r.employee_name,
      comment: r.comment,
      crmEventId: r.crm_event_id,
      createdAt: r.created_at,
    })),
  });
});

/**
 * Заявки / лиды по вашим проектам
 */
router.get('/leads', async (req, res) => {
  const rows = await loadTransactions(req.crmCompany.id, {
    serviceCodes: ['confirmed_lead', 'processed_lead'],
    limit: req.query.limit,
    from: req.query.from,
    to: req.query.to,
  });
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      type: r.service_code,
      typeName: r.service_name,
      quantity: r.quantity != null ? Number(r.quantity) : 1,
      amount: Number(r.amount),
      projectId: r.project_id,
      projectName: r.project_name || null,
      employeeName: r.employee_name,
      comment: r.comment,
      crmEventId: r.crm_event_id,
      createdAt: r.created_at,
    })),
  });
});

/** Счета компании */
router.get('/invoices', async (req, res) => {
  const rows = await query(
    `SELECT id, number, amount, status, purpose, paid_amount, created_at, paid_at, project_id
     FROM invoices WHERE company_id = :company_id ORDER BY id DESC LIMIT 100`,
    { company_id: req.crmCompany.id },
  );
  res.json({
    items: rows.map((i) => ({
      id: i.id,
      number: i.number,
      amount: Number(i.amount),
      paidAmount: Number(i.paid_amount),
      status: i.status,
      purpose: i.purpose,
      projectId: i.project_id,
      createdAt: i.created_at,
      paidAt: i.paid_at,
    })),
  });
});

/** Справочник услуг и актуальные тарифы для компании */
router.get('/services', async (req, res) => {
  const services = await query(
    `SELECT id, code, name, unit, description FROM services WHERE is_active = 1 ORDER BY id`,
  );
  const items = [];
  for (const s of services) {
    const tariff = await getEffectiveTariff({
      companyId: req.crmCompany.id,
      projectId: req.query.projectId ? Number(req.query.projectId) : null,
      serviceId: s.id,
    });
    items.push({
      code: s.code,
      name: s.name,
      unit: s.unit,
      description: s.description,
      price: tariff ? Number(tariff.price) : null,
      billingType: tariff?.billing_type || null,
    });
  }
  res.json({ items });
});

/**
 * Списание за действие в CRM (идемпотентно по eventId)
 */
router.post('/events', async (req, res) => {
  const payload = req.body || {};
  const eventId = String(payload.eventId || payload.crm_event_id || '').trim();
  const companyId = req.crmCompany.id;

  try {
    if (!eventId) {
      await query(
        `INSERT INTO crm_event_log (event_id, payload, status, error_message)
         VALUES (NULL, :payload, 'error', 'eventId обязателен')`,
        { payload: JSON.stringify(payload) },
      );
      return res.status(400).json({ error: 'eventId обязателен' });
    }

    if (payload.companyId != null && Number(payload.companyId) !== companyId) {
      return res.status(403).json({
        error: 'companyId не совпадает с компанией API-ключа',
      });
    }

    const dup = await query(
      `SELECT id FROM transactions WHERE crm_event_id = :event_id LIMIT 1`,
      { event_id: eventId },
    );
    if (dup.length) {
      await query(
        `INSERT INTO crm_event_log (event_id, payload, status, error_message)
         VALUES (:event_id, :payload, 'duplicate', 'Повторное событие')`,
        { event_id: eventId, payload: JSON.stringify(payload) },
      );
      return res.json({ ok: true, duplicate: true });
    }

    const projectId = payload.projectId ? Number(payload.projectId) : null;
    const serviceCode = String(payload.serviceCode || '').trim();
    const quantity = Number(payload.quantity || 1);
    const employeeName = payload.employeeName || null;

    if (!serviceCode || !(quantity > 0)) {
      throw new Error('serviceCode и quantity обязательны');
    }

    if (projectId) {
      const projects = await query(
        `SELECT * FROM projects WHERE id = :id AND company_id = :company_id`,
        { id: projectId, company_id: companyId },
      );
      const project = projects[0];
      if (!project) throw new Error('Проект не найден');
      if (project.status === 'paused' && req.crmCompany.low_balance_action === 'hard_stop') {
        throw new Error('Проект приостановлен из-за баланса');
      }
    }

    const services = await query('SELECT * FROM services WHERE code = :code AND is_active = 1', {
      code: serviceCode,
    });
    const service = services[0];
    if (!service) throw new Error(`Услуга ${serviceCode} не найдена`);

    const tariff = await getEffectiveTariff({
      companyId,
      projectId,
      serviceId: service.id,
    });
    if (!tariff) {
      throw new Error(
        `Тариф для услуги «${service.name}» не найден. ${await tariffMissingReason({ companyId })}`,
      );
    }

    const unitPrice = Number(tariff.price);
    const amount = Number((unitPrice * quantity).toFixed(2));

    const result = await debitBalance({
      companyId,
      projectId,
      category: serviceCode === 'subscription' ? 'subscription' : 'crm_action',
      amount,
      serviceId: service.id,
      tariffId: tariff.id,
      quantity,
      unitPrice,
      crmEventId: eventId,
      employeeName,
      comment: payload.comment || `${service.name} × ${quantity}`,
    });

    await query(
      `INSERT INTO crm_event_log (event_id, payload, status)
       VALUES (:event_id, :payload, 'processed')`,
      { event_id: eventId, payload: JSON.stringify({ ...payload, companyId }) },
    );

    const updated = await query('SELECT balance, notify_threshold FROM companies WHERE id = :id', {
      id: companyId,
    });
    if (Number(updated[0].balance) <= Number(updated[0].notify_threshold)) {
      await notifyCompanyUsers(
        companyId,
        'Низкий баланс',
        `Текущий баланс: ${Number(updated[0].balance).toFixed(2)} BYN`,
      );
    }

    res.json({ ok: true, ...result, amount });
  } catch (err) {
    console.error(err);
    await query(
      `INSERT INTO crm_event_log (event_id, payload, status, error_message)
       VALUES (:event_id, :payload, 'error', :error_message)`,
      {
        event_id: eventId || null,
        payload: JSON.stringify(payload),
        error_message: err.message || String(err),
      },
    );
    res.status(400).json({ error: err.message || 'Ошибка обработки CRM события' });
  }
});

export default router;
