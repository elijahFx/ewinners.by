import fs from 'fs';
import path from 'path';
import { pool, query } from './db.js';
import { ensureMonthlyAct, resolveActPeriod, runMonthlyActs } from './services/monthlyActs.js';

/**
 * Ручная генерация месячных актов.
 *
 *   npm run acts:generate -- --period=2026-10
 *   npm run acts:generate -- --period=2026-10 --company=11
 *   npm run acts:generate -- --period=2026-10 --company=11 --preview=../artifacts/act.pdf
 *   npm run acts:generate -- --all-past
 *   npm run acts:generate -- --from=2026-09 --to=2026-10
 *
 * Без --period берётся прошлый месяц. --force пересобирает уже существующие
 * акты. --preview только создаёт PDF, не записывая документ в БД.
 * --all-past досоздаёт акты за все месяцы, где были списания, до прошлого
 * месяца включительно; уведомления клиентам при этом не отправляются.
 */

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = String(raw).match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (value === undefined) args[key] = true;
    else args[key] = value;
  }
  return args;
}

function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function assertMonth(value, label) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${label} должен быть в формате ГГГГ-ММ`);
  }
}

function monthRange(from, to) {
  assertMonth(from, '--from');
  assertMonth(to, '--to');
  if (from > to) throw new Error('--from не может быть позже --to');

  const months = [];
  let [year, month] = from.split('-').map(Number);
  const [endYear, endMonth] = to.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

async function earliestDebitMonth() {
  const rows = await query(
    `SELECT DATE_FORMAT(MIN(created_at), '%Y-%m') AS month
       FROM transactions
      WHERE type = 'debit' AND status = 'posted'`,
  );
  return rows[0]?.month || previousMonth();
}

async function runAllPast(args, companyId, force) {
  const previous = previousMonth();
  const from = args.from || (await earliestDebitMonth());
  const to = args.to || previous;
  const months = monthRange(from, to);

  console.log(`[акты] досоздание за периоды: ${months.join(', ')}`);

  const total = {
    periods: months.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  for (const month of months) {
    console.log(`[акты] период ${month}…`);
    const summary = await runMonthlyActs({
      period: month,
      companyId,
      force,
      notify: false,
    });
    total.created += summary.created;
    total.updated += summary.updated;
    total.skipped += summary.skipped;
    total.failed += summary.failed;
    total.results.push({ period: month, ...summary });
  }

  console.log(JSON.stringify(total, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const companyId = args.company ? Number(args.company) : null;
  const force = Boolean(args.force);

  if (args['all-past'] || args.all) {
    await runAllPast(args, companyId, force);
    return;
  }

  const period = args.period || previousMonth();
  const resolved = resolveActPeriod(period);
  const notify = args['no-notify'] ? false : true;

  if (args.preview) {
    if (!companyId) {
      throw new Error('Для --preview укажите --company=<id>');
    }
    const rows = await query(
      'SELECT * FROM companies WHERE id = :id LIMIT 1',
      { id: companyId },
    );
    if (!rows[0]) throw new Error(`Клиент #${companyId} не найден`);

    const outputPath = path.resolve(String(args.preview));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const result = await ensureMonthlyAct({
      company: rows[0],
      period: resolved.key,
      force,
      notify: false,
      save: false,
      outputPath,
      skipIfEmpty: false,
    });
    console.log(`PDF: ${result.filePath}`);
    console.log(`Клиент: ${result.company.name}`);
    console.log(`Период: ${resolved.label}`);
    console.log(`Сумма: ${result.total.toFixed(2)} BYN`);
    console.log(`Строк: ${result.items.length}, операций: ${result.operationsCount}`);
    return;
  }

  const summary = await runMonthlyActs({
    period: resolved.key,
    companyId,
    force,
    notify,
  });
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
