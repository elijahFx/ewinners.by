import dayjs from 'dayjs';
import { runMonthlyActs } from './monthlyActs.js';

/**
 * Планировщик месячных актов.
 *
 * Акт формируется в последний день месяца (по Минску), а на следующий день
 * ещё раз обновляется — чтобы в него попали списания за последние минуты.
 * Если сервер был выключен, при старте досоздаются отсутствующие акты за
 * прошлый месяц.
 *
 * Ручной запуск: npm run acts:generate -- --period=2026-10
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const ACT_HOUR = Number(process.env.MONTHLY_ACT_HOUR ?? 23);
const ACT_MINUTE = Number(process.env.MONTHLY_ACT_MINUTE ?? 50);
const ENABLED = String(process.env.MONTHLY_ACT_ENABLED ?? '1') !== '0';

let timer = null;
let lastRunKey = null;
let running = false;

/** Время Минска (UTC+3), независимо от таймзоны сервера. */
function nowMinsk() {
  return dayjs().utcOffset(180);
}

async function exclusive(fn) {
  if (running) return;
  running = true;
  try {
    await fn();
  } finally {
    running = false;
  }
}

async function tick() {
  if (!ENABLED) return;
  const now = nowMinsk();
  const today = now.format('YYYY-MM-DD');
  const lastDayOfMonth = now.endOf('month').format('YYYY-MM-DD');
  const minutes = now.hour() * 60 + now.minute();

  let target = null;
  let runKey = null;

  if (today === lastDayOfMonth) {
    if (minutes >= ACT_HOUR * 60 + ACT_MINUTE) {
      target = now.startOf('month');
      runKey = `end-${now.format('YYYY-MM')}`;
    }
  }

  // Первые два дня месяца — страховка: обновляем акт за прошлый месяц,
  // чтобы в него попали самые поздние списания.
  if (!target && now.date() <= 2) {
    const previous = now.subtract(1, 'month');
    target = previous.startOf('month');
    runKey = `catchup-${previous.format('YYYY-MM')}`;
  }

  if (!target || lastRunKey === runKey) return;

  await exclusive(async () => {
    lastRunKey = runKey;
    await runMonthlyActs({ period: target.format('YYYY-MM'), force: true });
  });
}

export function scheduleMonthlyActs() {
  if (timer) return timer;
  if (!ENABLED) {
    console.log('[акты] планировщик отключён (MONTHLY_ACT_ENABLED=0)');
    return null;
  }

  timer = setInterval(() => {
    tick().catch((err) => console.error('[акты] ошибка планировщика:', err.message));
  }, CHECK_INTERVAL_MS);
  timer.unref?.();

  // Досоздаём/обновляем акты за прошлый месяц после рестарта/деплоя:
  // так в них попадают последние списания, а документ виден в текущем месяце.
  if (String(process.env.MONTHLY_ACT_BACKFILL ?? '1') !== '0') {
    const previous = nowMinsk().subtract(1, 'month').format('YYYY-MM');
    lastRunKey = `catchup-${previous}`;
    exclusive(async () => {
      await runMonthlyActs({ period: previous, force: true });
    }).catch((err) => console.error('[акты] ошибка досоздания:', err.message));
  }

  tick().catch((err) => console.error('[акты] ошибка планировщика:', err.message));
  console.log(
    `[акты] планировщик запущен: последний день месяца в ${String(ACT_HOUR).padStart(2, '0')}:${String(ACT_MINUTE).padStart(2, '0')} (Минск)`,
  );
  return timer;
}
