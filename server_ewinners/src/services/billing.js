import { query, withTransaction } from '../db.js';

export async function getEffectiveTariff({ companyId, projectId, serviceId, at = new Date() }) {
  const date = at.toISOString().slice(0, 10);
  const rows = await query(
    `SELECT t.*
     FROM tariffs t
     WHERE t.service_id = :service_id
       AND t.valid_from <= :date
       AND (t.valid_to IS NULL OR t.valid_to >= :date)
       AND (
         (t.company_id = :company_id AND t.project_id = :project_id)
         OR (t.company_id = :company_id AND t.project_id IS NULL)
         OR (t.company_id IS NULL AND t.project_id IS NULL)
       )
     ORDER BY
       (t.project_id IS NOT NULL) DESC,
       (t.company_id IS NOT NULL) DESC,
       t.valid_from DESC
     LIMIT 1`,
    {
      service_id: serviceId,
      company_id: companyId,
      project_id: projectId || null,
      date,
    },
  );
  return rows[0] || null;
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

export async function notifyCompanyUsers(companyId, title, body) {
  const users = await query(
    `SELECT id FROM users WHERE company_id = :company_id AND status = 'active'`,
    { company_id: companyId },
  );
  for (const u of users) {
    await query(
      `INSERT INTO notifications (user_id, title, body) VALUES (:user_id, :title, :body)`,
      { user_id: u.id, title, body },
    );
  }
}

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
