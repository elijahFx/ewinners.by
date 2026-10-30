import nodemailer from 'nodemailer';
import fs from 'fs';
import { config, query } from '../db.js';

function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function sendEmail({ to, subject, text, html, attachments = [] }) {
  if (!mailConfigured()) {
    throw new Error('Почтовый сервер не настроен (SMTP_HOST / SMTP_USER / SMTP_PASS)');
  }
  const port = Number(process.env.SMTP_PORT || 465);
  const secure =
    String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')) === 'true';
  const rejectUnauthorized =
    String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true') !== 'false';

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized },
  });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({ from, to, subject, text, html, attachments });
  return { ok: true };
}

export async function sendTelegram({ chatId, text }) {
  if (!telegramConfigured()) {
    throw new Error('Telegram бот не настроен (TELEGRAM_BOT_TOKEN)');
  }
  if (!chatId) throw new Error('Не указан Telegram chat id');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.description || 'Не удалось отправить сообщение в Telegram');
  }
  return { ok: true };
}

export async function notifyCompanyUsers(companyId, title, body) {
  const users = await query(
    `SELECT id, email, notify_email, notify_telegram, telegram_chat_id
     FROM users
     WHERE company_id = :company_id AND status = 'active'`,
    { company_id: companyId },
  );

  for (const u of users) {
    await query(
      `INSERT INTO notifications (user_id, title, body) VALUES (:user_id, :title, :body)`,
      { user_id: u.id, title, body },
    );

    if (u.notify_email && u.email && mailConfigured()) {
      try {
        await sendEmail({
          to: u.email,
          subject: `[E-Winners] ${title}`,
          text: body,
          html: `<p><strong>${title}</strong></p><p>${body}</p>`,
        });
      } catch (err) {
        console.warn('Email notify failed:', u.email, err.message);
      }
    }

    if (u.notify_telegram && u.telegram_chat_id && telegramConfigured()) {
      try {
        await sendTelegram({
          chatId: u.telegram_chat_id,
          text: `<b>${title}</b>\n${body}`,
        });
      } catch (err) {
        console.warn('Telegram notify failed:', u.id, err.message);
      }
    }
  }
}

export function notifyChannelsStatus() {
  return {
    emailConfigured: mailConfigured(),
    telegramConfigured: telegramConfigured(),
    companyName: config.company.name,
  };
}

/**
 * Предупреждение о том, что баланс подошёл к лимиту.
 *
 * Отправляется только в момент пересечения порога сверху вниз — а не на
 * каждое списание. Иначе почта клиента заполняется письмами на 3–5 BYN.
 * Возвращает true, если уведомление отправлено.
 */
export async function notifyLowBalanceCrossing({
  companyId,
  balanceBefore,
  balanceAfter,
  threshold,
}) {
  const before = Number(balanceBefore);
  const after = Number(balanceAfter);
  const limit = Number(threshold);
  if (![before, after, limit].every(Number.isFinite)) return false;
  if (!(before > limit && after <= limit)) return false;

  const debt = after < 0 ? Math.abs(after) : 0;
  const body =
    debt > 0
      ? `Баланс опустился до ${after.toFixed(2)} BYN, задолженность ${debt.toFixed(2)} BYN. ` +
        'Пополните счёт, чтобы обработка заявок не остановилась.'
      : `Баланс опустился до ${after.toFixed(2)} BYN — это ниже порога ${limit.toFixed(2)} BYN.`;

  await notifyCompanyUsers(companyId, 'Баланс приблизился к лимиту', body);
  await query('UPDATE companies SET low_balance_notified_at = NOW() WHERE id = :id', {
    id: companyId,
  });
  return true;
}

/**
 * Дневная сводка по балансу: одно письмо в день клиентам с задолженностью или
 * низким балансом. force = true — отправить независимо от того, слали ли сегодня.
 */
export async function sendDailyBalanceDigests({ force = false } = {}) {
  const companies = await query(
    `SELECT c.id, c.name, c.balance, c.notify_threshold, c.last_digest_at,
            (DATE(c.last_digest_at) = CURDATE()) AS sent_today
       FROM companies c
      WHERE c.status <> 'blocked'
        AND c.balance <= c.notify_threshold
        -- Только те, кто реально пользуется: у никогда не работавших клиентов
        -- баланс 0, и без этого условия им бы каждый день падало «низкий баланс».
        AND EXISTS (SELECT 1 FROM transactions t WHERE t.company_id = c.id)
      ORDER BY c.balance ASC`,
  );

  const sent = [];
  for (const c of companies) {
    if (!force && Number(c.sent_today) === 1) continue;

    const balance = Number(c.balance || 0);
    const threshold = Number(c.notify_threshold || 0);
    const debt = balance < 0 ? Math.abs(balance) : 0;
    const title = debt > 0 ? 'Задолженность по балансу' : 'Низкий баланс';
    const body =
      debt > 0
        ? `Задолженность: ${debt.toFixed(2)} BYN. Текущий баланс: ${balance.toFixed(2)} BYN.`
        : `Текущий баланс: ${balance.toFixed(2)} BYN — ниже порога ${threshold.toFixed(2)} BYN.`;

    try {
      await notifyCompanyUsers(c.id, title, body);
      await query('UPDATE companies SET last_digest_at = NOW() WHERE id = :id', { id: c.id });
      sent.push({ companyId: c.id, name: c.name, balance });
    } catch (err) {
      console.error('[digest] не удалось отправить сводку компании', c.id, err.message);
    }
  }

  return { checked: companies.length, sent: sent.length, companies: sent };
}

export async function sendDocumentByEmail({ to, subject, text, filePath, fileName }) {
  if (!fs.existsSync(filePath)) throw new Error('Файл документа не найден');
  return sendEmail({
    to,
    subject,
    text,
    html: `<p>${text}</p>`,
    attachments: [{ filename: fileName, path: filePath }],
  });
}
