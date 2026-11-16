import dayjs from 'dayjs';
import { query } from '../db.js';
import {
  amountsMatch,
  extractInvoiceNumbersFromPurpose,
  fetchMtbankStatement,
  mtbankConfig,
} from './mtbank.js';
import { markInvoicePaid } from './invoicePayment.js';
import { audit, notifyCompanyUsers } from './billing.js';

async function findInvoiceByNumber(number) {
  const rows = await query(
    `SELECT * FROM invoices
     WHERE UPPER(number) = :number
       AND status IN ('awaiting_payment', 'partially_paid', 'created', 'overdue', 'needs_review', 'paid')
     ORDER BY id DESC
     LIMIT 1`,
    { number: String(number).toUpperCase() },
  );
  return rows[0] || null;
}

async function findCreditedPaymentForInvoice(invoiceId, amount) {
  const rows = await query(
    `SELECT id FROM bank_payments
      WHERE invoice_id = :invoice_id AND status = 'credited' AND amount = :amount
      ORDER BY id ASC
      LIMIT 1`,
    { invoice_id: Number(invoiceId), amount: Number(amount) },
  );
  return rows[0] || null;
}

/**
 * Ищем уже импортированный платёж.
 *
 * MTBank в разных выписках может вернуть один и тот же платёж с разным
 * reference/transactionId (в нём меняется дата выписки). Поэтому кроме
 * внешнего id сверяем устойчивый отпечаток: сумма, дата операции, плательщик
 * и назначение платежа. Иначе один платёж за 7 дней превращается в 8 копий.
 */
async function paymentAlreadyImported(externalId, movement = null) {
  if (externalId) {
    const rows = await query(
      `SELECT id, status, invoice_id FROM bank_payments
       WHERE external_id = :external_id
       LIMIT 1`,
      { external_id: String(externalId) },
    );
    if (rows[0]) return rows[0];
  }

  if (!movement) return null;

  const rows = await query(
    `SELECT id, status, invoice_id FROM bank_payments
      WHERE provider = 'mtbank'
        AND direction = :direction
        AND amount = :amount
        AND operation_date = :operation_date
        AND COALESCE(payer_unp, '') = COALESCE(:payer_unp, '')
        AND COALESCE(purpose, '') = COALESCE(:purpose, '')
      ORDER BY (status = 'credited') DESC, id ASC
      LIMIT 1`,
    {
      direction: movement.direction === 'expense' ? 'expense' : 'income',
      amount: Number(movement.amount),
      operation_date: movement.date || null,
      payer_unp: movement.unp || '',
      purpose: movement.purpose || '',
    },
  );
  return rows[0] || null;
}

async function insertBankPayment({
  movement,
  invoiceId = null,
  companyId = null,
  status = 'unmatched',
}) {
  const result = await query(
    `INSERT INTO bank_payments
      (direction, amount, payer_name, payer_unp, reference, purpose, invoice_id, company_id,
       status, operation_date, external_id, provider)
     VALUES
      (:direction, :amount, :payer_name, :payer_unp, :reference, :purpose, :invoice_id, :company_id,
       :status, :operation_date, :external_id, 'mtbank')`,
    {
      direction: movement.direction === 'expense' ? 'expense' : 'income',
      amount: Number(movement.amount),
      payer_name: movement.counterparty || null,
      payer_unp: movement.unp || null,
      reference: movement.reference || null,
      purpose: movement.purpose || null,
      invoice_id: invoiceId,
      company_id: companyId,
      status,
      operation_date: movement.date || dayjs().format('YYYY-MM-DD'),
      external_id: movement.id ? String(movement.id) : null,
    },
  );
  return result.insertId;
}

/**
 * Pull recent MTBank credits and auto-mark invoices paid when
 * purpose contains invoice number and amount matches.
 */
export async function syncMtbankPayments({ from, to, lookbackDays = 7 } = {}) {
  const cfg = mtbankConfig();
  const dateTo = String(to || dayjs().format('YYYY-MM-DD')).slice(0, 10);
  const dateFrom = String(
    from || dayjs(dateTo).subtract(lookbackDays, 'day').format('YYYY-MM-DD'),
  ).slice(0, 10);

  // MTBank иногда отдаёт длинный период (7 дней) без самых свежих платежей:
  // список строится по кэшу и новый платёж в него не попадает. Поэтому кроме
  // общего периода всегда запрашиваем короткий «свежий» хвост за 3 дня и
  // объединяем результаты. Иначе оплата видна в банкинге, но не зачисляется.
  const recentFrom = dayjs(dateTo).subtract(2, 'day').format('YYYY-MM-DD');
  const freshFrom = recentFrom < dateFrom ? dateFrom : recentFrom;
  const ranges =
    freshFrom === dateFrom
      ? [[dateFrom, dateTo]]
      : [
          [dateFrom, dateTo],
          [freshFrom, dateTo],
        ];

  const results = await Promise.allSettled(
    ranges.map(([rangeFrom, rangeTo]) =>
      fetchMtbankStatement({ from: rangeFrom, to: rangeTo, refresh: true }),
    ),
  );
  const statements = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const statement = statements.find((item) => item.configured && item.ready);

  if (!statement) {
    const first = statements[0];
    return {
      ok: false,
      configured: Boolean(first?.configured),
      ready: Boolean(first?.ready),
      message:
        first?.message ||
        results.find((result) => result.status === 'rejected')?.reason?.message ||
        'MTBank: не удалось получить выписку',
      period: { from: dateFrom, to: dateTo },
      scanned: 0,
      matched: 0,
      paid: [],
      skipped: [],
    };
  }

  const merged = new Map();
  for (const item of statements) {
    if (!item.ready) continue;
    for (const movement of item.movements || []) {
      const key = String(
        movement.id ||
          [movement.date, movement.amount, movement.direction, movement.reference, movement.purpose].join('|'),
      );
      if (!merged.has(key)) merged.set(key, movement);
    }
  }

  const incomes = [...merged.values()].filter((m) => m.direction === 'income');
  const paid = [];
  const skipped = [];
  let matched = 0;

  for (const movement of incomes) {
    const existing = await paymentAlreadyImported(movement.id, movement);
    if (existing) {
      if (existing.status === 'credited') {
        skipped.push({ id: movement.id, reason: 'already_credited' });
        continue;
      }
      if (existing.status === 'rejected') {
        skipped.push({ id: movement.id, reason: 'previously_rejected' });
        continue;
      }
    }

    const numbers = extractInvoiceNumbersFromPurpose(movement.purpose);
    if (!numbers.length) {
      if (!existing) {
        try {
          await insertBankPayment({ movement, status: 'unmatched' });
        } catch (err) {
          if (!String(err.message || '').includes('Duplicate')) {
            skipped.push({ id: movement.id, reason: err.message });
          }
        }
      }
      skipped.push({ id: movement.id, reason: 'no_invoice_number' });
      continue;
    }

    let invoice = null;
    for (const num of numbers) {
      const candidate = await findInvoiceByNumber(num);
      if (candidate && amountsMatch(candidate.amount, movement.amount)) {
        invoice = candidate;
        break;
      }
    }

    if (!invoice) {
      if (!existing) {
        try {
          await insertBankPayment({ movement, status: 'unmatched' });
        } catch {
          /* ignore dup */
        }
      }
      skipped.push({
        id: movement.id,
        reason: 'invoice_not_found_or_amount_mismatch',
        numbers,
        amount: movement.amount,
      });
      continue;
    }

    // Счёт уже оплачен (например, вручную до прихода выписки). Первый
    // банковский платёж привязываем к счёту и помечаем зачисленным без
    // повторного изменения баланса. Дальнейшие копии — дубли, не плодим их.
    if (invoice.status === 'paid' || invoice.paid_at) {
      const creditedPayment = await findCreditedPaymentForInvoice(
        invoice.id,
        movement.amount,
      );
      if (creditedPayment && creditedPayment.id !== existing?.id) {
        if (existing) {
          await query(
            `UPDATE bank_payments
                SET invoice_id = :invoice_id, company_id = :company_id, status = 'rejected'
              WHERE id = :id AND status <> 'credited'`,
            {
              id: existing.id,
              invoice_id: invoice.id,
              company_id: invoice.company_id,
            },
          );
        }
        skipped.push({
          id: movement.id,
          reason: 'duplicate_payment_for_paid_invoice',
          number: invoice.number,
        });
        continue;
      }
    }

    matched += 1;

    if (!amountsMatch(invoice.amount, movement.amount)) {
      skipped.push({
        id: movement.id,
        reason: 'amount_mismatch',
        invoice: invoice.number,
        invoiceAmount: Number(invoice.amount),
        paymentAmount: Number(movement.amount),
      });
      continue;
    }

    let paymentId = existing?.id || null;
    if (!paymentId) {
      try {
        paymentId = await insertBankPayment({
          movement,
          invoiceId: invoice.id,
          companyId: invoice.company_id,
          status: 'matched',
        });
      } catch (err) {
        const again = await paymentAlreadyImported(movement.id, movement);
        paymentId = again?.id || null;
        if (!paymentId) {
          skipped.push({ id: movement.id, reason: err.message });
          continue;
        }
      }
    } else {
      await query(
        `UPDATE bank_payments
         SET invoice_id = :invoice_id, company_id = :company_id, status = 'matched',
             purpose = COALESCE(purpose, :purpose),
             payer_name = COALESCE(payer_name, :payer_name)
         WHERE id = :id AND status <> 'credited'`,
        {
          id: paymentId,
          invoice_id: invoice.id,
          company_id: invoice.company_id,
          purpose: movement.purpose || null,
          payer_name: movement.counterparty || null,
        },
      );
    }

    try {
      const result = await markInvoicePaid({
        invoiceId: invoice.id,
        amount: Number(invoice.amount),
        comment: `Автооплата MTBank: ${movement.purpose || movement.reference || movement.id}`,
        createdBy: null,
      });

      if (!result.alreadyPaid) {
        await query(
          `UPDATE bank_payments
           SET status = 'credited', invoice_id = :invoice_id, company_id = :company_id,
               confirmed_at = NOW()
           WHERE id = :id`,
          {
            id: paymentId,
            invoice_id: invoice.id,
            company_id: invoice.company_id,
          },
        );

        await audit(null, 'auto_mark_invoice_paid', 'invoice', invoice.id, {
          paymentId,
          externalId: movement.id,
          number: invoice.number,
          amount: Number(invoice.amount),
          provider: 'mtbank',
        });

        paid.push({
          invoiceId: invoice.id,
          number: invoice.number,
          amount: Number(invoice.amount),
          paymentId,
          externalId: movement.id,
        });
      } else {
        await query(
          `UPDATE bank_payments SET status = 'credited', confirmed_at = NOW() WHERE id = :id`,
          { id: paymentId },
        );
        skipped.push({ id: movement.id, reason: 'invoice_already_paid', number: invoice.number });
      }
    } catch (err) {
      skipped.push({ id: movement.id, reason: err.message, number: invoice.number });
    }
  }

  return {
    ok: true,
    configured: true,
    ready: true,
    provider: 'mtbank',
    period: { from: dateFrom, to: dateTo },
    account: statement.account,
    scanned: incomes.length,
    matched,
    paid,
    skipped,
    fetchedAt: statement.fetchedAt,
  };
}

export async function applyMatchedPaymentManually({ movement, invoiceId, userId }) {
  const invoiceRows = await query('SELECT * FROM invoices WHERE id = :id LIMIT 1', {
    id: invoiceId,
  });
  const invoice = invoiceRows[0];
  if (!invoice) throw new Error('Счёт не найден');

  const paymentId = await insertBankPayment({
    movement,
    invoiceId: invoice.id,
    companyId: invoice.company_id,
    status: 'matched',
  });

  const result = await markInvoicePaid({
    invoiceId: invoice.id,
    comment: movement.purpose || `Банковский платёж ${movement.id}`,
    createdBy: userId || null,
  });

  await query(
    `UPDATE bank_payments
     SET status = 'credited', confirmed_by = :uid, confirmed_at = NOW()
     WHERE id = :id`,
    { id: paymentId, uid: userId || null },
  );

  await notifyCompanyUsers(
    invoice.company_id,
    'Баланс пополнен',
    `На баланс зачислено ${Number(invoice.amount).toFixed(2)} BYN`,
  );

  return { paymentId, ...result };
}
