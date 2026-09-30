import { query, withTransaction } from '../db.js';
import { emitBalanceChanged } from './balanceEvents.js';

/**
 * Подбор действующего тарифа.
 *
 * Обычный режим, по убыванию приоритета:
 *   компания + проект → компания → проект → общий
 *
 * Режим индивидуального прайса: если у компании есть хотя бы один свой
 * действующий тариф, он считается её полным прайсом. Общие и проектные цены
 * такому клиенту не подмешиваются — если услуги в прайсе нет, вернётся null
 * (см. tariffMissingReason для понятного текста ошибки).
 */
export async function getEffectiveTariff({ companyId, projectId, serviceId, at = new Date() }) {
  const date = at.toISOString().slice(0, 10);
  const pid = projectId || null;

  if (companyId) {
    const own = await query(
      `SELECT t.*
       FROM tariffs t
       WHERE t.service_id = :service_id
         AND t.company_id = :company_id
         AND (t.project_id = :project_id OR t.project_id IS NULL)
         AND t.valid_from <= :date
         AND (t.valid_to IS NULL OR t.valid_to >= :date)
       ORDER BY (t.project_id IS NOT NULL) DESC, t.valid_from DESC
       LIMIT 1`,
      { service_id: serviceId, company_id: companyId, project_id: pid, date },
    );
    if (own[0]) return own[0];

    // Услуги в личном прайсе нет. Если личный прайс вообще есть — общие цены
    // этому клиенту не применяются.
    const hasOwnPriceList = await query(
      `SELECT 1 FROM tariffs
       WHERE company_id = :company_id
         AND valid_from <= :date
         AND (valid_to IS NULL OR valid_to >= :date)
       LIMIT 1`,
      { company_id: companyId, date },
    );
    if (hasOwnPriceList.length) return null;
  }

  const rows = await query(
    `SELECT t.*
     FROM tariffs t
     WHERE t.service_id = :service_id
       AND t.company_id IS NULL
       AND (t.project_id = :project_id OR t.project_id IS NULL)
       AND t.valid_from <= :date
       AND (t.valid_to IS NULL OR t.valid_to >= :date)
     ORDER BY (t.project_id IS NOT NULL) DESC, t.valid_from DESC
     LIMIT 1`,
    { service_id: serviceId, project_id: pid, date },
  );
  return rows[0] || null;
}

/** Понятное объяснение, почему тариф не нашёлся. */
export async function tariffMissingReason({ companyId, at = new Date() }) {
  if (companyId) {
    const date = at.toISOString().slice(0, 10);
    const own = await query(
      `SELECT 1 FROM tariffs
       WHERE company_id = :company_id
         AND valid_from <= :date
         AND (valid_to IS NULL OR valid_to >= :date)
       LIMIT 1`,
      { company_id: companyId, date },
    );
    if (own.length) {
      return 'У клиента индивидуальный прайс, общие цены для него не применяются — добавьте эту услугу в его прайс в разделе «Тарифы».';
    }
  }
  return 'Задайте тариф для проекта или общий тариф в разделе «Тарифы».';
}

/**
 * Подбор тарифа вместе с проектом.
 *
 * Баланс у клиента один, поэтому проект влияет только на цену. Если проект не
 * задан явно, ищем среди проектов клиента тот, в чьём прайсе есть эта услуга —
 * так заказ с несколькими проектами у клиента не ломает списание.
 */
export async function resolveTariffAndProject({
  companyId,
  projectId = null,
  serviceId,
  at = new Date(),
}) {
  if (projectId) {
    const tariff = await getEffectiveTariff({ companyId, projectId, serviceId, at });
    if (tariff) return { tariff, projectId };
  }

  const projects = await query(
    'SELECT id FROM projects WHERE company_id = :company_id ORDER BY id',
    { company_id: companyId },
  );
  for (const p of projects) {
    const tariff = await getEffectiveTariff({ companyId, projectId: p.id, serviceId, at });
    if (tariff) return { tariff, projectId: p.id };
  }

  const fallback = await getEffectiveTariff({ companyId, projectId: null, serviceId, at });
  return { tariff: fallback, projectId: projectId || null };
}

export async function applyBalanceChange({
  conn,
  companyId,
  projectId = null,
  invoiceId = null,
  type,
  category,
  amount,
  serviceId = null,
  tariffId = null,
  quantity = null,
  unitPrice = null,
  crmEventId = null,
  employeeName = null,
  comment = null,
  createdBy = null,
}) {
  const absAmount = Math.abs(Number(amount));
  if (!(absAmount > 0)) throw new Error('Сумма должна быть больше нуля');

  const exec = async (sql, params) => {
    const [rows] = await conn.execute(sql, params);
    return rows;
  };

  const companies = await exec(
    'SELECT id, balance, credit_limit, low_balance_action, status FROM companies WHERE id = ? FOR UPDATE',
    [companyId],
  );
  const company = companies[0];
  if (!company) throw new Error('Компания не найдена');

  const balanceBefore = Number(company.balance);
  const signed = type === 'credit' ? absAmount : -absAmount;
  const balanceAfter = Number((balanceBefore + signed).toFixed(2));

  if (type === 'debit') {
    const floor = -Number(company.credit_limit || 0);
    if (company.low_balance_action === 'hard_stop' && balanceAfter < 0) {
      throw new Error('Недостаточно средств на балансе');
    }
    if (company.low_balance_action === 'allow_credit' && balanceAfter < floor) {
      throw new Error('Превышен кредитный лимит');
    }
  }

  await exec('UPDATE companies SET balance = ? WHERE id = ?', [balanceAfter, companyId]);

  const result = await exec(
    `INSERT INTO transactions
      (company_id, project_id, invoice_id, type, category, amount, balance_before, balance_after,
       service_id, tariff_id, quantity, unit_price, crm_event_id, employee_name, comment, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      projectId,
      invoiceId,
      type,
      category,
      absAmount,
      balanceBefore,
      balanceAfter,
      serviceId,
      tariffId,
      quantity,
      unitPrice,
      crmEventId,
      employeeName,
      comment,
      createdBy,
    ],
  );

  if (balanceAfter <= 0 && company.low_balance_action === 'hard_stop') {
    await exec(`UPDATE projects SET status = 'paused' WHERE company_id = ? AND status = 'active'`, [
      companyId,
    ]);
    await exec(`UPDATE companies SET status = 'suspended' WHERE id = ?`, [companyId]);
  }

  // Сигнал фронту: баланс изменился. Событие уходит всем, кто видит этого
  // клиента (он сам и сотрудники), и просто просит перечитать данные.
  emitBalanceChanged({ companyId, balanceAfter, reason: category || type });

  return {
    transactionId: result.insertId,
    balanceBefore,
    balanceAfter,
  };
}

export async function creditBalance(params) {
  return withTransaction((conn) => applyBalanceChange({ ...params, conn, type: 'credit' }));
}

export async function debitBalance(params) {
  return withTransaction((conn) => applyBalanceChange({ ...params, conn, type: 'debit' }));
}

export { notifyCompanyUsers } from './notify.js';

export { emitBalanceChanged } from './balanceEvents.js';

export async function audit(userId, action, entityType, entityId, details) {
  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
     VALUES (:user_id, :action, :entity_type, :entity_id, :details)`,
    {
      user_id: userId || null,
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      details: JSON.stringify(details || {}),
    },
  );
}
