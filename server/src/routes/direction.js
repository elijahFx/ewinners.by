import { Router } from 'express';
import dayjs from 'dayjs';
import fs from 'fs';
import path from 'path';
import { query } from '../db.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { audit } from '../services/billing.js';
import { generateInvoicePdf } from '../services/invoicePdf.js';
import { accountByIban, accountForDirection, listAccounts } from '../services/accounts.js';
import { fetchAllAccountsStatement, mtbankConfig } from '../services/mtbank.js';

/**
 * Рабочее место направления: HR, Digital, КЦ.
 *
 * Админ и сотрудник направления видят один и тот же набор действий:
 * список клиентов, создание клиента и генерация счёта с пометкой.
 * Пометка попадает в назначение платежа счёта. Акт формируется автоматически
 * по итогам месяца и отражает только списания с баланса.
 */
const router = Router();
router.use(authRequired, requireRoles('admin', 'accountant', 'hr'));

const DIRECTIONS = {
  hr: 'HR',
  digital: 'Digital',
  kc: 'КЦ',
};

function directionLabel(code) {
  return DIRECTIONS[String(code || '').toLowerCase()] || null;
}

function isHrUser(req) {
  return req.user?.role === 'hr';
}

/**
 * HR-сотрудник работает только с HR. Это ограничение серверное, а не только
 * скрытие переключателя: даже прямой запрос direction=digital вернёт HR.
 */
function resolveDirection(req, value, fallback = 'kc') {
  const requested = String(value || '').toLowerCase();
  const code = ['hr', 'digital', 'kc'].includes(requested) ? requested : fallback;
  return isHrUser(req) ? 'hr' : code;
}

function normIban(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

// Остаток и обороты по счетам берём из MTBank. Один такой запрос обслуживает
// все направления сразу, поэтому результат недолго кэшируем: переключение
// направления в интерфейсе не должно каждый раз ходить в банк.
const BANK_TIMEOUT_MS = 45_000;
const BANK_CACHE_TTL_MS = 60_000;
let bankCache = { key: '', at: 0, value: null };

function periodFromQuery(query) {
  const from =
    String(query?.from || '').slice(0, 10) ||
    dayjs().startOf('month').format('YYYY-MM-DD');
  const to = String(query?.to || '').slice(0, 10) || dayjs().format('YYYY-MM-DD');
  return { from, to };
}

/** Ограничиваем ожидание банка, чтобы страница не висела без ответа. */
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function compactMovement(m) {
  return {
    id: m.id,
    accountIban: m.accountIban,
    direction: m.direction,
    amount: m.amount,
    currency: m.currency,
    date: m.date,
    counterparty: m.counterparty,
    unp: m.unp,
    purpose: m.purpose,
    reference: m.reference,
    balanceAfter: m.balanceAfter,
  };
}

router.get('/directions', (req, res) => {
  res.json({
    items: Object.entries(DIRECTIONS)
      .filter(([code]) => !isHrUser(req) || code === 'hr')
      .map(([code, label]) => ({ code, label })),
  });
});

router.get('/accounts', async (req, res) => {
  try {
    const rows = await query(
      `SELECT account_iban,
              COUNT(*) AS invoices,
              SUM(CASE
                    WHEN status = 'paid' THEN amount
                    WHEN status = 'partially_paid' THEN paid_amount
                    ELSE 0
                  END) AS paid,
              SUM(CASE
                    WHEN status = 'partially_paid' THEN GREATEST(amount - paid_amount, 0)
                    WHEN status IN ('created', 'awaiting_payment', 'overdue', 'needs_review') THEN amount
                    ELSE 0
                  END) AS awaiting
         FROM invoices
        WHERE account_iban IS NOT NULL
        GROUP BY account_iban`,
    );
    const byIban = new Map(rows.map((r) => [r.account_iban, r]));
    const items = listAccounts().map((a) => {
      const r = byIban.get(a.iban);
      return {
        ...a,
        invoices: Number(r?.invoices || 0),
        paid: Number(r?.paid || 0),
        awaiting: Number(r?.awaiting || 0),
      };
    });
    res.json({
      items: isHrUser(req) ? items.filter((a) => a.code === 'hr') : items,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить счета' });
  }
});

/**
 * Остаток, поступления и расходы по всем счетам направлений за период.
 *
 * Возвращаем данные сразу по всем счетам согласия MTBank: при переключении
 * направления страница берёт нужный счёт из уже загруженного ответа, а не
 * ждёт новый запрос в банк. Свежесть — не дольше минуты, кнопка «Обновить»
 * передаёт refresh=1 и обходит кэш.
 */
router.get('/bank', async (req, res) => {
  const period = periodFromQuery(req.query);
  const cfg = mtbankConfig();

  if (!cfg.configured) {
    return res.json({
      configured: false,
      ready: false,
      period,
      fetchedAt: null,
      message: 'MTBank API не настроен: укажите MTBANK_API_KEY в .env.',
      accounts: [],
      movements: [],
    });
  }

  if (!cfg.consentId) {
    return res.json({
      configured: true,
      ready: false,
      period,
      fetchedAt: null,
      message:
        'MTBank: нет активного согласия. Укажите MTBANK_CONSENT_ID и авторизуйте счета в кабинете банка.',
      accounts: [],
      movements: [],
    });
  }

  const refresh = req.query.refresh === '1';
  const cacheKey = `${period.from}|${period.to}`;

  try {
    let data;
    const cacheFresh =
      bankCache.key === cacheKey && Date.now() - bankCache.at < BANK_CACHE_TTL_MS;
    if (!refresh && cacheFresh) {
      data = bankCache.value;
    } else {
      data = await withTimeout(
        fetchAllAccountsStatement({ from: period.from, to: period.to, refresh }),
        BANK_TIMEOUT_MS,
        'MTBank не ответил за 45 секунд. Попробуйте обновить позже.',
      );
      bankCache = { key: cacheKey, at: Date.now(), value: data };
    }

    // Копия обязательна: сортировка не должна менять закэшированный массив.
    let movements = [...(data.movements || [])]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 500)
      .map(compactMovement);

    let accounts = (data.accounts || []).map((a) => ({
      iban: a.iban,
      name: a.name || null,
      currency: a.currency || 'BYN',
      balance: a.balance ?? null,
      income: Number(a.income || 0),
      expense: Number(a.expense || 0),
      count: Number(a.count || 0),
      error: a.error || null,
    }));
    if (isHrUser(req)) {
      const hrIban = normIban(accountForDirection('hr')?.iban);
      accounts = accounts.filter((a) => normIban(a.iban) === hrIban);
      movements = movements.filter((m) => normIban(m.accountIban) === hrIban);
    }
    const failed = accounts.filter((a) => a.error);
    // Если банк отдал только часть счетов, честно говорим об этом.
    const message = failed.length
      ? failed.length === accounts.length
        ? failed[0].error
        : `MTBank: нет данных по ${failed.length} из ${accounts.length} счетов`
      : null;

    return res.json({
      configured: true,
      ready: failed.length !== accounts.length,
      period: data.period || period,
      fetchedAt: data.fetchedAt || new Date().toISOString(),
      message,
      accounts,
      movements,
    });
  } catch (err) {
    console.error('[direction] bank:', err.message);
    return res.json({
      configured: true,
      ready: false,
      period,
      fetchedAt: null,
      message: err.message || 'Не удалось загрузить данные MTBank',
      accounts: [],
      movements: [],
    });
  }
});

router.get('/companies', async (req, res) => {
  try {
    const params = {};
    let where = 'WHERE c.is_oneoff = 0';
    if (isHrUser(req)) {
      where += ' AND c.direction = :direction';
      params.direction = 'hr';
    } else {
      const direction = String(req.query.direction || '').toLowerCase();
      if (['hr', 'digital', 'kc'].includes(direction)) {
        where += ' AND c.direction = :direction';
        params.direction = direction;
      }
    }
    if (req.query.q) {
      where += ' AND (c.name LIKE :q OR c.unp LIKE :q OR c.iban LIKE :q)';
      params.q = `%${String(req.query.q).trim()}%`;
    }
    const rows = await query(
      `SELECT c.id, c.name, c.unp, c.iban, c.bank_name, c.bic, c.balance, c.status,
              c.direction, c.created_at
         FROM companies c ${where}
        ORDER BY c.id DESC
        LIMIT 500`,
      params,
    );
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить клиентов' });
  }
});

router.post('/companies', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Укажите название клиента' });
    const direction = resolveDirection(req, req.body?.direction, 'kc');
    const result = await query(
      `INSERT INTO companies
        (name, unp, legal_address, bank_name, iban, bic, credit_limit, min_balance,
         notify_threshold, low_balance_action, direction)
       VALUES
        (:name, :unp, :legal_address, :bank_name, :iban, :bic, :credit_limit, 0,
         :notify_threshold, 'allow_credit', :direction)`,
      {
        name,
        unp: String(req.body?.unp || '').trim() || null,
        legal_address: String(req.body?.legalAddress || '').trim() || null,
        bank_name: String(req.body?.bankName || '').trim() || null,
        iban: String(req.body?.iban || '').trim().toUpperCase() || null,
        bic: String(req.body?.bic || '').trim().toUpperCase() || null,
        credit_limit: Number(req.body?.creditLimit || 0),
        notify_threshold: Number(req.body?.notifyThreshold || 0),
        direction,
      },
    );
    await audit(req.user.id, 'direction_create_company', 'company', result.insertId, {
      name,
      direction,
    });
    const created = await query('SELECT * FROM companies WHERE id = :id', { id: result.insertId });
    res.status(201).json({ company: created[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать клиента' });
  }
});

/** Счета выбранного направления — для списка на рабочем месте. */
router.get('/invoices', async (req, res) => {
  try {
    const direction = resolveDirection(req, req.query.direction, 'kc');
    const account = accountForDirection(direction);
    if (!account) return res.status(400).json({ error: 'Направление не найдено' });

    const params = { iban: account.iban };
    const where =
      direction === 'kc'
        ? '(i.account_iban = :iban OR i.account_iban IS NULL)'
        : 'i.account_iban = :iban';

    const rows = await query(
      `SELECT i.id, i.number, i.amount, i.status, i.purpose, i.created_at, i.paid_at,
              c.name AS company_name, c.unp AS company_unp, c.direction AS company_direction,
              (SELECT d.id FROM documents d
                WHERE d.company_id = i.company_id AND d.number = i.number AND d.type = 'invoice'
                ORDER BY d.id DESC LIMIT 1) AS invoice_document_id
         FROM invoices i
         JOIN companies c ON c.id = i.company_id
        WHERE ${where}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT 200`,
      params,
    );
    res.json({ direction, items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить счета направления' });
  }
});

/**
 * Генерация счёта с пометкой.
 * body: { companyId, kind: 'invoice', amount, note }
 *
 * Акт здесь не формируется: он создаётся автоматически по итогам месяца
 * и отражает только списания с баланса.
 */
router.post('/documents', async (req, res) => {
  try {
    let companyId = Number(req.body?.companyId);
    if (req.body?.kind === 'act') {
      return res.status(403).json({
        error:
          'Акт оказанных услуг формируется автоматически по итогам месяца. ' +
          'Ручная генерация акта недоступна.',
      });
    }
    const note = String(req.body?.note || '').trim();
    // Счёт: админ может выбрать вручную, иначе берём счёт направления.
    // Направление определяем по самому счёту, а не только по телу запроса.
    const requestedDirection = resolveDirection(req, req.body?.direction, 'kc');
    // HR не может подменить счёт вручную: только счёт HR.
    const explicit = isHrUser(req) ? '' : String(req.body?.iban || '').trim();
    const account = explicit
      ? accountByIban(explicit) || { iban: explicit.replace(/\s+/g, '') }
      : accountForDirection(requestedDirection);
    const invoiceDirection = account?.code || requestedDirection;

    let company = null;
    if (companyId) {
      const companies = await query('SELECT * FROM companies WHERE id = :id LIMIT 1', {
        id: companyId,
      });
      company = companies[0];
      if (!company) return res.status(404).json({ error: 'Клиент не найден' });
    } else {
      // Разовый клиент: создаём скрытую карточку только для счёта.
      // В список клиентов она не попадает (is_oneoff = 1).
      const oneoff = req.body?.oneoff && typeof req.body.oneoff === 'object'
        ? req.body.oneoff
        : null;
      const name = String(oneoff?.name || '').trim();
      const unp = String(oneoff?.unp || '').trim();
      if (!name) {
        return res.status(400).json({
          error: 'Выберите клиента из списка или заполните название разового клиента',
        });
      }
      if (!unp) {
        return res.status(400).json({ error: 'Для разового клиента укажите УНП' });
      }
      const created = await query(
        `INSERT INTO companies
          (name, unp, legal_address, bank_name, iban, bic, credit_limit, min_balance,
           notify_threshold, low_balance_action, direction, is_oneoff, status)
         VALUES
          (:name, :unp, :legal_address, :bank_name, :iban, :bic, 0, 0,
           0, 'allow_debt', :direction, 1, 'active')`,
        {
          name,
          unp,
          legal_address: String(oneoff?.legalAddress || '').trim() || null,
          bank_name: String(oneoff?.bankName || '').trim() || null,
          iban: String(oneoff?.iban || '').trim().toUpperCase() || null,
          bic: String(oneoff?.bic || '').trim().toUpperCase() || null,
          direction: invoiceDirection,
        },
      );
      companyId = created.insertId;
      const rows = await query('SELECT * FROM companies WHERE id = :id LIMIT 1', {
        id: companyId,
      });
      company = rows[0];
      await audit(req.user.id, 'direction_create_oneoff', 'company', companyId, {
        name,
        unp,
        direction: invoiceDirection,
      });
    }
    if (isHrUser(req) && company.direction !== 'hr') {
      return res.status(403).json({ error: 'HR-сотруднику доступны только клиенты HR' });
    }
    if (company.direction && company.direction !== invoiceDirection) {
      return res.status(400).json({
        error: `Клиент относится к направлению ${directionLabel(company.direction) || company.direction}, а счёт — ${directionLabel(invoiceDirection) || invoiceDirection}`,
      });
    }
    if (!company.unp || !company.name) {
      return res.status(400).json({ error: 'Заполните название и УНП клиента' });
    }

    const amount = Number(req.body?.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Укажите сумму счёта' });
    const invoice = await createInvoice({
      companyId,
      company,
      amount,
      note,
      userId: req.user.id,
      account,
      direction: invoiceDirection,
    });
    await audit(req.user.id, 'direction_generate_invoice', 'invoice', invoice.id, {
      companyId,
      number: invoice.number,
    });
    return res.json({
      // Именно id документа: /documents/:id/view ищет строку в documents,
      // а invoice.id — это другая последовательность (иначе откроется чужой акт).
      document: {
        id: invoice.documentId,
        number: invoice.number,
        title: `Счёт на оплату ${invoice.number}`,
      },
      invoice,
      kind: 'invoice',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Не удалось сформировать документ' });
  }
});

async function createInvoice({
  companyId,
  company,
  amount,
  note,
  userId,
  account,
  direction = 'kc',
}) {
  const countRows = await query('SELECT COUNT(*) AS c FROM invoices WHERE company_id = :id', {
    id: companyId,
  });
  const seq = Number(countRows[0].c) + 1;
  const number = `EW-${dayjs().format('YYYYMM')}-${companyId}-${String(seq).padStart(4, '0')}`;
  const createdAt = dayjs().format('DD.MM.YYYY');
  // Пометка админа становится назначением платежа счёта.
  // «Пополнение баланса» — только для КЦ; HR и Digital оплачивают услуги.
  const defaultPurpose =
    direction === 'kc'
      ? `Пополнение авансового баланса по счёту ${number}.`
      : `Оплата услуг по счёту ${number} от ${createdAt}.`;
  const purpose = note || defaultPurpose;

  const { filePath } = await generateInvoicePdf({
    number,
    amount,
    purpose,
    company,
    createdAt,
    iban: account?.iban,
  });

  const result = await query(
    `INSERT INTO invoices (number, company_id, amount, status, purpose, file_path, created_by, account_iban)
     VALUES (:number, :company_id, :amount, 'awaiting_payment', :purpose, :file_path, :created_by, :account_iban)`,
    {
      number,
      company_id: companyId,
      amount,
      purpose,
      file_path: filePath,
      created_by: userId,
      account_iban: account?.iban || null,
    },
  );

  const docResult = await query(
    `INSERT INTO documents (company_id, type, number, title, amount, status, file_path)
     VALUES (:company_id, 'invoice', :number, :title, :amount, 'awaiting_payment', :file_path)`,
    {
      company_id: companyId,
      number,
      title: `Счёт на оплату ${number}`,
      amount,
      file_path: filePath,
    },
  );

  return {
    id: result.insertId,
    documentId: docResult.insertId,
    number,
    amount,
    purpose,
    file_path: filePath,
    company_id: companyId,
  };
}

async function loadDirectionDocument(req) {
  const rows = await query(
    `SELECT d.*, c.direction AS company_direction,
            (SELECT i.account_iban FROM invoices i
              WHERE i.company_id = d.company_id AND i.number = d.number
              ORDER BY i.id DESC LIMIT 1) AS invoice_account_iban
       FROM documents d
       JOIN companies c ON c.id = d.company_id
      WHERE d.id = :id LIMIT 1`,
    { id: Number(req.params.id) },
  );
  const doc = rows[0];
  if (!doc) {
    const err = new Error('Документ не найден');
    err.status = 404;
    throw err;
  }
  // Направление документа определяем по счёту, а не только по карточке
  // клиента: у клиента может быть исторический счёт другого направления.
  const docDirection = accountByIban(doc.invoice_account_iban)?.code || doc.company_direction;
  if (isHrUser(req) && docDirection !== 'hr') {
    const err = new Error('HR-сотруднику доступны только документы HR');
    err.status = 403;
    throw err;
  }
  if (!doc.file_path || !fs.existsSync(doc.file_path)) {
    const err = new Error('Файл документа не найден');
    err.status = 404;
    throw err;
  }
  return doc;
}

/** Отдача файла счёта или акта по номеру документа. */
router.get('/documents/:id/view', async (req, res) => {
  try {
    const doc = await loadDirectionDocument(req);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(doc.file_path)}"`);
    return fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Не удалось открыть документ' });
  }
});

router.get('/documents/:id/download', async (req, res) => {
  try {
    const doc = await loadDirectionDocument(req);
    await query('UPDATE documents SET downloaded_at = NOW() WHERE id = :id', { id: doc.id });
    res.download(doc.file_path, path.basename(doc.file_path));
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Не удалось скачать документ' });
  }
});

export default router;
