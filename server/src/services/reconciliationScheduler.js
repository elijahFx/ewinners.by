import { query } from '../db.js';
import { sendEmail } from './notify.js';
import { buildReconciliationReport } from './reconciliation.js';

/**
 * Ежедневная сверка заказов SalesRender со списаниями.
 *
 * Если вебхук не дошёл, заказ остаётся несписанным навсегда: SalesRender
 * отбрасывает событие после 5 неудачных попыток. Эта проверка ловит такое
 * в тот же день и пишет администраторам.
 */

const CHECK_HOUR = Number(process.env.RECONCILIATION_HOUR || 8);
const CHECK_MINUTE = Number(process.env.RECONCILIATION_MINUTE || 30);
const LOOKBACK_DAYS = Number(process.env.RECONCILIATION_DAYS || 2);

let timer = null;
let lastRunDate = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

async function adminEmails() {
  const rows = await query(
    `SELECT email FROM users WHERE role IN ('admin','accountant') AND status = 'active' AND email IS NOT NULL`,
  );
  return rows.map((r) => r.email).filter(Boolean);
}

export async function runReconciliationCheck({ force = false } = {}) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (!force && lastRunDate === today) {
    return { ok: true, skipped: true, reason: 'already_ran_today' };
  }

  const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const report = await buildReconciliationReport({ from });

  const result = {
    ok: true,
    from,
    ordersChecked: report.ordersChecked,
    charged: report.charged,
    missing: report.missing.length,
    missingAmount: report.missingAmount,
    unmappedProjects: report.unmappedProjects,
  };

  if (!report.missing.length) {
    lastRunDate = today;
    console.log(`[сверка] расхождений нет: проверено ${report.ordersChecked} заказов`);
    return result;
  }

  console.error(
    `[сверка] РАСХОЖДЕНИЯ: не списано ${report.missing.length} заказов на ${report.missingAmount} BYN`,
  );

  const rows = report.byCompany
    .map(
      (c) =>
        `<tr><td style="padding:6px 10px">${esc(c.companyName)}</td>` +
        `<td style="padding:6px 10px;text-align:right">${c.count}</td>` +
        `<td style="padding:6px 10px;text-align:right">${c.amount.toFixed(2)} BYN</td></tr>`,
    )
    .join('');

  const unmapped = report.unmappedProjects.length
    ? `<p style="color:#a33">Не привязаны проекты SalesRender: <b>${report.unmappedProjects.map(esc).join(', ')}</b> — по ним списание невозможно, пока не укажете клиента.</p>`
    : '';

  const html =
    `<p>Сверка заказов SalesRender со списаниями выявила расхождения.</p>` +
    `<p>Проверено заказов: <b>${report.ordersChecked}</b>, списано: <b>${report.charged}</b>, ` +
    `<b style="color:#a33">не списано: ${report.missing.length} на ${report.missingAmount.toFixed(2)} BYN</b>.</p>` +
    `<table style="border-collapse:collapse;font:14px sans-serif"><tr>` +
    `<th style="padding:6px 10px;text-align:left">Клиент</th>` +
    `<th style="padding:6px 10px">Заказов</th><th style="padding:6px 10px">Сумма</th></tr>${rows}</table>` +
    unmapped +
    `<p>Раздел «Сверка» в кабинете администратора: можно посмотреть детали и восстановить списания.</p>`;

  const to = await adminEmails();
  if (to.length) {
    try {
      await sendEmail({
        to: to.join(', '),
        subject: `E-Winners: не списано ${report.missing.length} заказов на ${report.missingAmount.toFixed(2)} BYN`,
        text:
          `Сверка заказов SalesRender выявила расхождения.\n` +
          `Проверено: ${report.ordersChecked}, списано: ${report.charged}, не списано: ${report.missing.length} на ${report.missingAmount.toFixed(2)} BYN.\n` +
          report.byCompany.map((c) => `  ${c.companyName}: ${c.count} заказов, ${c.amount.toFixed(2)} BYN`).join('\n'),
        html,
      });
      console.log(`[сверка] письмо отправлено: ${to.join(', ')}`);
    } catch (err) {
      console.error('[сверка] не удалось отправить письмо:', err.message);
    }
  } else {
    console.warn('[сверка] нет адресов для уведомления');
  }

  lastRunDate = today;
  return result;
}

/** Проверяет расписание раз в 15 минут. */
export function scheduleReconciliation() {
  if (timer) return;
  const tick = async () => {
    try {
      const now = new Date();
      if (now.getHours() > CHECK_HOUR || (now.getHours() === CHECK_HOUR && now.getMinutes() >= CHECK_MINUTE)) {
        await runReconciliationCheck();
      }
    } catch (err) {
      console.error('[сверка] ошибка:', err.message);
    }
  };
  timer = setInterval(tick, 15 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  tick();
  console.log(
    `[сверка] планировщик запущен, проверка в ${String(CHECK_HOUR).padStart(2, '0')}:${String(CHECK_MINUTE).padStart(2, '0')}, период ${LOOKBACK_DAYS} дн.`,
  );
}
