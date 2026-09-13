import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { sendEmail } from './notify.js';

const INVITE_TTL_HOURS = 72;
const RESET_TTL_HOURS = 2;

export function appBaseUrl() {
  return String(
    process.env.PUBLIC_APP_URL ||
      process.env.FRONTEND_URL ||
      process.env.APP_URL ||
      'https://ewinners.netlify.app',
  ).replace(/\/$/, '');
}

function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function isMailConfigured() {
  return mailConfigured();
}

async function createToken(userId, type, ttlHours) {
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

  await query(
    `UPDATE auth_tokens SET used_at = NOW()
     WHERE user_id = :user_id AND type = :type AND used_at IS NULL`,
    { user_id: userId, type },
  );

  await query(
    `INSERT INTO auth_tokens (user_id, type, token_hash, expires_at)
     VALUES (
       :user_id,
       :type,
       :token_hash,
       DATE_ADD(NOW(), INTERVAL ${Number(ttlHours)} HOUR)
     )`,
    { user_id: userId, type, token_hash: tokenHash },
  );

  return raw;
}

export async function findValidToken(rawToken, expectedType) {
  const token = String(rawToken || '').trim();
  if (!token || token.length < 20) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const rows = await query(
    `SELECT t.*, u.email, u.full_name, u.role, u.status, u.company_id
     FROM auth_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = :token_hash
       AND t.type = :type
       AND t.used_at IS NULL
       AND t.expires_at > NOW()
     LIMIT 1`,
    { token_hash: tokenHash, type: expectedType },
  );
  return rows[0] || null;
}

async function consumeToken(id) {
  await query(`UPDATE auth_tokens SET used_at = NOW() WHERE id = :id`, { id });
}

export async function sendInviteEmail(user, { invitedBy } = {}) {
  if (!mailConfigured()) {
    throw new Error('SMTP не настроен — письмо-приглашение не отправлено');
  }
  const raw = await createToken(user.id, 'invite', INVITE_TTL_HOURS);
  const link = `${appBaseUrl()}/account/invite?token=${raw}`;
  const name = user.full_name || user.email;

  await sendEmail({
    to: user.email,
    subject: 'Приглашение в личный кабинет E-Winners',
    text:
      `Здравствуйте, ${name}!\n\n` +
      `Вас пригласили в личный кабинет E-Winners.\n` +
      `Перейдите по ссылке, чтобы задать пароль и войти:\n${link}\n\n` +
      `Ссылка действует ${INVITE_TTL_HOURS} часа.\n` +
      (invitedBy ? `Приглашение отправил: ${invitedBy}\n` : ''),
    html:
      `<p>Здравствуйте, <strong>${name}</strong>!</p>` +
      `<p>Вас пригласили в личный кабинет <strong>E-Winners</strong>.</p>` +
      `<p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#258dff;color:#fff;border-radius:999px;text-decoration:none;font-weight:700">Задать пароль и войти</a></p>` +
      `<p style="color:#667">Или откройте ссылку:<br><a href="${link}">${link}</a></p>` +
      `<p style="color:#667">Ссылка действует ${INVITE_TTL_HOURS} часа.</p>`,
  });

  return { ok: true, linkExpiresHours: INVITE_TTL_HOURS };
}

export async function sendPasswordResetEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  // Always succeed outwardly; only send if user exists and mail works
  const users = await query(
    `SELECT id, email, full_name, status FROM users WHERE email = :email LIMIT 1`,
    { email: normalized },
  );
  const user = users[0];
  if (!user || user.status === 'blocked') {
    return { ok: true };
  }
  if (!mailConfigured()) {
    throw new Error('Почтовый сервер не настроен');
  }

  const recent = await query(
    `SELECT COUNT(*) AS c FROM auth_tokens
     WHERE user_id = :user_id AND type = 'password_reset'
       AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
    { user_id: user.id },
  );
  if (Number(recent[0]?.c || 0) >= 5) {
    throw new Error('Слишком много запросов. Попробуйте позже');
  }

  const raw = await createToken(user.id, 'password_reset', RESET_TTL_HOURS);
  const link = `${appBaseUrl()}/account/reset?token=${raw}`;
  const name = user.full_name || user.email;

  await sendEmail({
    to: user.email,
    subject: 'Восстановление пароля E-Winners',
    text:
      `Здравствуйте, ${name}!\n\n` +
      `Запрос на сброс пароля в личном кабинете E-Winners.\n` +
      `Перейдите по ссылке:\n${link}\n\n` +
      `Ссылка действует ${RESET_TTL_HOURS} часа. Если вы не запрашивали сброс — проигнорируйте письмо.`,
    html:
      `<p>Здравствуйте, <strong>${name}</strong>!</p>` +
      `<p>Запрос на сброс пароля в личном кабинете E-Winners.</p>` +
      `<p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#258dff;color:#fff;border-radius:999px;text-decoration:none;font-weight:700">Задать новый пароль</a></p>` +
      `<p style="color:#667">Или откройте ссылку:<br><a href="${link}">${link}</a></p>` +
      `<p style="color:#667">Ссылка действует ${RESET_TTL_HOURS} часа. Если вы не запрашивали сброс — просто проигнорируйте письмо.</p>`,
  });

  return { ok: true };
}

export async function acceptInvite({ token, password }) {
  const row = await findValidToken(token, 'invite');
  if (!row) throw new Error('Ссылка приглашения недействительна или истекла');
  if (String(password || '').length < 8) {
    throw new Error('Пароль должен быть не короче 8 символов');
  }

  const passwordHash = await bcrypt.hash(String(password), 12);
  await query(
    `UPDATE users SET
       password_hash = :password_hash,
       must_set_password = 0,
       status = 'active',
       token_version = token_version + 1
     WHERE id = :id`,
    { id: row.user_id, password_hash: passwordHash },
  );
  await consumeToken(row.id);

  const users = await query(`SELECT * FROM users WHERE id = :id LIMIT 1`, { id: row.user_id });
  return users[0];
}

export async function resetPasswordWithToken({ token, password }) {
  const row = await findValidToken(token, 'password_reset');
  if (!row) throw new Error('Ссылка сброса пароля недействительна или истекла');
  if (row.status === 'blocked') throw new Error('Пользователь заблокирован');
  if (String(password || '').length < 8) {
    throw new Error('Пароль должен быть не короче 8 символов');
  }

  const passwordHash = await bcrypt.hash(String(password), 12);
  await query(
    `UPDATE users SET
       password_hash = :password_hash,
       must_set_password = 0,
       status = IF(status = 'invited', 'active', status),
       token_version = token_version + 1
     WHERE id = :id`,
    { id: row.user_id, password_hash: passwordHash },
  );
  await consumeToken(row.id);
  await query(
    `UPDATE auth_tokens SET used_at = NOW()
     WHERE user_id = :user_id AND used_at IS NULL`,
    { user_id: row.user_id },
  );

  const users = await query(`SELECT * FROM users WHERE id = :id LIMIT 1`, { id: row.user_id });
  return users[0];
}

export async function createPlaceholderPasswordHash() {
  // Random unknown password until invite is accepted
  return bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
}
