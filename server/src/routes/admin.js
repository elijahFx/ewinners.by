import { Router } from 'express';
import bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import fs from 'fs';
import path from 'path';
import { query, withTransaction } from '../db.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import {
  applyBalanceChange,
  audit,
  notifyCompanyUsers,
} from '../services/billing.js';
import { generateStrongPassword } from '../services/passwords.js';
import { absoluteAvatarPath, createAvatarUpload } from '../services/avatars.js';
import { setCompanyApiKey } from '../services/apiKeys.js';
import {
  createPlaceholderPasswordHash,
  isMailConfigured,
  sendInviteEmail,
} from '../services/authMail.js';
import { linkUserCompany, unlinkUserCompany, listUserCompanies, mapCompany } from '../services/userCompanies.js';
import {
  fetchMtbankStatement,
  getMtbankStatus,
  summarizeMovements,
} from '../services/mtbank.js';
import { syncMtbankPayments } from '../services/bankSync.js';
import { markInvoicePaid } from '../services/invoicePayment.js';
import { generateInvoicePdf } from '../services/invoicePdf.js';

async function loadInvoicePdf(invoice) {
  const companies = await query('SELECT * FROM companies WHERE id = :id LIMIT 1', {
    id: invoice.company_id,
  });
  const company = companies[0];
  if (!company) {
    const err = new Error('Компания не найдена');
    err.status = 404;
    throw err;
  }
  const { filePath, fileName } = await generateInvoicePdf({
    number: invoice.number,
    amount: invoice.amount,
    purpose: invoice.purpose,
    company,
    createdAt: dayjs(invoice.created_at).format('DD.MM.YYYY'),
  });
  await query('UPDATE invoices SET file_path = :file_path WHERE id = :id', {
    file_path: filePath,
    id: invoice.id,
  });
  return { filePath, fileName, company };
}

function bankPaymentDateExpr() {
  return 'COALESCE(bp.operation_date, DATE(bp.imported_at))';
}

function buildBankPaymentsFilter(req) {
  const params = {};
  let where = ' WHERE 1=1';
  const direction = req.query.direction;
  if (direction === 'income' || direction === 'expense') {
    where += ' AND bp.direction = :direction';
    params.direction = direction;
  }
  if (req.query.status) {
    where += ' AND bp.status = :status';
    params.status = String(req.query.status);
  }
  if (req.query.companyId) {
    where += ' AND bp.company_id = :company_id';
    params.company_id = Number(req.query.companyId);
  }
  if (req.query.from) {
    where += ` AND ${bankPaymentDateExpr()} >= :from_date`;
    params.from_date = String(req.query.from).slice(0, 10);
  }
  if (req.query.to) {
    where += ` AND ${bankPaymentDateExpr()} <= :to_date`;
    params.to_date = String(req.query.to).slice(0, 10);
  }
  const q = String(req.query.q || '').trim();
  if (q) {
    where += ` AND (
      bp.payer_name LIKE :q OR bp.payer_unp LIKE :q OR bp.purpose LIKE :q
      OR bp.reference LIKE :q OR c.name LIKE :q OR i.number LIKE :q
    )`;
    params.q = `%${q}%`;
  }
  return { where, params };
}

const router = Router();
router.use(authRequired, requireRoles('admin', 'accountant'));
const adminAvatarUpload = createAvatarUpload((req) => req.params.id);

router.get('/overview', async (_req, res) => {
  try {
    const [companies] = await query('SELECT COUNT(*) AS c FROM companies');
    const [users] = await query('SELECT COUNT(*) AS c FROM users');
    const [low] = await query(
      `SELECT COUNT(*) AS c FROM companies WHERE balance <= notify_threshold`,
    );
    const [balances] = await query('SELECT COALESCE(SUM(balance),0) AS total FROM companies');
    const recentTx = await query(
      `SELECT t.*, c.name AS company_name
       FROM transactions t
       JOIN companies c ON c.id = t.company_id
       ORDER BY t.created_at DESC LIMIT 20`,
    );
    res.json({
      companies: Number(companies.c),
      users: Number(users.c),
      lowBalanceCompanies: Number(low.c),
      totalBalances: Number(balances.total),
      recentTx,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка overview' });
  }
});

router.get('/companies', async (_req, res) => {
  // has_own_tariffs = у клиента индивидуальный прайс (общие цены ему не применяются)
  const rows = await query(
    `SELECT c.*,
            EXISTS (
              SELECT 1 FROM tariffs t
              WHERE t.company_id = c.id
                AND t.valid_from <= CURDATE()
                AND (t.valid_to IS NULL OR t.valid_to >= CURDATE())
            ) AS has_own_tariffs
     FROM companies c
     ORDER BY c.id DESC`,
  );
  res.json({ items: rows });
});

router.post('/companies', requireRoles('admin'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Укажите название компании' });

    const result = await query(
      `INSERT INTO companies
        (name, unp, legal_address, bank_name, iban, bic, credit_limit, min_balance, notify_threshold,
         low_balance_action, buyout_enabled, manager_name, manager_phone, manager_email)
       VALUES
        (:name, :unp, :legal_address, :bank_name, :iban, :bic, :credit_limit, :min_balance, :notify_threshold,
         :low_balance_action, :buyout_enabled, :manager_name, :manager_phone, :manager_email)`,
      {
        name,
        unp: req.body.unp || null,
        legal_address: req.body.legalAddress || null,
        bank_name: req.body.bankName || null,
        iban: req.body.iban || null,
        bic: req.body.bic || null,
        credit_limit: Number(req.body.creditLimit || 0),
        min_balance: Number(req.body.minBalance || 0),
        notify_threshold: Number(req.body.notifyThreshold || 500),
        low_balance_action: req.body.lowBalanceAction || 'allow_credit',
        buyout_enabled: req.body.buyoutEnabled ? 1 : 0,
        manager_name: req.body.managerName || null,
        manager_phone: req.body.managerPhone || null,
        manager_email: req.body.managerEmail || null,
      },
    );
    await audit(req.user.id, 'create_company', 'company', result.insertId, { name });
    const rows = await query('SELECT * FROM companies WHERE id = :id', { id: result.insertId });
    res.status(201).json({ company: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать компанию' });
  }
});

router.patch('/companies/:id', requireRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(
      `UPDATE companies SET
         name = COALESCE(:name, name),
         unp = COALESCE(:unp, unp),
         legal_address = COALESCE(:legal_address, legal_address),
         bank_name = COALESCE(:bank_name, bank_name),
         iban = COALESCE(:iban, iban),
         bic = COALESCE(:bic, bic),
         status = COALESCE(:status, status),
         credit_limit = COALESCE(:credit_limit, credit_limit),
         min_balance = COALESCE(:min_balance, min_balance),
         notify_threshold = COALESCE(:notify_threshold, notify_threshold),
         low_balance_action = COALESCE(:low_balance_action, low_balance_action),
         buyout_enabled = COALESCE(:buyout_enabled, buyout_enabled),
         manager_name = COALESCE(:manager_name, manager_name),
         manager_phone = COALESCE(:manager_phone, manager_phone),
         manager_email = COALESCE(:manager_email, manager_email)
       WHERE id = :id`,
      {
        id,
        name: req.body.name ?? null,
        unp: req.body.unp ?? null,
        legal_address: req.body.legalAddress ?? null,
        bank_name: req.body.bankName ?? null,
        iban: req.body.iban ?? null,
        bic: req.body.bic ?? null,
        status: req.body.status ?? null,
        credit_limit: req.body.creditLimit ?? null,
        min_balance: req.body.minBalance ?? null,
        notify_threshold: req.body.notifyThreshold ?? null,
        low_balance_action: req.body.lowBalanceAction ?? null,
        // Галочка «Отдел выкупа»: +1,50 BYN за выкупленный заказ.
        buyout_enabled:
          req.body.buyoutEnabled === undefined ? null : req.body.buyoutEnabled ? 1 : 0,
        manager_name: req.body.managerName ?? null,
        manager_phone: req.body.managerPhone ?? null,
        manager_email: req.body.managerEmail ?? null,
      },
    );
    await audit(req.user.id, 'update_company', 'company', id, req.body);
    const rows = await query('SELECT * FROM companies WHERE id = :id', { id });
    res.json({ company: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось обновить компанию' });
  }
});

router.get('/users', async (_req, res) => {
  const rows = await query(
    `SELECT u.id, u.email, u.phone, u.full_name, u.avatar_url, u.role, u.status, u.company_id, u.created_at,
            c.name AS company_name,
            (
              SELECT COUNT(*) FROM user_companies uc WHERE uc.user_id = u.id
            ) AS companies_count
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     ORDER BY u.id DESC`,
  );
  res.json({ items: rows });
});

router.get('/users/:id/companies', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const user = await query('SELECT id, role FROM users WHERE id = :id LIMIT 1', { id });
    if (!user[0]) return res.status(404).json({ error: 'Пользователь не найден' });
    const rows = await listUserCompanies(id);
    res.json({
      items: rows.map(mapCompany),
      activeCompanyId: rows.find((r) => Number(r.is_active))?.id || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить организации пользователя' });
  }
});

router.post('/users/:id/companies', requireRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = Number(req.body.companyId);
    if (!companyId) return res.status(400).json({ error: 'Укажите companyId' });

    const user = await query('SELECT id, company_id, role FROM users WHERE id = :id LIMIT 1', { id });
    if (!user[0]) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user[0].role !== 'client') {
      return res.status(400).json({ error: 'Организации привязываются только к клиентам' });
    }

    const company = await query('SELECT id, name FROM companies WHERE id = :id LIMIT 1', {
      id: companyId,
    });
    if (!company[0]) return res.status(404).json({ error: 'Компания не найдена' });

    const makeDefault = !!req.body.makeDefault || !user[0].company_id;
    await linkUserCompany(id, companyId, { makeDefault });
    await audit(req.user.id, 'link_user_company', 'user', id, { companyId, makeDefault });

    const rows = await listUserCompanies(id);
    res.status(201).json({
      items: rows.map(mapCompany),
      activeCompanyId: rows.find((r) => Number(r.is_active))?.id || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Не удалось привязать организацию' });
  }
});

router.delete('/users/:id/companies/:companyId', requireRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = Number(req.params.companyId);
    const user = await query('SELECT id FROM users WHERE id = :id LIMIT 1', { id });
    if (!user[0]) return res.status(404).json({ error: 'Пользователь не найден' });

    await unlinkUserCompany(id, companyId);
    await audit(req.user.id, 'unlink_user_company', 'user', id, { companyId });

    const rows = await listUserCompanies(id);
    res.json({
      items: rows.map(mapCompany),
      activeCompanyId: rows.find((r) => Number(r.is_active))?.id || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Не удалось отвязать организацию' });
  }
});

router.post('/users', requireRoles('admin'), async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const fullName = String(req.body.fullName || '').trim();
    const role = req.body.role || 'client';
    const passwordMode = req.body.passwordMode || 'invite';
    const sendInvite = req.body.sendInvite !== false && passwordMode !== 'manual';
    let password = String(req.body.password || '');
    let mustSetPassword = !!req.body.mustSetPassword;

    if (!email || !fullName) return res.status(400).json({ error: 'Email и ФИО обязательны' });

    let passwordHash;
    let temporaryPassword = null;
    let status = req.body.status || 'active';

    if (passwordMode === 'invite' || (sendInvite && passwordMode === 'auto')) {
      passwordHash = await createPlaceholderPasswordHash();
      mustSetPassword = true;
      status = 'invited';
      const result = await query(
        `INSERT INTO users (email, phone, password_hash, full_name, role, company_id, status, must_set_password)
         VALUES (:email, :phone, :password_hash, :full_name, :role, :company_id, :status, :must_set_password)`,
        {
          email,
          phone: req.body.phone || null,
          password_hash: passwordHash,
          full_name: fullName,
          role,
          company_id: req.body.companyId || null,
          status,
          must_set_password: 1,
        },
      );
      await audit(req.user.id, 'create_user', 'user', result.insertId, {
        email,
        role,
        passwordMode: 'invite',
      });
      if (req.body.companyId) {
        await linkUserCompany(result.insertId, Number(req.body.companyId), { makeDefault: true });
      }

      let inviteSent = false;
      let inviteError = null;
      try {
        if (!isMailConfigured()) throw new Error('SMTP не настроен');
        await sendInviteEmail(
          { id: result.insertId, email, full_name: fullName },
          { invitedBy: req.user.email },
        );
        inviteSent = true;
      } catch (err) {
        inviteError = err.message;
        console.warn('Invite email failed:', err.message);
      }

      return res.status(201).json({
        id: result.insertId,
        email,
        passwordMode: 'invite',
        inviteSent,
        inviteError,
        status: 'invited',
      });
    }

    if (passwordMode === 'auto' || (passwordMode === 'generate' && !password) || (!password && passwordMode !== 'manual')) {
      password = generateStrongPassword();
    }
    if (passwordMode === 'auto') mustSetPassword = true;
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
    }

    passwordHash = await bcrypt.hash(password, 12);
    temporaryPassword = password;
    const result = await query(
      `INSERT INTO users (email, phone, password_hash, full_name, role, company_id, status, must_set_password)
       VALUES (:email, :phone, :password_hash, :full_name, :role, :company_id, :status, :must_set_password)`,
      {
        email,
        phone: req.body.phone || null,
        password_hash: passwordHash,
        full_name: fullName,
        role,
        company_id: req.body.companyId || null,
        status,
        must_set_password: mustSetPassword ? 1 : 0,
      },
    );
    await audit(req.user.id, 'create_user', 'user', result.insertId, { email, role, passwordMode });
    if (req.body.companyId) {
      await linkUserCompany(result.insertId, Number(req.body.companyId), { makeDefault: true });
    }
    res.status(201).json({
      id: result.insertId,
      email,
      temporaryPassword,
      passwordMode,
    });
  } catch (err) {
    console.error(err);
    if (String(err.message).includes('Duplicate')) {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }
    res.status(500).json({ error: 'Не удалось создать пользователя' });
  }
});

router.post('/users/:id/invite', requireRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await query(`SELECT * FROM users WHERE id = :id LIMIT 1`, { id });
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.status === 'blocked') {
      return res.status(400).json({ error: 'Нельзя пригласить заблокированного пользователя' });
    }

    if (!isMailConfigured()) {
      return res.status(503).json({ error: 'SMTP не настроен' });
    }

    if (user.status === 'invited' || user.must_set_password) {
      await query(`UPDATE users SET status = 'invited', must_set_password = 1 WHERE id = :id`, {
        id,
      });
    }

    await sendInviteEmail(user, { invitedBy: req.user.email });
    await audit(req.user.id, 'send_invite', 'user', id, { email: user.email });
    res.json({ ok: true, inviteSent: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Не удалось отправить приглашение' });
  }
});

router.patch('/users/:id', requireRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await query('SELECT * FROM users WHERE id = :id LIMIT 1', { id });
    if (!existing[0]) return res.status(404).json({ error: 'Пользователь не найден' });

    const email = req.body.email != null
      ? String(req.body.email).trim().toLowerCase()
      : existing[0].email;
    const fullName = req.body.fullName != null
      ? String(req.body.fullName).trim()
      : existing[0].full_name;
    const phone = req.body.phone !== undefined ? (req.body.phone || null) : existing[0].phone;
    const role = req.body.role || existing[0].role;
    const status = req.body.status || existing[0].status;
    const companyId = req.body.companyId !== undefined
      ? (req.body.companyId ? Number(req.body.companyId) : null)
      : existing[0].company_id;

    let passwordHash = existing[0].password_hash;
    let temporaryPassword = null;
    let mustSetPassword = existing[0].must_set_password;
    let bumpToken = false;

    if (req.body.passwordMode === 'auto') {
      temporaryPassword = generateStrongPassword();
      passwordHash = await bcrypt.hash(temporaryPassword, 12);
      mustSetPassword = 1;
      bumpToken = true;
    } else if (req.body.passwordMode === 'generate') {
      temporaryPassword = String(req.body.password || '') || generateStrongPassword();
      passwordHash = await bcrypt.hash(temporaryPassword, 12);
      mustSetPassword = req.body.mustSetPassword ? 1 : 0;
      bumpToken = true;
    } else if (req.body.password) {
      if (String(req.body.password).length < 8) {
        return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
      }
      temporaryPassword = String(req.body.password);
      passwordHash = await bcrypt.hash(temporaryPassword, 12);
      mustSetPassword = req.body.mustSetPassword ? 1 : 0;
      bumpToken = true;
    }

    await query(
      `UPDATE users SET
         email = :email,
         phone = :phone,
         full_name = :full_name,
         role = :role,
         status = :status,
         company_id = :company_id,
         password_hash = :password_hash,
         must_set_password = :must_set_password,
         token_version = token_version + :bump
       WHERE id = :id`,
      {
        id,
        email,
        phone,
        full_name: fullName,
        role,
        status,
        company_id: companyId,
        password_hash: passwordHash,
        must_set_password: mustSetPassword ? 1 : 0,
        bump: bumpToken ? 1 : 0,
      },
    );

    if (companyId) {
      await linkUserCompany(id, companyId, { makeDefault: true });
    }

    await audit(req.user.id, 'update_user', 'user', id, {
      email,
      role,
      status,
      companyId,
      passwordChanged: Boolean(temporaryPassword),
    });

    const rows = await query(
      `SELECT u.id, u.email, u.phone, u.full_name, u.avatar_url, u.role, u.status, u.company_id, c.name AS company_name
       FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = :id`,
      { id },
    );
    res.json({ user: rows[0], temporaryPassword });
  } catch (err) {
    console.error(err);
    if (String(err.message).includes('Duplicate')) {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }
    res.status(500).json({ error: 'Не удалось обновить пользователя' });
  }
});

router.delete('/users/:id', requireRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Нельзя удалить собственный аккаунт' });
    }
    const existing = await query('SELECT id, email FROM users WHERE id = :id LIMIT 1', { id });
    if (!existing[0]) return res.status(404).json({ error: 'Пользователь не найден' });

    await query('DELETE FROM users WHERE id = :id', { id });
    await audit(req.user.id, 'delete_user', 'user', id, { email: existing[0].email });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось удалить пользователя' });
  }
});

router.post('/users/:id/avatar', requireRoles('admin'), (req, res) => {
  adminAvatarUpload.single('avatar')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
      if (!req.file) return res.status(400).json({ error: 'Выберите файл изображения' });
      const id = Number(req.params.id);
      const existing = await query('SELECT id, avatar_url FROM users WHERE id = :id LIMIT 1', { id });
      if (!existing[0]) return res.status(404).json({ error: 'Пользователь не найден' });

      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      await query('UPDATE users SET avatar_url = :avatar_url WHERE id = :id', {
        avatar_url: avatarUrl,
        id,
      });
      const oldPath = absoluteAvatarPath(existing[0].avatar_url);
      if (oldPath) fs.promises.unlink(oldPath).catch(() => {});
      await audit(req.user.id, 'admin_upload_avatar', 'user', id, { avatarUrl });
      res.json({ avatarUrl });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Не удалось сохранить аватар' });
    }
  });
});

router.patch('/users/:id/status', requireRoles('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!['active', 'blocked', 'invited'].includes(status)) {
    return res.status(400).json({ error: 'Некорректный статус' });
  }
  await query(
    `UPDATE users SET status = :status, token_version = token_version + 1 WHERE id = :id`,
    { id, status },
  );
  await audit(req.user.id, 'update_user_status', 'user', id, { status });
  res.json({ ok: true });
});

router.get('/projects', async (req, res) => {
  const params = {};
  let sql = `SELECT p.*, c.name AS company_name,
                    (SELECT COUNT(*) FROM tariffs t
                      WHERE t.project_id = p.id
                        AND t.company_id IS NULL
                        AND t.valid_to IS NULL
                        AND t.valid_from <= CURDATE()) AS tariffs_count
             FROM projects p JOIN companies c ON c.id = p.company_id WHERE 1=1`;
  if (req.query.companyId) {
    sql += ' AND p.company_id = :company_id';
    params.company_id = Number(req.query.companyId);
  }
  sql += ' ORDER BY p.id DESC';
  const rows = await query(sql, params);
  res.json({ items: rows });
});

router.post('/projects', requireRoles('admin'), async (req, res) => {
  try {
    const companyId = Number(req.body.companyId);
    const name = String(req.body.name || '').trim();
    if (!companyId || !name) return res.status(400).json({ error: 'companyId и name обязательны' });
    const result = await query(
      `INSERT INTO projects (company_id, name, status, description)
       VALUES (:company_id, :name, :status, :description)`,
      {
        company_id: companyId,
        name,
        status: req.body.status || 'active',
        description: req.body.description || null,
      },
    );
    await audit(req.user.id, 'create_project', 'project', result.insertId, { name, companyId });
    const rows = await query('SELECT * FROM projects WHERE id = :id', { id: result.insertId });
    res.status(201).json({ project: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать проект' });
  }
});

router.get('/services', async (_req, res) => {
  const rows = await query('SELECT * FROM services ORDER BY id');
  res.json({ items: rows });
});

/**
 * Прайс проекта: все активные услуги + цена, заданная именно этому проекту.
 * Пустая цена = услуга в проекте не тарифицируется.
 */
router.get('/projects/:id/tariffs', async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const projects = await query(
      `SELECT p.id, p.name, p.company_id, c.name AS company_name
       FROM projects p JOIN companies c ON c.id = p.company_id
       WHERE p.id = :id`,
      { id: projectId },
    );
    if (!projects[0]) return res.status(404).json({ error: 'Проект не найден' });

    const rows = await query(
      `SELECT s.id AS service_id, s.code, s.name, s.unit,
              t.id AS tariff_id, t.price, t.billing_type
       FROM services s
       LEFT JOIN tariffs t
         ON t.service_id = s.id
        AND t.project_id = :project_id
        AND t.company_id IS NULL
        AND t.valid_to IS NULL
        AND t.valid_from <= CURDATE()
       WHERE s.is_active = 1
       ORDER BY s.id`,
      { project_id: projectId },
    );

    res.json({ project: projects[0], items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить тарифы проекта' });
  }
});

/** Сохранить прайс проекта (пустая цена удаляет тариф услуги). */
router.put('/projects/:id/tariffs', requireRoles('admin'), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const projects = await query('SELECT id, name FROM projects WHERE id = :id', { id: projectId });
    if (!projects[0]) return res.status(404).json({ error: 'Проект не найден' });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    let saved = 0;
    let removed = 0;

    for (const item of items) {
      const serviceId = Number(item.serviceId);
      if (!serviceId) continue;

      const raw = item.price;
      const isEmpty = raw === null || raw === undefined || String(raw).trim() === '';
      const price = isEmpty ? NaN : Number(raw);

      const existing = await query(
        `SELECT id FROM tariffs
         WHERE company_id IS NULL AND project_id = :project_id
           AND service_id = :service_id AND valid_to IS NULL
         ORDER BY id DESC LIMIT 1`,
        { project_id: projectId, service_id: serviceId },
      );

      if (isEmpty || !Number.isFinite(price) || price <= 0) {
        if (existing.length) {
          await query('DELETE FROM tariffs WHERE id = :id', { id: existing[0].id });
          removed += 1;
        }
        continue;
      }

      if (existing.length) {
        await query(`UPDATE tariffs SET price = :price, billing_type = :bt WHERE id = :id`, {
          price,
          bt: item.billingType || 'unit',
          id: existing[0].id,
        });
      } else {
        await query(
          `INSERT INTO tariffs (company_id, project_id, service_id, price, billing_type, valid_from)
           VALUES (NULL, :project_id, :service_id, :price, :bt, CURDATE())`,
          {
            project_id: projectId,
            service_id: serviceId,
            price,
            bt: item.billingType || 'unit',
          },
        );
      }
      saved += 1;
    }

    await audit(req.user.id, 'update_project_tariffs', 'project', projectId, { saved, removed });
    res.json({ ok: true, saved, removed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось сохранить тарифы проекта' });
  }
});

router.post('/services', requireRoles('admin'), async (req, res) => {
  try {
    const result = await query(
      `INSERT INTO services (code, name, unit, description)
       VALUES (:code, :name, :unit, :description)`,
      {
        code: String(req.body.code || '').trim(),
        name: String(req.body.name || '').trim(),
        unit: req.body.unit || 'шт',
        description: req.body.description || null,
      },
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать услугу' });
  }
});

router.get('/tariffs', async (req, res) => {
  const params = {};
  let sql = `SELECT t.*, s.name AS service_name, c.name AS company_name, p.name AS project_name
             FROM tariffs t
             JOIN services s ON s.id = t.service_id
             LEFT JOIN companies c ON c.id = t.company_id
             LEFT JOIN projects p ON p.id = t.project_id WHERE 1=1`;
  if (req.query.companyId) {
    sql += ' AND (t.company_id = :company_id OR t.company_id IS NULL)';
    params.company_id = Number(req.query.companyId);
  }
  sql += ' ORDER BY t.id DESC';
  const rows = await query(sql, params);
  res.json({ items: rows });
});

router.post('/tariffs', requireRoles('admin'), async (req, res) => {
  try {
    const result = await query(
      `INSERT INTO tariffs (company_id, project_id, service_id, price, billing_type, valid_from, valid_to)
       VALUES (:company_id, :project_id, :service_id, :price, :billing_type, :valid_from, :valid_to)`,
      {
        company_id: req.body.companyId || null,
        project_id: req.body.projectId || null,
        service_id: Number(req.body.serviceId),
        price: Number(req.body.price),
        billing_type: req.body.billingType || 'unit',
        valid_from: req.body.validFrom || new Date().toISOString().slice(0, 10),
        valid_to: req.body.validTo || null,
      },
    );
    await audit(req.user.id, 'create_tariff', 'tariff', result.insertId, req.body);
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать тариф' });
  }
});

router.post('/balance/adjust', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const companyId = Number(req.body.companyId);
    const amount = Number(req.body.amount);
    const type = req.body.type === 'debit' ? 'debit' : 'credit';
    const comment = String(req.body.comment || '').trim();
    if (!companyId || !(amount > 0) || !comment) {
      return res.status(400).json({ error: 'companyId, amount и comment обязательны' });
    }

    const result = await withTransaction((conn) =>
      applyBalanceChange({
        conn,
        companyId,
        type,
        category: type === 'credit' ? 'manual_credit' : 'manual_debit',
        amount,
        comment,
        createdBy: req.user.id,
      }),
    );

    await notifyCompanyUsers(
      companyId,
      'Корректировка баланса',
      `Выполнена ${type === 'credit' ? 'корректировка зачисления' : 'корректировка списания'} на ${amount.toFixed(2)} BYN. Причина: ${comment}`,
    );
    await audit(req.user.id, 'balance_adjust', 'company', companyId, { type, amount, comment });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Ошибка корректировки' });
  }
});

router.get('/banking/status', async (_req, res) => {
  try {
    res.json(await getMtbankStatus());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось проверить MTBank' });
  }
});

router.get('/banking/movements', async (req, res) => {
  try {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    // refresh=1 bypasses the short-lived statement cache (used by «Обновить»).
    const data = await fetchMtbankStatement({ from, to, refresh: req.query.refresh === '1' });
    // Copy: the cached array must not be reordered in place by the sort below.
    let items = [...(data.movements || [])];
    const direction = req.query.direction;
    if (direction === 'income' || direction === 'expense') {
      items = items.filter((m) => m.direction === direction);
    }
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) {
      items = items.filter((m) =>
        [m.counterparty, m.unp, m.purpose, m.reference]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    res.json({
      configured: data.configured,
      ready: data.ready,
      provider: data.provider,
      account: data.account,
      period: data.period || { from, to },
      fetchedAt: data.fetchedAt,
      message: data.message,
      items,
      summary: summarizeMovements(data.movements || []),
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Не удалось загрузить движения MTBank' });
  }
});

router.get('/banking/summary', async (req, res) => {
  try {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    const data = await fetchMtbankStatement({ from, to });
    res.json({
      configured: data.configured,
      ready: data.ready,
      provider: data.provider,
      account: data.account,
      period: data.period || { from, to },
      fetchedAt: data.fetchedAt,
      message: data.message,
      ...summarizeMovements(data.movements || []),
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Не удалось посчитать итоги MTBank' });
  }
});

router.post('/banking/sync', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const from = req.body?.from || req.query.from || null;
    const to = req.body?.to || req.query.to || null;
    const result = await syncMtbankPayments({ from, to, lookbackDays: 14 });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Ошибка синхронизации MTBank' });
  }
});

router.get('/banking/statement.csv', async (req, res) => {
  try {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    const data = await fetchMtbankStatement({ from, to });
    const items = [...(data.movements || [])].sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || '')),
    );
    const header = [
      'Дата',
      'Тип',
      'Сумма',
      'Валюта',
      'Контрагент',
      'УНП',
      'Назначение',
      'Референс',
      'Остаток',
    ];
    const lines = [header.join(';')];
    const totals = summarizeMovements(items);
    for (const r of items) {
      lines.push(
        [
          r.date ? dayjs(r.date).format('DD.MM.YYYY') : '',
          r.direction === 'expense' ? 'Расход' : 'Доход',
          Number(r.amount).toFixed(2),
          r.currency || 'BYN',
          (r.counterparty || '').replace(/;/g, ','),
          r.unp || '',
          (r.purpose || '').replace(/;/g, ','),
          (r.reference || '').replace(/;/g, ','),
          r.balanceAfter == null ? '' : Number(r.balanceAfter).toFixed(2),
        ].join(';'),
      );
    }
    lines.push('');
    lines.push(['Итого доходы', '', totals.income.toFixed(2)].join(';'));
    lines.push(['Итого расходы', '', totals.expense.toFixed(2)].join(';'));
    lines.push(['Сальдо', '', totals.net.toFixed(2)].join(';'));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="mtbank_${from || 'all'}_${to || 'all'}.csv"`,
    );
    res.send(`\uFEFF${lines.join('\n')}`);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Ошибка экспорта выписки MTBank' });
  }
});

router.get('/payments', async (req, res) => {
  try {
    const { where, params } = buildBankPaymentsFilter(req);
    const rows = await query(
      `SELECT bp.*, c.name AS company_name, c.unp AS company_unp, i.number AS invoice_number,
              ${bankPaymentDateExpr()} AS op_date
       FROM bank_payments bp
       LEFT JOIN companies c ON c.id = bp.company_id
       LEFT JOIN invoices i ON i.id = bp.invoice_id
       ${where}
       ORDER BY ${bankPaymentDateExpr()} DESC, bp.id DESC
       LIMIT 1000`,
      params,
    );
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить платежи' });
  }
});

router.get('/payments/summary', async (req, res) => {
  try {
    const { where, params } = buildBankPaymentsFilter(req);
    const rows = await query(
      `SELECT
         bp.direction,
         COUNT(*) AS cnt,
         COALESCE(SUM(bp.amount), 0) AS total
       FROM bank_payments bp
       LEFT JOIN companies c ON c.id = bp.company_id
       LEFT JOIN invoices i ON i.id = bp.invoice_id
       ${where}
         AND bp.status <> 'rejected'
       GROUP BY bp.direction`,
      params,
    );
    let income = 0;
    let expense = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    for (const r of rows) {
      if (r.direction === 'expense') {
        expense = Number(r.total);
        expenseCount = Number(r.cnt);
      } else {
        income = Number(r.total);
        incomeCount = Number(r.cnt);
      }
    }
    res.json({
      income,
      expense,
      net: income - expense,
      incomeCount,
      expenseCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось посчитать итоги' });
  }
});

router.get('/export/bank-statement.csv', async (req, res) => {
  try {
    const { where, params } = buildBankPaymentsFilter(req);
    const rows = await query(
      `SELECT bp.*, c.name AS company_name, i.number AS invoice_number,
              ${bankPaymentDateExpr()} AS op_date
       FROM bank_payments bp
       LEFT JOIN companies c ON c.id = bp.company_id
       LEFT JOIN invoices i ON i.id = bp.invoice_id
       ${where}
         AND bp.status <> 'rejected'
       ORDER BY ${bankPaymentDateExpr()} ASC, bp.id ASC`,
      params,
    );

    const header = [
      'Дата',
      'Тип',
      'Сумма',
      'Контрагент',
      'УНП',
      'Организация',
      'Счёт',
      'Назначение',
      'Референс',
      'Статус',
    ];
    const lines = [header.join(';')];
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      const dir = r.direction === 'expense' ? 'expense' : 'income';
      if (dir === 'expense') expense += Number(r.amount);
      else income += Number(r.amount);
      lines.push(
        [
          dayjs(r.op_date || r.imported_at).format('DD.MM.YYYY'),
          dir === 'expense' ? 'Расход' : 'Доход',
          Number(r.amount).toFixed(2),
          (r.payer_name || '').replace(/;/g, ','),
          r.payer_unp || '',
          (r.company_name || '').replace(/;/g, ','),
          r.invoice_number || '',
          (r.purpose || '').replace(/;/g, ','),
          (r.reference || '').replace(/;/g, ','),
          r.status,
        ].join(';'),
      );
    }
    lines.push('');
    lines.push(['Итого доходы', '', income.toFixed(2)].join(';'));
    lines.push(['Итого расходы', '', expense.toFixed(2)].join(';'));
    lines.push(['Сальдо', '', (income - expense).toFixed(2)].join(';'));

    const from = req.query.from ? String(req.query.from).slice(0, 10) : 'all';
    const to = req.query.to ? String(req.query.to).slice(0, 10) : 'all';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bank-statement_${from}_${to}.csv"`,
    );
    res.send(`\uFEFF${lines.join('\n')}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка экспорта выписки' });
  }
});

router.post('/payments', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Укажите сумму' });
    const direction = req.body.direction === 'expense' ? 'expense' : 'income';
    const companyId = req.body.companyId ? Number(req.body.companyId) : null;
    const invoiceId = req.body.invoiceId ? Number(req.body.invoiceId) : null;
    const operationDate = req.body.operationDate
      ? String(req.body.operationDate).slice(0, 10)
      : dayjs().format('YYYY-MM-DD');

    let status = 'unmatched';
    if (direction === 'expense') {
      status = 'matched';
    } else if (companyId || invoiceId) {
      status = 'matched';
    }

    const result = await query(
      `INSERT INTO bank_payments
        (direction, amount, payer_name, payer_unp, reference, purpose, invoice_id, company_id, status, operation_date)
       VALUES
        (:direction, :amount, :payer_name, :payer_unp, :reference, :purpose, :invoice_id, :company_id, :status, :operation_date)`,
      {
        direction,
        amount,
        payer_name: req.body.payerName || null,
        payer_unp: req.body.payerUnp || null,
        reference: req.body.reference || null,
        purpose: req.body.purpose || null,
        invoice_id: invoiceId,
        company_id: companyId,
        status,
        operation_date: operationDate,
      },
    );
    await audit(req.user.id, 'create_bank_payment', 'bank_payment', result.insertId, {
      direction,
      amount,
      companyId,
    });
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось добавить платёж' });
  }
});

router.patch('/payments/:id', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await query('SELECT * FROM bank_payments WHERE id = :id LIMIT 1', { id });
    const payment = rows[0];
    if (!payment) return res.status(404).json({ error: 'Платёж не найден' });
    if (payment.status === 'credited') {
      return res.status(400).json({ error: 'Зачисленный платёж нельзя изменить' });
    }
    if (payment.status === 'rejected') {
      return res.status(400).json({ error: 'Отклонённый платёж нельзя изменить' });
    }

    const companyId = req.body.companyId !== undefined
      ? (req.body.companyId ? Number(req.body.companyId) : null)
      : payment.company_id;
    const invoiceId = req.body.invoiceId !== undefined
      ? (req.body.invoiceId ? Number(req.body.invoiceId) : null)
      : payment.invoice_id;
    const purpose = req.body.purpose !== undefined
      ? (req.body.purpose || null)
      : payment.purpose;
    const reference = req.body.reference !== undefined
      ? (req.body.reference || null)
      : payment.reference;
    const payerName = req.body.payerName !== undefined
      ? (req.body.payerName || null)
      : payment.payer_name;
    const payerUnp = req.body.payerUnp !== undefined
      ? (req.body.payerUnp || null)
      : payment.payer_unp;
    const operationDate = req.body.operationDate
      ? String(req.body.operationDate).slice(0, 10)
      : payment.operation_date;

    let status = payment.status;
    if (payment.direction !== 'expense') {
      if (companyId || invoiceId) status = 'matched';
      else status = 'unmatched';
    }

    await query(
      `UPDATE bank_payments
       SET company_id = :company_id,
           invoice_id = :invoice_id,
           purpose = :purpose,
           reference = :reference,
           payer_name = :payer_name,
           payer_unp = :payer_unp,
           operation_date = :operation_date,
           status = :status
       WHERE id = :id`,
      {
        id,
        company_id: companyId,
        invoice_id: invoiceId,
        purpose,
        reference,
        payer_name: payerName,
        payer_unp: payerUnp,
        operation_date: operationDate,
        status,
      },
    );

    await audit(req.user.id, 'bind_bank_payment', 'bank_payment', id, {
      companyId,
      invoiceId,
      status,
    });
    res.json({ ok: true, status, companyId, invoiceId });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Не удалось обновить платёж' });
  }
});

router.post('/payments/:id/reject', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await query('SELECT * FROM bank_payments WHERE id = :id LIMIT 1', { id });
    const payment = rows[0];
    if (!payment) return res.status(404).json({ error: 'Платёж не найден' });
    if (payment.status === 'credited') {
      return res.status(400).json({ error: 'Зачисленный платёж нельзя отклонить' });
    }
    await query(
      `UPDATE bank_payments
       SET status = 'rejected', confirmed_by = :uid, confirmed_at = NOW()
       WHERE id = :id`,
      { id, uid: req.user.id },
    );
    await audit(req.user.id, 'reject_bank_payment', 'bank_payment', id, {});
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Не удалось отклонить' });
  }
});

router.post('/payments/:id/credit', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const payments = await query('SELECT * FROM bank_payments WHERE id = :id', { id });
    const payment = payments[0];
    if (!payment) return res.status(404).json({ error: 'Платёж не найден' });
    if (payment.direction === 'expense') {
      return res.status(400).json({ error: 'Расход нельзя зачислить на баланс клиента' });
    }
    if (payment.status === 'credited') return res.status(400).json({ error: 'Уже зачислен' });
    if (payment.status === 'rejected') return res.status(400).json({ error: 'Платёж отклонён' });

    let companyId = payment.company_id || Number(req.body.companyId);
    let invoiceId = payment.invoice_id || Number(req.body.invoiceId) || null;

    if (!companyId && invoiceId) {
      const inv = await query('SELECT * FROM invoices WHERE id = :id', { id: invoiceId });
      companyId = inv[0]?.company_id;
    }
    if (!companyId) return res.status(400).json({ error: 'Укажите компанию для зачисления' });

    const result = await withTransaction(async (conn) => {
      const applied = await applyBalanceChange({
        conn,
        companyId,
        invoiceId,
        type: 'credit',
        category: 'bank_payment',
        amount: Number(payment.amount),
        comment: payment.purpose || `Банковский платёж #${payment.id}`,
        createdBy: req.user.id,
      });

      await conn.execute(
        `UPDATE bank_payments
         SET status = 'credited', company_id = ?, invoice_id = ?, confirmed_by = ?, confirmed_at = NOW()
         WHERE id = ?`,
        [companyId, invoiceId, req.user.id, id],
      );

      if (invoiceId) {
        await conn.execute(
          `UPDATE invoices
           SET status = 'paid', paid_amount = amount, paid_at = NOW()
           WHERE id = ?`,
          [invoiceId],
        );
      }

      return applied;
    });

    await notifyCompanyUsers(
      companyId,
      'Баланс пополнен',
      `На баланс зачислено ${Number(payment.amount).toFixed(2)} BYN`,
    );

    if (invoiceId) {
      try {
        const invRows = await query('SELECT * FROM invoices WHERE id = :id LIMIT 1', { id: invoiceId });
        const invoice = invRows[0];
        const companyRows = await query('SELECT * FROM companies WHERE id = :id LIMIT 1', {
          id: companyId,
        });
        if (invoice && companyRows[0]) {
          const { ensureActForInvoice } = await import('../services/documents.js');
          await ensureActForInvoice(invoice, companyRows[0]);
          await notifyCompanyUsers(
            companyId,
            'Акт оказанных услуг',
            `Сформирован акт ${invoice.number} (номер совпадает со счётом). Документ доступен в разделе «Документы».`,
          );
        }
      } catch (err) {
        console.warn('Act generation failed:', err.message);
      }
    }

    await audit(req.user.id, 'credit_payment', 'bank_payment', id, { companyId, invoiceId });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Ошибка зачисления' });
  }
});

router.get('/documents', async (req, res) => {
  try {
    const params = {};
    let sql = `SELECT d.*, c.name AS company_name, c.unp AS company_unp
               FROM documents d
               JOIN companies c ON c.id = d.company_id
               WHERE 1=1`;

    if (req.query.companyId) {
      sql += ' AND d.company_id = :company_id';
      params.company_id = Number(req.query.companyId);
    }
    if (req.query.type) {
      sql += ' AND d.type = :type';
      params.type = String(req.query.type);
    }
    if (req.query.status) {
      sql += ' AND d.status = :status';
      params.status = String(req.query.status);
    }
    const q = String(req.query.q || '').trim();
    if (q) {
      sql += ` AND (
        d.title LIKE :q OR d.number LIKE :q OR c.name LIKE :q OR c.unp LIKE :q
      )`;
      params.q = `%${q}%`;
    }
    if (req.query.from) {
      sql += ' AND DATE(d.created_at) >= :from_date';
      params.from_date = String(req.query.from).slice(0, 10);
    }
    if (req.query.to) {
      sql += ' AND DATE(d.created_at) <= :to_date';
      params.to_date = String(req.query.to).slice(0, 10);
    }

    sql += ' ORDER BY d.created_at DESC LIMIT 2000';
    const rows = await query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить документы' });
  }
});

async function loadAdminDocument(id) {
  const rows = await query(
    `SELECT d.*, c.name AS company_name
     FROM documents d
     JOIN companies c ON c.id = d.company_id
     WHERE d.id = :id
     LIMIT 1`,
    { id: Number(id) },
  );
  const doc = rows[0];
  if (!doc) {
    const err = new Error('Документ не найден');
    err.status = 404;
    throw err;
  }
  if (!doc.file_path || !fs.existsSync(doc.file_path)) {
    const err = new Error('Файл не найден');
    err.status = 404;
    throw err;
  }
  return doc;
}

router.get('/documents/:id/view', async (req, res) => {
  try {
    const doc = await loadAdminDocument(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${path.basename(doc.file_path)}"`,
    );
    fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Ошибка просмотра' });
  }
});

router.get('/documents/:id/download', async (req, res) => {
  try {
    const doc = await loadAdminDocument(req.params.id);
    await query('UPDATE documents SET downloaded_at = NOW() WHERE id = :id', { id: doc.id });
    res.download(doc.file_path, path.basename(doc.file_path));
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Ошибка скачивания' });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const params = {};
    let sql = `SELECT i.*, c.name AS company_name, c.unp AS company_unp, c.balance AS company_balance
               FROM invoices i
               JOIN companies c ON c.id = i.company_id
               WHERE 1=1`;
    if (req.query.companyId) {
      sql += ' AND i.company_id = :company_id';
      params.company_id = Number(req.query.companyId);
    }
    if (req.query.status) {
      sql += ' AND i.status = :status';
      params.status = String(req.query.status);
    }
    const q = String(req.query.q || '').trim();
    if (q) {
      sql += ` AND (
        i.number LIKE :q OR c.name LIKE :q OR c.unp LIKE :q OR i.purpose LIKE :q
      )`;
      params.q = `%${q}%`;
    }
    if (req.query.from) {
      sql += ' AND DATE(i.created_at) >= :from_date';
      params.from_date = String(req.query.from).slice(0, 10);
    }
    if (req.query.to) {
      sql += ' AND DATE(i.created_at) <= :to_date';
      params.to_date = String(req.query.to).slice(0, 10);
    }
    sql += ' ORDER BY i.created_at DESC LIMIT 1000';
    const rows = await query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить счета' });
  }
});

router.get('/invoices/:id/view', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await query('SELECT * FROM invoices WHERE id = :id LIMIT 1', { id });
    const invoice = rows[0];
    if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });
    const { filePath, fileName } = await loadInvoicePdf(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Ошибка просмотра' });
  }
});

router.get('/invoices/:id/download', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await query('SELECT * FROM invoices WHERE id = :id LIMIT 1', { id });
    const invoice = rows[0];
    if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });
    const { filePath, fileName } = await loadInvoicePdf(invoice);
    res.download(filePath, fileName);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Ошибка скачивания' });
  }
});

router.post('/invoices/:id/mark-paid', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await markInvoicePaid({
      invoiceId: id,
      comment: `Ручное подтверждение оплаты счёта`,
      createdBy: req.user.id,
    });

    if (result.alreadyPaid) {
      return res.status(400).json({ error: 'Счёт уже отмечен оплаченным' });
    }

    res.json({ ok: true, invoice: result.invoice, balance: result.balance });
  } catch (err) {
    console.error(err);
    res.status(err.status || 400).json({ error: err.message || 'Не удалось отметить счёт оплаченным' });
  }
});

router.get('/transactions', async (req, res) => {
  const params = {};
  const where = ['1=1'];

  if (req.query.companyId) {
    where.push('t.company_id = :company_id');
    params.company_id = Number(req.query.companyId);
  }
  if (req.query.type === 'credit' || req.query.type === 'debit') {
    where.push('t.type = :type');
    params.type = req.query.type;
  }
  if (req.query.category) {
    where.push('t.category = :category');
    params.category = String(req.query.category);
  }
  if (req.query.from) {
    where.push('DATE(t.created_at) >= :from_date');
    params.from_date = String(req.query.from).slice(0, 10);
  }
  if (req.query.to) {
    where.push('DATE(t.created_at) <= :to_date');
    params.to_date = String(req.query.to).slice(0, 10);
  }
  const q = String(req.query.q || '').trim();
  if (q) {
    where.push('(c.name LIKE :q OR c.unp LIKE :q OR s.name LIKE :q OR t.comment LIKE :q)');
    params.q = `%${q}%`;
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
  const whereSql = where.join(' AND ');

  const rows = await query(
    `SELECT t.id, t.created_at, t.type, t.category, t.amount, t.quantity, t.unit_price,
            t.balance_before, t.balance_after, t.comment, t.employee_name, t.crm_event_id,
            t.company_id, t.project_id,
            c.name AS company_name, c.unp AS company_unp,
            s.name AS service_name, s.unit AS service_unit,
            p.name AS project_name
     FROM transactions t
     JOIN companies c ON c.id = t.company_id
     LEFT JOIN services s ON s.id = t.service_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE ${whereSql}
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT ${limit}`,
    params,
  );

  const totals = await query(
    `SELECT
        COALESCE(SUM(CASE WHEN t.type = 'debit' THEN t.amount ELSE 0 END), 0) AS debit_total,
        COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END), 0) AS credit_total,
        COALESCE(SUM(CASE WHEN t.type = 'debit' THEN 1 ELSE 0 END), 0) AS debit_count,
        COUNT(*) AS total_count
     FROM transactions t
     JOIN companies c ON c.id = t.company_id
     LEFT JOIN services s ON s.id = t.service_id
     WHERE ${whereSql}`,
    params,
  );

  res.json({
    items: rows,
    totals: totals[0] || null,
    limit,
    truncated: Number(totals[0]?.total_count || 0) > rows.length,
  });
});

router.get('/crm-errors', async (_req, res) => {
  const rows = await query(
    `SELECT * FROM crm_event_log WHERE status = 'error' ORDER BY created_at DESC LIMIT 200`,
  );
  res.json({ items: rows });
});

router.get('/api-keys', requireRoles('admin', 'accountant'), async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, unp, status, balance, api_key, api_key_created_at
       FROM companies
       ORDER BY id DESC`,
    );
    res.json({
      items: rows.map((c) => ({
        companyId: c.id,
        name: c.name,
        unp: c.unp,
        status: c.status,
        balance: Number(c.balance),
        apiKey: c.api_key || null,
        createdAt: c.api_key_created_at || null,
        hasKey: !!c.api_key,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить API-ключи' });
  }
});

router.post('/api-keys/:companyId/regenerate', requireRoles('admin'), async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    const companies = await query('SELECT id, name FROM companies WHERE id = :id LIMIT 1', {
      id: companyId,
    });
    if (!companies[0]) return res.status(404).json({ error: 'Компания не найдена' });

    const apiKey = await setCompanyApiKey(companyId);
    await audit(req.user.id, 'admin_regenerate_api_key', 'company', companyId, {});

    const rows = await query(
      `SELECT id, name, api_key, api_key_created_at FROM companies WHERE id = :id LIMIT 1`,
      { id: companyId },
    );
    res.json({
      companyId: rows[0].id,
      name: rows[0].name,
      apiKey,
      createdAt: rows[0].api_key_created_at,
      hasKey: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось сгенерировать API-ключ' });
  }
});

export default router;
