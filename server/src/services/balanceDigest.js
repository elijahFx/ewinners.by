import { query } from '../db.js';
import { sendDailyBalanceDigests } from './notify.js';

// Проверяем раз в 15 минут: подошёл ли час отправки и не слали ли уже сегодня.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const DIGEST_HOUR = Number(process.env.BALANCE_DIGEST_HOUR || 9);

let timer = null;

async function tick() {
  try {
    const rows = await query('SELECT HOUR(NOW()) AS h');
    const hour = Number(rows[0]?.h ?? -1);
    if (!(hour >= DIGEST_HOUR)) return;

    const result = await sendDailyBalanceDigests();
    if (result.sent) {
      console.log(`[digest] отправлено сводок: ${result.sent} из ${result.checked} должников`);
    }
  } catch (err) {
    console.error('[digest] ошибка отправки сводок:', err.message);
  }
}

/**
 * Планировщик дневной сводки по балансу.
 *
 * Внутренний таймер вместо системного cron: сервер и так работает постоянно,
 * а отметка last_digest_at в базе не даёт отправить сводку дважды за день —
 * в том числе после перезапуска.
 */
export function scheduleBalanceDigest() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  // Не держим процесс живым только ради таймера
  timer.unref?.();
  // Первая проверка — сразу после старта, чтобы не ждать 15 минут
  tick();
  console.log(`[digest] планировщик сводок запущен, час отправки: ${DIGEST_HOUR}:00`);
  return timer;
}
