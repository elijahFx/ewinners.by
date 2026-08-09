import { Router } from 'express';
import { generateInvoicePdf } from '../services/invoicePdf.js';
import { audit } from '../services/billing.js';
import dayjs from 'dayjs';
import path from 'path';
import { query } from '../db.js';
import { authRequired, requireRoles } from '../middleware/auth.js';

const router = Router();

router.use(authRequired, requireRoles('client', 'admin', 'accountant', 'manager'));

function companyScope(req) {
  if (['admin', 'accountant', 'manager'].includes(req.user.role) && req.query.companyId) {
    return Number(req.query.companyId);
  }
  return req.user.company_id;
}

router.get('/dashboard', async (req, res) => {
  try {
    const companyId = companyScope(req);
    if (!companyId) return res.status(400).json({ error: 'Компания не назначена' });

    const companies = await query('SELECT * FROM companies WHERE id = :id', { id: companyId });
    const company = companies[0];
    if (!company) return res.status(404).json({ error: 'Компания не найдена' });

    const monthStart = dayjs().startOf('month').format('YYYY-MM-DD HH:mm:ss');

    const [spend] = await query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM transactions
       WHERE company_id = :company_id AND type = 'debit' AND status = 'posted' AND created_at >= :from`,
      { company_id: companyId, from: monthStart },
    );
    const [topup] = await query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM transactions
       WHERE company_id = :company_id AND type = 'credit' AND status = 'posted' AND created_at >= :from`,
      { company_id: companyId, from: monthStart },
    );
    const recent = await query(
      `SELECT t.*, s.name AS service_name, p.name AS project_name
       FROM transactions t
       LEFT JOIN services s ON s.id = t.service_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.company_id = :company_id
       ORDER BY t.created_at DESC LIMIT 10`,
      { company_id: companyId },
    );
    const projects = await query(
      `SELECT * FROM projects WHERE company_id = :company_id ORDER BY id DESC`,
      { company_id: companyId },
    );
    const unread = await query(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = :uid AND is_read = 0`,
      { uid: req.user.id },
    );

    const balance = Number(company.balance);
    const available = balance + Number(company.credit_limit || 0);

    res.json({
      company: {
        id: company.id,
        name: company.name,
        status: company.status,
        balance,
        creditLimit: Number(company.credit_limit),
        availableLimit: available,
        notifyThreshold: Number(company.notify_threshold),
        managerName: company.manager_name,
        managerPhone: company.manager_phone,
        managerEmail: company.manager_email,
      },
      monthSpend: Number(spend.total),
      monthTopup: Number(topup.total),
      lowBalance: balance <= Number(company.notify_threshold),
      recent,
      projects,
      unreadNotifications: Number(unread[0]?.c || 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка загрузки дашборда' });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const companyId = companyScope(req);
    if (!companyId) return res.status(400).json({ error: 'Компания не назначена' });

    const params = { company_id: companyId };
    let sql = `SELECT t.*, s.name AS service_name, p.name AS project_name
               FROM transactions t
               LEFT JOIN services s ON s.id = t.service_id
               LEFT JOIN projects p ON p.id = t.project_id
               WHERE t.company_id = :company_id`;

    if (req.query.type === 'credit' || req.query.type === 'debit') {
      sql += ' AND t.type = :type';
      params.type = req.query.type;
    }
    if (req.query.projectId) {
      sql += ' AND t.project_id = :project_id';
      params.project_id = Number(req.query.projectId);
    }
    if (req.query.from) {
      sql += ' AND t.created_at >= :from';
      params.from = req.query.from;
    }
    if (req.query.to) {
      sql += ' AND t.created_at <= :to';
      params.to = req.query.to;
    }
    sql += ' ORDER BY t.created_at DESC LIMIT 500';

    const rows = await query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка загрузки операций' });
  }
});

router.get('/tariffs', async (req, res) => {
  try {
    const companyId = companyScope(req);
    if (!companyId) return res.status(400).json({ error: 'Компания не назначена' });

    const rows = await query(
      `SELECT t.*, s.name AS service_name, s.code AS service_code, s.unit, p.name AS project_name
       FROM tariffs t
       JOIN services s ON s.id = t.service_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE (t.company_id = :company_id OR t.company_id IS NULL)
         AND (t.valid_to IS NULL OR t.valid_to >= CURDATE())
       ORDER BY s.name, (t.company_id IS NULL), (t.project_id IS NULL)`,
      { company_id: companyId },
    );
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка загрузки тарифов' });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const companyId = companyScope(req);
    if (!companyId) return res.status(400).json({ error: 'Компания не назначена' });
    const rows = await query(
      `SELECT i.*, p.name AS project_name
       FROM invoices i
       LEFT JOIN projects p ON p.id = i.project_id
       WHERE i.company_id = :company_id
       ORDER BY i.created_at DESC`,
      { company_id: companyId },
    );
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка загрузки счетов' });
  }
});

router.post('/invoices', async (req, res) => {
  try {
    if (req.user.role !== 'client' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    const companyId = req.user.role === 'admin' && req.body.companyId
      ? Number(req.body.companyId)
      : req.user.company_id;
    if (!companyId) return res.status(400).json({ error: 'Компания не назначена' });

    const amount = Number(req.body.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Укажите сумму пополнения' });

    const companies = await query('SELECT * FROM companies WHERE id = :id', { id: companyId });
    const company = companies[0];
    if (!company) return res.status(404).json({ error: 'Компания не найдена' });

    const projectId = req.body.projectId ? Number(req.body.projectId) : null;
    const countRows = await query('SELECT COUNT(*) AS c FROM invoices WHERE company_id = :id', {
      id: companyId,
    });
    const seq = Number(countRows[0].c) + 1;
    const number = `EW-${dayjs().format('YYYYMM')}-${companyId}-${String(seq).padStart(4, '0')}`;
    const purpose =
      req.body.purpose ||
      `Пополнение авансового баланса по счёту ${number}. УНП плательщика ${company.unp || '—'}. В назначении платежа обязательно указать номер счёта ${number}.`;

    const createdAt = dayjs().format('DD.MM.YYYY');
    const { filePath } = await generateInvoicePdf({
      number,
      amount,
      purpose,
      company,
      createdAt,
    });

    const result = await query(
      `INSERT INTO invoices (number, company_id, project_id, amount, status, purpose, file_path, created_by)
       VALUES (:number, :company_id, :project_id, :amount, 'awaiting_payment', :purpose, :file_path, :created_by)`,
      {
        number,
        company_id: companyId,
        project_id: projectId,
        amount,
        purpose,
        file_path: filePath,
        created_by: req.user.id,
      },
    );

    await query(
      `INSERT INTO documents (company_id, type, number, title, amount, status, project_id, file_path)
       VALUES (:company_id, 'invoice', :number, :title, :amount, 'awaiting_payment', :project_id, :file_path)`,
      {
        company_id: companyId,
        number,
        title: `Счёт на оплату ${number}`,
        amount,
        project_id: projectId,
        file_path: filePath,
      },
    );

    await audit(req.user.id, 'create_invoice', 'invoice', result.insertId, { number, amount });

    const invoices = await query('SELECT * FROM invoices WHERE id = :id', { id: result.insertId });
    res.status(201).json({ invoice: invoices[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось сформировать счёт' });
  }
});

router.get('/invoices/:id/download', async (req, res) => {
  try {
    const companyId = companyScope(req);
    const rows = await query('SELECT * FROM invoices WHERE id = :id LIMIT 1', {
      id: Number(req.params.id),
    });
    const invoice = rows[0];
    if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });
    if (req.user.role === 'client' && invoice.company_id !== companyId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const companies = await query('SELECT * FROM companies WHERE id = :id LIMIT 1', {
      id: invoice.company_id,
    });
    const company = companies[0];
    if (!company) return res.status(404).json({ error: 'Компания не найдена' });

    // Always rebuild PDF so Cyrillic/logo/requisites stay up to date
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

    res.download(filePath, fileName);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Ошибка скачивания' });
  }
});

router.get('/documents', async (req, res) => {
  try {
    const companyId = companyScope(req);
    if (!companyId) return res.status(400).json({ error: 'Компания не назначена' });
    const rows = await query(
      `SELECT * FROM documents WHERE company_id = :company_id ORDER BY created_at DESC`,
      { company_id: companyId },
    );
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка загрузки документов' });
  }
});

router.get('/documents/:id/download', async (req, res) => {
  try {
    const companyId = companyScope(req);
    const rows = await query('SELECT * FROM documents WHERE id = :id LIMIT 1', {
      id: Number(req.params.id),
    });
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    if (req.user.role === 'client' && doc.company_id !== companyId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (!doc.file_path) return res.status(404).json({ error: 'Файл не найден' });
    await query('UPDATE documents SET downloaded_at = NOW() WHERE id = :id', { id: doc.id });
    res.download(doc.file_path, path.basename(doc.file_path));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка скачивания' });
  }
});

router.get('/company', async (req, res) => {
  const companyId = companyScope(req);
  if (!companyId) return res.status(400).json({ error: 'Компания не назначена' });
  const rows = await query('SELECT * FROM companies WHERE id = :id', { id: companyId });
  res.json({ company: rows[0] || null });
});

router.put('/company', async (req, res) => {
  try {
    if (req.user.role !== 'client' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    const companyId = req.user.role === 'admin' && req.body.companyId
      ? Number(req.body.companyId)
      : req.user.company_id;
    if (!companyId) return res.status(400).json({ error: 'Компания не назначена' });

    // Client can only edit allowed requisites
    await query(
      `UPDATE companies SET
         legal_address = COALESCE(:legal_address, legal_address),
         bank_name = COALESCE(:bank_name, bank_name),
         iban = COALESCE(:iban, iban),
         bic = COALESCE(:bic, bic)
       WHERE id = :id`,
      {
        id: companyId,
        legal_address: req.body.legalAddress || null,
        bank_name: req.body.bankName || null,
        iban: req.body.iban || null,
        bic: req.body.bic || null,
      },
    );
    await audit(req.user.id, 'update_company_requisites', 'company', companyId, req.body);
    const rows = await query('SELECT * FROM companies WHERE id = :id', { id: companyId });
    res.json({ company: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось обновить реквизиты' });
  }
});

router.get('/notifications', async (req, res) => {
  const rows = await query(
    `SELECT * FROM notifications WHERE user_id = :uid ORDER BY created_at DESC LIMIT 100`,
    { uid: req.user.id },
  );
  res.json({ items: rows });
});

router.post('/notifications/read-all', async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE user_id = :uid', { uid: req.user.id });
  res.json({ ok: true });
});

router.get('/export/transactions.csv', async (req, res) => {
  try {
    const companyId = companyScope(req);
    if (!companyId) return res.status(400).json({ error: 'Компания не назначена' });
    const rows = await query(
      `SELECT t.created_at, t.type, t.category, t.amount, t.quantity, t.unit_price,
              t.employee_name, t.comment, t.balance_after, s.name AS service_name, p.name AS project_name
       FROM transactions t
       LEFT JOIN services s ON s.id = t.service_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.company_id = :company_id
       ORDER BY t.created_at DESC`,
      { company_id: companyId },
    );

    const header = [
      'Дата',
      'Тип',
      'Категория',
      'Действие',
      'Проект',
      'Сотрудник',
      'Объём',
      'Тариф',
      'Сумма',
      'Баланс после',
      'Комментарий',
    ];
    const lines = [header.join(';')];
    for (const r of rows) {
      lines.push(
        [
          dayjs(r.created_at).format('DD.MM.YYYY HH:mm'),
          r.type,
          r.category,
          r.service_name || '',
          r.project_name || '',
          r.employee_name || '',
          r.quantity ?? '',
          r.unit_price ?? '',
          r.amount,
          r.balance_after,
          (r.comment || '').replace(/;/g, ','),
        ].join(';'),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send('\uFEFF' + lines.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка экспорта' });
  }
});

export default router;
