import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { sendTelegram } from './notify.js';

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SEC = 45;

export function isAdminTwoFaRole(role) {
  return role === 'admin';
}

export function telegramBotConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function generateCode() {
  return String(crypto.randomInt(100000, 999999));
}

export async function createLoginChallenge(userId) {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const challengeId = crypto.randomBytes(24).toString('hex');

  await query(`DELETE FROM login_challenges WHERE user_id = :user_id`, { user_id: userId });
  // Срок жизни считаем в MySQL (NOW), чтобы не ломаться на timezone Node vs DB
  await query(
    `INSERT INTO login_challenges (id, user_id, code_hash, expires_at, attempts)
     VALUES (
       :id,
       :user_id,
       :code_hash,
       DATE_ADD(NOW(), INTERVAL ${CODE_TTL_MINUTES} MINUTE),
       0
     )`,
    {
      id: challengeId,
      user_id: userId,
      code_hash: codeHash,
    },
  );

  const rows = await query(
    `SELECT expires_at FROM login_challenges WHERE id = :id LIMIT 1`,
    { id: challengeId },
  );

  return {
    challengeId,
    code,
    expiresAt: rows[0]?.expires_at || null,
    ttlMinutes: CODE_TTL_MINUTES,
  };
}

export async function sendTwoFaCode({ chatId, code, email, ttlMinutes = CODE_TTL_MINUTES }) {
  await sendTelegram({
    chatId,
    text:
      `<b>E-Winners — код входа</b>\n` +
      `Код: <code>${code}</code>\n` +
      `Аккаунт: ${email}\n` +
      `Действует ${ttlMinutes} мин. Если это не вы — смените пароль.`,
  });
}

export async function resendLoginChallenge(challengeId) {
  const rows = await query(
    `SELECT *,
            TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_sec,
            (expires_at > NOW()) AS is_alive
     FROM login_challenges
     WHERE id = :id
     LIMIT 1`,
    { id: challengeId },
  );
  const challenge = rows[0];
  if (!challenge) throw new Error('Сессия подтверждения не найдена. Войдите снова');

  const ageSec = Number(challenge.age_sec || 0);
  if (ageSec < RESEND_COOLDOWN_SEC) {
    const wait = RESEND_COOLDOWN_SEC - ageSec;
    throw new Error(`Повторная отправка через ${wait} сек.`);
  }

  const users = await query(
    `SELECT id, email, telegram_chat_id, role, status FROM users WHERE id = :id LIMIT 1`,
    { id: challenge.user_id },
  );
  const user = users[0];
  if (!user || user.status === 'blocked') throw new Error('Пользователь недоступен');
  if (!user.telegram_chat_id) throw new Error('Не указан Telegram Chat ID');

  const created = await createLoginChallenge(user.id);
  await sendTwoFaCode({
    chatId: user.telegram_chat_id,
    code: created.code,
    email: user.email,
    ttlMinutes: created.ttlMinutes,
  });
  return {
    challengeId: created.challengeId,
    expiresAt: created.expiresAt,
    email: user.email,
  };
}

export async function verifyLoginChallenge(challengeId, code) {
  const id = String(challengeId || '').trim();
  const rows = await query(
    `SELECT *,
            (expires_at > NOW()) AS is_alive
     FROM login_challenges
     WHERE id = :id
     LIMIT 1`,
    { id },
  );
  const challenge = rows[0];
  if (!challenge) {
    throw new Error('Сессия подтверждения не найдена. Войдите снова и запросите новый код');
  }

  // MySQL может вернуть 1/0 или Buffer/boolean
  const alive = Number(challenge.is_alive) === 1 || challenge.is_alive === true;
  if (!alive) {
    await query(`DELETE FROM login_challenges WHERE id = :id`, { id });
    throw new Error('Код истёк. Войдите снова');
  }

  if (Number(challenge.attempts) >= MAX_ATTEMPTS) {
    await query(`DELETE FROM login_challenges WHERE id = :id`, { id });
    throw new Error('Слишком много попыток. Войдите снова');
  }

  const ok = await bcrypt.compare(String(code || '').trim(), challenge.code_hash);
  if (!ok) {
    await query(`UPDATE login_challenges SET attempts = attempts + 1 WHERE id = :id`, { id });
    const left = MAX_ATTEMPTS - Number(challenge.attempts) - 1;
    throw new Error(left > 0 ? `Неверный код. Осталось попыток: ${left}` : 'Неверный код');
  }

  await query(`DELETE FROM login_challenges WHERE id = :id`, { id });

  const users = await query(`SELECT * FROM users WHERE id = :id LIMIT 1`, {
    id: challenge.user_id,
  });
  const user = users[0];
  if (!user || user.status === 'blocked') throw new Error('Пользователь недоступен');
  return user;
}
