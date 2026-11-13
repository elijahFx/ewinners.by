import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { pool, query } from './db.js';
import { audit } from './services/billing.js';
import {
  amountsMatch,
  extractInvoiceNumbersFromPurpose,
} from './services/mtbank.js';

/**
 * Чистка дублей банковских платежей MTBank.
 *
 * Банк в разных выписках отдаёт один и тот же платёж с разным
 * reference/transactionId, поэтому старый синк создавал по 8 копий.
 * Скрипт оставляет одну строку на платёж и, если счёт уже оплачен,
 * привязывает её к счёту без повторного изменения баланса.
 *
 *   npm run bank:dedupe            # только показать, что будет сделано
 *   npm run bank:dedupe -- --apply # выполнить
 */

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = String(raw).match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

function day(value) {
  return dayjs(value).format('YYYY-MM-DD');
}

async function groupRows(group) {
  return query(
    `SELECT *
       FROM bank_payments
      WHERE provider = 'mtbank'
        AND direction = 'income'
        AND amount = :amount
        AND operation_date = :operation_date
        AND COALESCE(payer_unp, '') = COALESCE(:payer_unp, '')
        AND COALESCE(purpose, '') = COALESCE(:purpose, '')
      ORDER BY (status = 'credited') DESC, (status = 'matched') DESC, id ASC`,
    {
      amount: Number(group.amount),
      operation_date: day(group.operation_date),
      payer_unp: group.payer_unp || '',
      purpose: group.purpose || '',
    },
  );
}

async function findPaidInvoiceForPurpose(purpose, amount) {
  for (const number of extractInvoiceNumbersFromPurpose(purpose)) {
    const rows = await query(
      `SELECT * FROM invoices
        WHERE UPPER(number) = :number
          AND (status = 'paid' OR paid_at IS NOT NULL)
        ORDER BY id DESC
        LIMIT 1`,
      { number: String(number).toUpperCase() },
    );
    if (rows[0] && amountsMatch(rows[0].amount, amount)) return rows[0];
  }
  return null;
}

async function hasCreditedPayment(invoiceId, amount, exceptId = null) {
  const rows = await query(
    `SELECT id FROM bank_payments
      WHERE invoice_id = :invoice_id AND status = 'credited' AND amount = :amount
        AND (:except_id IS NULL OR id <> :except_id)
      ORDER BY id ASC
      LIMIT 1`,
    {
      invoice_id: Number(invoiceId),
      amount: Number(amount),
      except_id: exceptId || null,
    },
  );
  return rows[0] || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = Boolean(args.apply);
  const backupPath = path.resolve(
    String(args.backup || `../artifacts/bank-payments-backup-${dayjs().format('YYYY-MM-DD')}.json`),
  );

  const groups = await query(
    `SELECT amount, operation_date, payer_unp, purpose, COUNT(*) AS c
       FROM bank_payments
      WHERE provider = 'mtbank'
        AND direction = 'income'
        AND purpose IS NOT NULL AND purpose <> ''
      GROUP BY amount, operation_date, payer_unp, purpose
     HAVING c > 1
      ORDER BY c DESC`,
  );

  const summary = {
    apply,
    backupPath: apply ? backupPath : null,
    groups: groups.length,
    extraRows: 0,
    linkedPaidInvoices: 0,
    rejectedDuplicates: 0,
    deleted: 0,
    samples: [],
  };

  const actions = [];

  for (const group of groups) {
    const rows = await groupRows(group);
    if (rows.length < 2) continue;
    const keeper = rows[0];
    // Никогда не удаляем строки со статусом credited: это уже учтённые деньги.
    const extras = rows.slice(1).filter((row) => row.status !== 'credited');
    if (!extras.length) continue;
    summary.extraRows += extras.length;

    let linkInvoice = null;
    let rejectKeeper = false;

    if (keeper.status !== 'credited') {
      const paidInvoice = await findPaidInvoiceForPurpose(group.purpose, group.amount);
      if (paidInvoice) {
        const already = await hasCreditedPayment(paidInvoice.id, group.amount, keeper.id);
        if (already) {
          rejectKeeper = true;
        } else {
          linkInvoice = paidInvoice;
        }
      }
    }

    actions.push({ keeper, extras, linkInvoice, rejectKeeper });

    if (summary.samples.length < 12) {
      summary.samples.push({
        purpose: String(group.purpose).slice(0, 110),
        amount: Number(group.amount),
        date: day(group.operation_date),
        rows: rows.length,
        keeperId: keeper.id,
        keeperStatus: keeper.status,
        action: linkInvoice
          ? `link:${linkInvoice.number}:credited`
          : rejectKeeper
            ? 'keeper:rejected'
            : `keep:${keeper.status}`,
        deleteIds: extras.map((row) => row.id),
      });
    }
  }

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    console.log('Это предпросмотр. Для выполнения: npm run bank:dedupe -- --apply');
    return;
  }

  const allRows = await query('SELECT * FROM bank_payments ORDER BY id');
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ createdAt: new Date().toISOString(), count: allRows.length, rows: allRows }, null, 2),
  );
  console.log(`Бэкап: ${backupPath} (${allRows.length} строк)`);

  for (const action of actions) {
    const { keeper, extras, linkInvoice, rejectKeeper } = action;

    if (linkInvoice) {
      await query(
        `UPDATE bank_payments
            SET invoice_id = :invoice_id, company_id = :company_id,
                status = 'credited', confirmed_at = NOW()
          WHERE id = :id`,
        {
          id: keeper.id,
          invoice_id: linkInvoice.id,
          company_id: linkInvoice.company_id,
        },
      );
      await audit(null, 'link_bank_payment_paid_invoice', 'bank_payment', keeper.id, {
        invoiceId: linkInvoice.id,
        number: linkInvoice.number,
        amount: Number(keeper.amount),
        reason: 'already_paid_invoice',
      });
      summary.linkedPaidInvoices += 1;
    } else if (rejectKeeper) {
      await query(
        `UPDATE bank_payments SET status = 'rejected' WHERE id = :id AND status <> 'credited'`,
        { id: keeper.id },
      );
      summary.rejectedDuplicates += 1;
    }

    for (const row of extras) {
      await query('DELETE FROM bank_payments WHERE id = :id AND status <> \'credited\'', {
        id: row.id,
      });
      summary.deleted += 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
