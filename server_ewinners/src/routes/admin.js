import { Router } from 'express';
import bcrypt from 'bcrypt';
import fs from 'fs';
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
  const rows = await query('SELECT * FROM companies ORDER BY id DESC');
  res.json({ items: rows });
});

router.post('/companies', requireRoles('admin'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Укажите название компании' });

    const result = await query(
      `INSERT INTO companies
        (name, unp, legal_address, bank_name, iban, bic, credit_limit, min_balance, notify_threshold,
         low_balance_action, manager_name, manager_phone, manager_email)
       VALUES
        (:name, :unp, :legal_address, :bank_name, :iban, :bic, :credit_limit, :min_balance, :notify_threshold,
         :low_balance_action, :manager_name, :manager_phone, :manager_email)`,
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
    `SELECT u.id, u.email, u.phone, u.full_name, u.avatar_url, u.role, u.status, u.company_id, u.created_at, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     ORDER BY u.id DESC`,
  );
  res.json({ items: rows });
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
  let sql = `SELECT p.*, c.name AS company_name FROM projects p JOIN companies c ON c.id = p.company_id WHERE 1=1`;
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

router.get('/payments', async (_req, res) => {
  const rows = await query(
    `SELECT bp.*, c.name AS company_name, i.number AS invoice_number
     FROM bank_payments bp
     LEFT JOIN companies c ON c.id = bp.company_id
     LEFT JOIN invoices i ON i.id = bp.invoice_id
     ORDER BY bp.imported_at DESC`,
  );
  res.json({ items: rows });
});

router.post('/payments', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Укажите сумму' });
    const result = await query(
      `INSERT INTO bank_payments
        (amount, payer_name, payer_unp, reference, purpose, invoice_id, company_id, status)
       VALUES
        (:amount, :payer_name, :payer_unp, :reference, :purpose, :invoice_id, :company_id, 'unmatched')`,
      {
        amount,
        payer_name: req.body.payerName || null,
        payer_unp: req.body.payerUnp || null,
        reference: req.body.reference || null,
        purpose: req.body.purpose || null,
        invoice_id: req.body.invoiceId || null,
        company_id: req.body.companyId || null,
      },
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось добавить платёж' });
  }
});

router.post('/payments/:id/credit', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const payments = await query('SELECT * FROM bank_payments WHERE id = :id', { id });
    const payment = payments[0];
    if (!payment) return res.status(404).json({ error: 'Платёж не найден' });
    if (payment.status === 'credited') return res.status(400).json({ error: 'Уже зачислен' });

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

router.get('/invoices', async (_req, res) => {
  const rows = await query(
    `SELECT i.*, c.name AS company_name, c.unp AS company_unp
     FROM invoices i JOIN companies c ON c.id = i.company_id
     ORDER BY i.created_at DESC`,
  );
  res.json({ items: rows });
});

router.get('/transactions', async (req, res) => {
  const params = {};
  let sql = `SELECT t.*, c.name AS company_name, s.name AS service_name
             FROM transactions t
             JOIN companies c ON c.id = t.company_id
             LEFT JOIN services s ON s.id = t.service_id WHERE 1=1`;
  if (req.query.companyId) {
    sql += ' AND t.company_id = :company_id';
    params.company_id = Number(req.query.companyId);
  }
  sql += ' ORDER BY t.created_at DESC LIMIT 500';
  const rows = await query(sql, params);
  res.json({ items: rows });
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
