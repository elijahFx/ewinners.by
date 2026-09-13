import dayjs from 'dayjs';
import { query } from '../db.js';
import { generateActPdf } from './actPdf.js';
import { generateDetailPdf } from './detailPdf.js';

export async function ensureActForInvoice(invoice, company) {
  const existing = await query(
    `SELECT * FROM documents
     WHERE company_id = :company_id AND type = 'act' AND number = :number
     LIMIT 1`,
    { company_id: invoice.company_id, number: invoice.number },
  );
  if (existing[0]?.file_path) return existing[0];

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
  return rows[0];
}

export async function ensureDetailDocument(companyId, company) {
  const from = dayjs().startOf('month').format('YYYY-MM-DD HH:mm:ss');
  const to = dayjs().endOf('month').format('YYYY-MM-DD HH:mm:ss');
  const number = `DET-${dayjs().format('YYYYMM')}-${companyId}`;

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

  const { filePath } = await generateDetailPdf({
    number,
    company,
    items: mapped,
    periodLabel: dayjs().format('MMMM YYYY'),
    createdAt: dayjs().format('DD.MM.YYYY'),
  });

  const existing = await query(
    `SELECT * FROM documents WHERE company_id = :company_id AND type = 'detail' AND number = :number LIMIT 1`,
    { company_id: companyId, number },
  );

  if (existing[0]) {
    await query(
      `UPDATE documents SET file_path = :file_path, title = :title, status = 'ready', amount = :amount
       WHERE id = :id`,
      {
        id: existing[0].id,
        file_path: filePath,
        title: `Детализация услуг ${number}`,
        amount: mapped.reduce((s, i) => s + Number(i.amount || 0), 0),
      },
    );
    const rows = await query('SELECT * FROM documents WHERE id = :id', { id: existing[0].id });
    return rows[0];
  }

  const total = mapped.reduce((s, i) => s + Number(i.amount || 0), 0);
  const result = await query(
    `INSERT INTO documents (company_id, type, number, title, amount, status, file_path)
     VALUES (:company_id, 'detail', :number, :title, :amount, 'ready', :file_path)`,
    {
      company_id: companyId,
      number,
      title: `Детализация услуг ${number}`,
      amount: total,
      file_path: filePath,
    },
  );
  const rows = await query('SELECT * FROM documents WHERE id = :id', { id: result.insertId });
  return rows[0];
}
