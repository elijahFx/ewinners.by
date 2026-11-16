import fs from 'fs';
import dayjs from 'dayjs';
import { query } from '../db.js';
import { actMonthTitle, generateActPdf } from './actPdf.js';
import { notifyCompanyUsers } from './notify.js';
import { queueDocumentBackup } from './yandexBackup.js';

/**
 * Акты по итогам месяца.
 *
 * Счёт — это пополнение баланса. Акт — это только те деньги, которые были
 * списаны с баланса за календарный месяц. Поэтому акт не привязан к счёту:
 * один акт на клиента за месяц, номер ACT-ГГГГММ-<id компании>.
 */

const OTHER_CATEGORY_LABELS = {
  manual_debit: 'Прочее списание с баланса',
  recalc: 'Пересчёт',
  extra_service: 'Дополнительная услуга',
  subscription: 'Абонентская плата',
};

/**
 * Названия услуг в акте.
 *
 * Внутренние названия тарифов содержат «апсейл/кроссейл», но в акте для
 * клиента используем понятную формулировку про повышение чека.
 */
const ACT_SERVICE_NAMES = {
  sr_order_upsell: 'Заказы с повышением чека',
  sr_order_base: 'Заказы без повышения чека',
};

export function actServiceName(row) {
  const code = String(row.service_code || '');
  return ACT_SERVICE_NAMES[code] || row.service_name || 'Услуга';
}

export function resolveActPeriod(period) {
  let start;

  if (period && typeof period === 'object' && period.start) {
    start = dayjs(period.start).startOf('month');
  } else if (period && /^\d{4}-\d{2}$/.test(String(period))) {
    start = dayjs(`${period}-01`).startOf('month');
  } else if (period) {
    start = dayjs(period).startOf('month');
  } else {
    start = dayjs().startOf('month');
  }

  if (!start.isValid()) {
    throw new Error('Некорректный период акта');
  }

  const end = start.endOf('month');
  return {
    start,
    end,
    key: start.format('YYYY-MM'),
    number: start.format('YYYYMM'),
    label: `${start.format('DD.MM.YYYY')} — ${end.format('DD.MM.YYYY')}`,
  };
}

export function actNumberFor(period, companyId) {
  const { number } = resolveActPeriod(period);
  return `ACT-${number}-${Number(companyId)}`;
}

/** Все списания с баланса за период. Пополнения сюда не попадают. */
export async function loadActTransactions(companyId, period) {
  const { start, end } = resolveActPeriod(period);
  return query(
    `SELECT t.id, t.service_id, t.category, t.comment, t.quantity, t.unit_price,
            t.amount, t.created_at, t.project_id,
            s.name AS service_name, s.unit AS service_unit, s.code AS service_code
       FROM transactions t
       LEFT JOIN services s ON s.id = t.service_id
      WHERE t.company_id = :company_id
        AND t.type = 'debit'
        AND t.status = 'posted'
        -- В акт попадают только оказанные услуги. Ручные корректировки
        -- («Ибо нехуй», «/» и т.п.) — это не услуги, их в акте быть не должно.
        AND t.service_id IS NOT NULL
        AND t.created_at BETWEEN :from AND :to
      ORDER BY t.created_at ASC, t.id ASC`,
    {
      company_id: Number(companyId),
      from: start.format('YYYY-MM-DD HH:mm:ss'),
      to: end.format('YYYY-MM-DD HH:mm:ss'),
    },
  );
}

function otherItemName(row) {
  const category = String(row.category || '');
  const base = OTHER_CATEGORY_LABELS[category] || 'Списание с баланса';
  const comment = String(row.comment || '').trim();
  // В таблице «Прочие списания с баланса» достаточно основания:
  // повторять «Прочее списание» в каждой строке не нужно.
  return comment || base;
}

/**
 * Схлопываем тысячи CRM-операций в понятные строки акта.
 *
 * Услуги группируются по услуге и категории, ручные списания — по основанию.
 * Количество суммируем только там, где оно реально есть.
 */
export function aggregateActItems(rows) {
  const groups = new Map();

  for (const row of rows) {
    const isService = row.service_id != null;
    const key = isService
      ? `service:${row.service_id}:${row.category || ''}`
      : `other:${row.category || ''}:${String(row.comment || '').trim()}`;

    if (!groups.has(key)) {
      groups.set(key, {
        name: isService ? actServiceName(row) : otherItemName(row),
        unit: isService ? row.service_unit || null : null,
        quantity: isService ? 0 : null,
        amount: 0,
        operations: 0,
        firstAt: row.created_at,
        isService,
      });
    }

    const item = groups.get(key);
    item.amount += Number(row.amount || 0);
    item.operations += 1;
    if (isService) item.quantity += Number(row.quantity || 0);
    if (row.created_at && item.firstAt && row.created_at < item.firstAt) {
      item.firstAt = row.created_at;
    }
  }

  return [...groups.values()]
    .map((item) => ({
      ...item,
      amount: Number(item.amount.toFixed(2)),
      quantity:
        item.quantity == null
          ? null
          : Number(Number(item.quantity).toFixed(3)),
    }))
    .sort((a, b) => {
      if (a.isService !== b.isService) return a.isService ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'ru');
    });
}

function normalizeCompany(company) {
  return {
    id: Number(company.id),
    name: company.name,
    unp: company.unp,
    legal_address: company.legal_address,
    direction: company.direction || 'kc',
  };
}

/**
 * Формирует (или обновляет) акт клиента за месяц.
 *
 * `force: true` пересобирает PDF и сумму — это нужно в последний день месяца
 * и на следующий день, когда могут появиться последние списания.
 * `save: false` используется для предпросмотра без записи в БД.
 */
export async function ensureMonthlyAct({
  company,
  period,
  force = false,
  skipIfEmpty = true,
  notify = true,
  save = true,
  outputPath = null,
} = {}) {
  if (!company?.id) throw new Error('Не указан клиент для акта');

  const resolved = resolveActPeriod(period);
  const companyData = normalizeCompany(company);
  const number = `ACT-${resolved.number}-${companyData.id}`;
  const rows = await loadActTransactions(companyData.id, resolved);
  const items = aggregateActItems(rows);
  const total = Number(items.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));

  if (!rows.length && skipIfEmpty) {
    return {
      skipped: true,
      reason: 'no_debits',
      company: companyData,
      period: resolved.key,
      number,
      total: 0,
      items: [],
      operationsCount: 0,
    };
  }

  let existing = null;
  if (save) {
    const existingRows = await query(
      `SELECT * FROM documents
        WHERE company_id = :company_id AND type = 'act' AND number = :number
        LIMIT 1`,
      { company_id: companyData.id, number },
    );
    existing = existingRows[0] || null;
    if (existing?.file_path && fs.existsSync(existing.file_path) && !force) {
      queueDocumentBackup(existing);
      return {
        skipped: false,
        created: false,
        updated: false,
        document: existing,
        company: companyData,
        period: resolved.key,
        number,
        total: Number(existing.amount || total),
        items,
        operationsCount: rows.length,
      };
    }
  }

  const title = `Акт оказанных услуг за ${actMonthTitle(resolved.start)}`;
  const createdAt = dayjs().format('DD.MM.YYYY');
  const { filePath } = await generateActPdf({
    number,
    company: companyData,
    items,
    periodStart: resolved.start.toDate(),
    periodEnd: resolved.end.toDate(),
    periodLabel: resolved.label,
    total,
    createdAt,
    direction: companyData.direction,
    operationsCount: rows.length,
    outputPath,
  });

  if (!save) {
    return {
      skipped: false,
      created: false,
      updated: false,
      preview: true,
      filePath,
      company: companyData,
      period: resolved.key,
      number,
      total,
      items,
      operationsCount: rows.length,
    };
  }

  let document;
  let created = false;
  let updated = false;

  const periodFrom = resolved.start.format('YYYY-MM-DD');
  const periodTo = resolved.end.format('YYYY-MM-DD');

  if (existing) {
    await query(
      `UPDATE documents
          SET file_path = :file_path,
              title = :title,
              amount = :amount,
              status = 'ready',
              period_from = :period_from,
              period_to = :period_to,
              created_at = CURRENT_TIMESTAMP
        WHERE id = :id`,
      {
        id: existing.id,
        file_path: filePath,
        title,
        amount: total,
        period_from: periodFrom,
        period_to: periodTo,
      },
    );
    const rowsAfter = await query('SELECT * FROM documents WHERE id = :id', { id: existing.id });
    document = rowsAfter[0];
    updated = true;
  } else {
    const result = await query(
      `INSERT INTO documents
        (company_id, type, number, title, amount, status, period_from, period_to, file_path)
       VALUES
        (:company_id, 'act', :number, :title, :amount, 'ready', :period_from, :period_to, :file_path)`,
      {
        company_id: companyData.id,
        number,
        title,
        amount: total,
        period_from: periodFrom,
        period_to: periodTo,
        file_path: filePath,
      },
    );
    const rowsAfter = await query('SELECT * FROM documents WHERE id = :id', {
      id: result.insertId,
    });
    document = rowsAfter[0];
    created = true;
  }

  queueDocumentBackup(document);

  if (created && notify) {
    try {
      await notifyCompanyUsers(
        companyData.id,
        'Акт оказанных услуг за месяц',
        `Сформирован ${title} на сумму ${total.toFixed(2)} BYN. Документ доступен в разделе «Документы».`,
      );
    } catch (err) {
      console.warn('[акты] не удалось отправить уведомление:', err.message);
    }
  }

  return {
    skipped: false,
    created,
    updated,
    document,
    company: companyData,
    period: resolved.key,
    number,
    total,
    items,
    operationsCount: rows.length,
  };
}

/** Формирует акты за месяц по всем клиентам (или по одному). */
export async function runMonthlyActs({
  period,
  companyId = null,
  force = false,
  notify = true,
  skipIfEmpty = true,
} = {}) {
  const resolved = resolveActPeriod(period);
  const params = {};
  let sql = `SELECT id, name, unp, legal_address, direction
               FROM companies
              WHERE is_oneoff = 0`;

  if (companyId) {
    sql += ' AND id = :company_id';
    params.company_id = Number(companyId);
  }

  sql += ' ORDER BY id ASC';
  const companies = await query(sql, params);

  const summary = {
    period: resolved.key,
    companies: companies.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  for (const company of companies) {
    try {
      const result = await ensureMonthlyAct({
        company,
        period: resolved.key,
        force,
        notify,
        skipIfEmpty,
      });
      if (result.skipped) summary.skipped += 1;
      else if (result.created) summary.created += 1;
      else if (result.updated) summary.updated += 1;
      if (!result.skipped) {
        summary.results.push({
          companyId: company.id,
          companyName: company.name,
          number: result.number,
          total: result.total,
          operationsCount: result.operationsCount,
        });
      }
    } catch (err) {
      summary.failed += 1;
      summary.results.push({
        companyId: company.id,
        companyName: company.name,
        error: err.message,
      });
      console.error(`[акты] ${company.name}: ${err.message}`);
    }
  }

  console.log(
    `[акты] ${resolved.key}: создано ${summary.created}, обновлено ${summary.updated}, ` +
      `пропущено ${summary.skipped}, ошибок ${summary.failed}`,
  );

  return summary;
}
