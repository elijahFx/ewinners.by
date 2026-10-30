import { Router } from 'express';
import dayjs from 'dayjs';
import fs from 'fs';
import path from 'path';
import { query } from '../db.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { audit } from '../services/billing.js';
import { generateInvoicePdf } from '../services/invoicePdf.js';
import { ensureActForInvoice } from '../services/documents.js';
import { accountForDirection, listAccounts } from '../services/accounts.js';
import { fetchAllAccountsStatement, mtbankConfig } from '../services/mtbank.js';

/**
 * Рабочее место направления: HR, Digital, КЦ.
 *
 * Админ и сотрудник направления видят один и тот же набор действий:
 * список клиентов, создание клиента и генерация счёта/акта с пометкой.
 * Пометка попадает в назначение платежа счёта и в текст акта.
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

// Остаток и обороты по счетам берём из MTBank. Один такой запрос обслуживает
// все направления сразу, поэтому результат недолго кэшируем: переключение
// направления в интерфейсе не должно каждый раз ходить в банк.
const BANK_TIMEOUT_MS = 20_000;
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
    items: Object.entries(DIRECTIONS).map(([code, label]) => ({ code, label })),
  });
});

router.get('/accounts', async (req, res) => {
  try {
    const rows = await query(
      `SELECT account_iban,
              COUNT(*) AS invoices,
              SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS paid,
              SUM(CASE WHEN status <> 'paid' THEN amount ELSE 0 END) AS awaiting
         FROM invoices
        WHERE account_iban IS NOT NULL
        GROUP BY account_iban`,
    );
    const byIban = new Map(rows.map((r) => [r.account_iban, r]));
    res.json({
      items: listAccounts().map((a) => {
        const r = byIban.get(a.iban);
        return {
          ...a,
          invoices: Number(r?.invoices || 0),
          paid: Number(r?.paid || 0),
          awaiting: Number(r?.awaiting || 0),
        };
      }),
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
        'MTBank не ответил за 20 секунд. Попробуйте обновить позже.',
      );
      bankCache = { key: cacheKey, at: Date.now(), value: data };
    }

    // Копия обязательна: сортировка не должна менять закэшированный массив.
    const movements = [...(data.movements || [])]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 500)
      .map(compactMovement);

    const accounts = (data.accounts || []).map((a) => ({
      iban: a.iban,
      name: a.name || null,
      currency: a.currency || 'BYN',
      balance: a.balance ?? null,
      income: Number(a.income || 0),
      expense: Number(a.expense || 0),
      count: Number(a.count || 0),
      error: a.error || null,
    }));
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
    let where = 'WHERE 1 = 1';
    if (req.query.q) {
      where += ' AND (c.name LIKE :q OR c.unp LIKE :q OR c.iban LIKE :q)';
      params.q = `%${String(req.query.q).trim()}%`;
    }
    const rows = await query(
      `SELECT c.id, c.name, c.unp, c.iban, c.bank_name, c.bic, c.balance, c.status, c.created_at
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
    const result = await query(
      `INSERT INTO companies (name, unp, legal_address, bank_name, iban, bic, credit_limit, min_balance, notify_threshold, low_balance_action)
       VALUES (:name, :unp, :legal_address, :bank_name, :iban, :bic, :credit_limit, 0, :notify_threshold, 'allow_credit')`,
      {
        name,
        unp: String(req.body?.unp || '').trim() || null,
        legal_address: String(req.body?.legalAddress || '').trim() || null,
        bank_name: String(req.body?.bankName || '').trim() || null,
        iban: String(req.body?.iban || '').trim().toUpperCase() || null,
        bic: String(req.body?.bic || '').trim().toUpperCase() || null,
        credit_limit: Number(req.body?.creditLimit || 0),
        notify_threshold: Number(req.body?.notifyThreshold || 0),
      },
    );
    await audit(req.user.id, 'direction_create_company', 'company', result.insertId, {
      name,
      direction: req.body?.direction || null,
    });
    const created = await query('SELECT * FROM companies WHERE id = :id', { id: result.insertId });
    res.status(201).json({ company: created[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось создать клиента' });
  }
});

/**
 * Генерация счёта или акта с пометкой.
 * body: { companyId, kind: 'invoice' | 'act', amount, note }
 */
router.post('/documents', async (req, res) => {
  try {
    const companyId = Number(req.body?.companyId);
    const kind = req.body?.kind === 'act' ? 'act' : 'invoice';
    const note = String(req.body?.note || '').trim();
    // Счёт: админ может выбрать вручную, иначе берём счёт направления
    const explicit = String(req.body?.iban || '').trim();
    const account = explicit
      ? { iban: explicit.replace(/\s+/g, '') }
      : accountForDirection(req.body?.direction || 'kc');
    if (!companyId) return res.status(400).json({ error: 'Выберите клиента' });

    const companies = await query('SELECT * FROM companies WHERE id = :id LIMIT 1', { id: companyId });
    const company = companies[0];
    if (!company) return res.status(404).json({ error: 'Клиент не найден' });
    if (!company.unp || !company.name) {
      return res.status(400).json({ error: 'Заполните название и УНП клиента' });
    }

    if (kind === 'act') {
      // Для акта нужен счёт: берём последний или создаём новый на указанную сумму.
      const existing = await query(
        'SELECT * FROM invoices WHERE company_id = :id ORDER BY id DESC LIMIT 1',
        { id: companyId },
      );
      let invoice = existing[0];
      if (!invoice) {
        const amount = Number(req.body?.amount);
        if (!(amount > 0)) {
          return res.status(400).json({ error: 'Чтобы сформировать акт, укажите сумму — счёт ещё не создан' });
        }
        invoice = await createInvoice({ companyId, company, amount, note, userId: req.user.id, account });
      }
      const doc = await ensureActForInvoice(
        { ...invoice, purpose: note || invoice.purpose },
        company,
      );
      await audit(req.user.id, 'direction_generate_act', 'document', doc.id, {
        companyId,
        number: invoice.number,
      });
      return res.json({ document: doc, kind: 'act' });
    }

    const amount = Number(req.body?.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Укажите сумму счёта' });
    const invoice = await createInvoice({ companyId, company, amount, note, userId: req.user.id, account });
    await audit(req.user.id, 'direction_generate_invoice', 'invoice', invoice.id, {
      companyId,
      number: invoice.number,
    });
    return res.json({
      document: { id: invoice.id, number: invoice.number, title: `Счёт на оплату ${invoice.number}` },
      invoice,
      kind: 'invoice',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Не удалось сформировать документ' });
  }
});

async function createInvoice({ companyId, company, amount, note, userId, account }) {
  const countRows = await query('SELECT COUNT(*) AS c FROM invoices WHERE company_id = :id', {
    id: companyId,
  });
  const seq = Number(countRows[0].c) + 1;
  const number = `EW-${dayjs().format('YYYYMM')}-${companyId}-${String(seq).padStart(4, '0')}`;
  // Пометка админа становится назначением платежа — она же попадает в акт
  const purpose = note || `Пополнение авансового баланса по счёту ${number}.`;

  const { filePath } = await generateInvoicePdf({
    number,
    amount,
    purpose,
    company,
    createdAt: dayjs().format('DD.MM.YYYY'),
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

  await query(
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

  return { id: result.insertId, number, amount, purpose, file_path: filePath, company_id: companyId };
}

/** Отдача файла счёта или акта по номеру документа. */
router.get('/documents/:id/view', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM documents WHERE id = :id LIMIT 1', {
      id: Number(req.params.id),
    });
    const doc = rows[0];
    if (!doc?.file_path || !fs.existsSync(doc.file_path)) {
      return res.status(404).json({ error: 'Документ не найден' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(doc.file_path)}"`);
    return fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось открыть документ' });
  }
});

export default router;
