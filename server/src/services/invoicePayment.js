import { query, withTransaction } from '../db.js';
import { applyBalanceChange, audit, notifyCompanyUsers } from './billing.js';

/**
 * Mark invoice paid, credit company balance, update document status.
 * Idempotent if invoice is already paid.
 */
export async function markInvoicePaid({
  invoiceId,
  amount = null,
  comment = null,
  createdBy = null,
  skipNotify = false,
} = {}) {
  const rows = await query('SELECT * FROM invoices WHERE id = :id LIMIT 1', { id: invoiceId });
  const invoice = rows[0];
  if (!invoice) {
    const err = new Error('Счёт не найден');
    err.status = 404;
    throw err;
  }
  if (invoice.status === 'paid') {
    return { alreadyPaid: true, invoice, balance: null };
  }
  if (invoice.status === 'cancelled') {
    const err = new Error('Отменённый счёт нельзя отметить оплаченным');
    err.status = 400;
    throw err;
  }

  const companyId = Number(invoice.company_id);
  const payAmount = amount != null ? Number(amount) : Number(invoice.amount);
  if (!(payAmount > 0)) {
    const err = new Error('Некорректная сумма счёта');
    err.status = 400;
    throw err;
  }

  const result = await withTransaction(async (conn) => {
    const applied = await applyBalanceChange({
      conn,
      companyId,
      invoiceId,
      type: 'credit',
      category: 'bank_payment',
      amount: payAmount,
      comment: comment || `Оплата счёта ${invoice.number}`,
      createdBy,
    });

    await conn.execute(
      `UPDATE invoices
       SET status = 'paid', paid_amount = ?, paid_at = NOW()
       WHERE id = ? AND status <> 'paid'`,
      [payAmount, invoiceId],
    );

    await conn.execute(
      `UPDATE documents
       SET status = 'paid'
       WHERE company_id = ? AND type = 'invoice' AND number = ?`,
      [companyId, invoice.number],
    );

    return applied;
  });

  if (!skipNotify) {
    await notifyCompanyUsers(
      companyId,
      'Счёт оплачен',
      `Счёт ${invoice.number} оплачен. На баланс зачислено ${payAmount.toFixed(2)} BYN.`,
    );
  }

  try {
    const companyRows = await query('SELECT * FROM companies WHERE id = :id LIMIT 1', {
      id: companyId,
    });
    const invRows = await query('SELECT * FROM invoices WHERE id = :id LIMIT 1', { id: invoiceId });
    if (invRows[0] && companyRows[0]) {
      const { ensureActForInvoice } = await import('./documents.js');
      await ensureActForInvoice(invRows[0], companyRows[0]);
      if (!skipNotify) {
        await notifyCompanyUsers(
          companyId,
          'Акт оказанных услуг',
          `Сформирован акт ${invoice.number}. Документ доступен в разделе «Документы».`,
        );
      }
    }
  } catch (err) {
    console.warn('Act generation failed:', err.message);
  }

  if (createdBy) {
    await audit(createdBy, 'mark_invoice_paid', 'invoice', invoiceId, {
      companyId,
      amount: payAmount,
      number: invoice.number,
    });
  }

  const updated = await query(
    `SELECT i.*, c.name AS company_name, c.unp AS company_unp, c.balance AS company_balance
     FROM invoices i
     JOIN companies c ON c.id = i.company_id
     WHERE i.id = :id`,
    { id: invoiceId },
  );

  return { alreadyPaid: false, invoice: updated[0], balance: result };
}
