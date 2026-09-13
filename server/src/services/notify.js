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
