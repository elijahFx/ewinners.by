import { query } from '../db.js';

export async function listUserCompanies(userId) {
  return query(
    `SELECT c.*,
            (u.company_id = c.id) AS is_active
     FROM user_companies uc
     JOIN companies c ON c.id = uc.company_id
     JOIN users u ON u.id = uc.user_id
     WHERE uc.user_id = :user_id
     ORDER BY (u.company_id = c.id) DESC, c.name ASC`,
    { user_id: userId },
  );
}

export async function userHasCompany(userId, companyId) {
  if (!userId || !companyId) return false;
  const rows = await query(
    `SELECT 1 AS ok FROM user_companies
     WHERE user_id = :user_id AND company_id = :company_id
     LIMIT 1`,
    { user_id: userId, company_id: companyId },
  );
  return rows.length > 0;
}

export async function linkUserCompany(userId, companyId, { makeDefault = false } = {}) {
  await query(
    `INSERT INTO user_companies (user_id, company_id, is_default)
     VALUES (:user_id, :company_id, :is_default)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    {
      user_id: userId,
      company_id: companyId,
      is_default: makeDefault ? 1 : 0,
    },
  );
  if (makeDefault) {
    await query(`UPDATE users SET company_id = :company_id WHERE id = :user_id`, {
      company_id: companyId,
      user_id: userId,
    });
    await query(
      `UPDATE user_companies SET is_default = (company_id = :company_id)
       WHERE user_id = :user_id`,
      { company_id: companyId, user_id: userId },
    );
  }
}

export async function setActiveCompany(userId, companyId) {
  const ok = await userHasCompany(userId, companyId);
  if (!ok) throw new Error('Нет доступа к этой организации');
  await query(`UPDATE users SET company_id = :company_id WHERE id = :user_id`, {
    company_id: companyId,
    user_id: userId,
  });
  await query(
    `UPDATE user_companies SET is_default = (company_id = :company_id)
     WHERE user_id = :user_id`,
    { company_id: companyId, user_id: userId },
  );
}

export function mapCompany(c) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    unp: c.unp,
    entityType: c.entity_type || 'ooo',
    legalAddress: c.legal_address,
    bankName: c.bank_name,
    iban: c.iban,
    bic: c.bic,
    status: c.status,
    balance: Number(c.balance),
    creditLimit: Number(c.credit_limit),
    notifyThreshold: Number(c.notify_threshold),
    lowBalanceAction: c.low_balance_action,
    managerName: c.manager_name,
    managerPhone: c.manager_phone,
    managerEmail: c.manager_email,
    isActive: !!Number(c.is_active),
  };
}
