import dayjs from 'dayjs';
import { query } from '../db.js';
import { generateActPdf } from './actPdf.js';
import { generateDetailPdf } from './detailPdf.js';
import { queueDocumentBackup } from './yandexBackup.js';

export async function ensureActForInvoice(invoice, company) {
  const existing = await query(
    `SELECT * FROM documents
     WHERE company_id = :company_id AND type = 'act' AND number = :number
     LIMIT 1`,
    { company_id: invoice.company_id, number: invoice.number },
  );
  if (existing[0]?.file_path) {
    queueDocumentBackup(existing[0]);
    return existing[0];
  }

  const { filePath } = await generateActPdf({
    number: invoice.number,
    amount: invoice.amount,
    purpose: invoice.purpose,
    company,
    createdAt: dayjs(invoice.paid_at || invoice.created_at).format('DD.MM.YYYY'),
    paidAt: invoice.paid_at ? dayjs(invoice.paid_at).format('DD.MM.YYYY') : null,
  });

  if (existing[0]) {
    await query(
      `UPDATE documents SET file_path = :file_path, status = 'paid', amount = :amount, title = :title
       WHERE id = :id`,
      {
        id: existing[0].id,
        file_path: filePath,
        amount: invoice.amount,
        title: `Акт оказанных услуг ${invoice.number}`,
      },
    );
    const rows = await query('SELECT * FROM documents WHERE id = :id', { id: existing[0].id });
    queueDocumentBackup(rows[0]);
    return rows[0];
  }

  const result = await query(
    `INSERT INTO documents (company_id, type, number, title, amount, status, project_id, file_path)
     VALUES (:company_id, 'act', :number, :title, :amount, 'paid', :project_id, :file_path)`,
    {
      company_id: invoice.company_id,
      number: invoice.number,
      title: `Акт оказанных услуг ${invoice.number}`,
      amount: invoice.amount,
      project_id: invoice.project_id || null,
      file_path: filePath,
    },
  );

  await query(
    `UPDATE documents SET status = 'paid'
     WHERE company_id = :company_id AND type = 'invoice' AND number = :number`,
    { company_id: invoice.company_id, number: invoice.number },
  );

  const rows = await query('SELECT * FROM documents WHERE id = :id', { id: result.insertId });
  queueDocumentBackup(rows[0]);
  return rows[0];
}

export async function ensureDetailDocument(companyId, company, options = {}) {
  const periodStart = options.from
    ? dayjs(options.from).startOf('day')
    : dayjs().startOf('month');
  const periodEnd = options.to
    ? dayjs(options.to).endOf('day')
    : dayjs().endOf('month');

  if (!periodStart.isValid() || !periodEnd.isValid()) {
    throw new Error('Некорректный период детализации');
  }
  if (periodEnd.isBefore(periodStart)) {
    throw new Error('Дата окончания периода раньше даты начала');
  }

  const from = periodStart.format('YYYY-MM-DD HH:mm:ss');
  const to = periodEnd.format('YYYY-MM-DD HH:mm:ss');
  const number = `DET-${periodStart.format('YYYYMM')}-${companyId}`;

  const items = await query(
    `SELECT t.amount, t.quantity, t.comment, t.category, t.created_at,
            s.name AS service_name
     FROM transactions t
     LEFT JOIN services s ON s.id = t.service_id
     WHERE t.company_id = :company_id
       AND t.type = 'debit'
       AND t.status = 'posted'
       AND t.created_at BETWEEN :from AND :to
     ORDER BY t.created_at ASC`,
    { company_id: companyId, from, to },
  );

  const mapped = items.map((t) => ({
    date: dayjs(t.created_at).format('DD.MM.YYYY'),
    service_name: t.service_name,
    comment: t.comment,
    category: t.category,
    quantity: t.quantity,
    amount: t.amount,
  }));

  const periodLabel = `${periodStart.format('DD.MM.YYYY')} — ${periodEnd.format('DD.MM.YYYY')}`;

  const { filePath } = await generateDetailPdf({
    number,
    company,
    items: mapped,
    periodLabel,
    createdAt: dayjs().format('DD.MM.YYYY'),
  });

  const total = mapped.reduce((s, i) => s + Number(i.amount || 0), 0);
  const title = `Детализация услуг ${number}`;
  const periodFrom = periodStart.format('YYYY-MM-DD');
  const periodTo = periodEnd.format('YYYY-MM-DD');

  const existing = await query(
    `SELECT * FROM documents WHERE company_id = :company_id AND type = 'detail' AND number = :number LIMIT 1`,
    { company_id: companyId, number },
  );

  let document;
  let updated = false;

  if (existing[0]) {
    await query(
      `UPDATE documents
       SET file_path = :file_path,
           title = :title,
           status = 'ready',
           amount = :amount,
           period_from = :period_from,
           period_to = :period_to,
           created_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      {
        id: existing[0].id,
        file_path: filePath,
        title,
        amount: total,
        period_from: periodFrom,
        period_to: periodTo,
      },
    );
    const rows = await query('SELECT * FROM documents WHERE id = :id', { id: existing[0].id });
    document = rows[0];
    updated = true;
  } else {
    const result = await query(
      `INSERT INTO documents
        (company_id, type, number, title, amount, status, period_from, period_to, file_path)
       VALUES
        (:company_id, 'detail', :number, :title, :amount, 'ready', :period_from, :period_to, :file_path)`,
      {
        company_id: companyId,
        number,
        title,
        amount: total,
        period_from: periodFrom,
        period_to: periodTo,
        file_path: filePath,
      },
    );
    const rows = await query('SELECT * FROM documents WHERE id = :id', { id: result.insertId });
    document = rows[0];
  }

  queueDocumentBackup(document);

  const emptyNote =
    mapped.length === 0
      ? ' За выбранный период списаний нет — документ пустой (сумма 0.00 BYN).'
      : ` Операций: ${mapped.length}, сумма ${total.toFixed(2)} BYN.`;

  const message = updated
    ? `Детализация за период ${periodLabel} уже была в списке — PDF обновлён.${emptyNote}`
    : `Создана новая детализация за период ${periodLabel}.${emptyNote}`;

  return {
    document,
    updated,
    created: !updated,
    itemCount: mapped.length,
    periodLabel,
    message,
  };
}
