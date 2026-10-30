import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { query } from '../db.js';

/**
 * Почтовый клиент: синхронизация ящика по IMAP и отправка через SMTP.
 *
 * Работает с обычным почтовым сервером (в нашем случае Plesk/ewinners.by).
 * Настройки берутся из окружения, чтобы пароль не попадал в код:
 *   MAIL_HOST, MAIL_IMAP_PORT, MAIL_SMTP_PORT, MAIL_USER, MAIL_PASS
 */
function config() {
  const host = String(process.env.MAIL_HOST || '').trim() || 'ewinners.by';
  return {
    host,
    imapPort: Number(process.env.MAIL_IMAP_PORT || 993),
    smtpPort: Number(process.env.MAIL_SMTP_PORT || 465),
    user: String(process.env.MAIL_USER || '').trim(),
    pass: String(process.env.MAIL_PASS || '').trim(),
    fromName: String(process.env.MAIL_FROM_NAME || 'E-Winners').trim(),
    // Сертификат почтового сервера выписан на *.hb.by, а подключаемся по
    // ewinners.by. Указываем правильное имя, иначе TLS-проверка падает.
    tlsName: String(process.env.MAIL_TLS_NAME || 'hb.by').trim(),
  };
}

export function isMailConfigured() {
  const c = config();
  return Boolean(c.user && c.pass);
}

function imapClient() {
  const c = config();
  return new ImapFlow({
    host: c.host,
    port: c.imapPort,
    secure: true,
    auth: { user: c.user, pass: c.pass },
    tls: { servername: c.tlsName },
    logger: false,
  });
}

function smtpTransport() {
  const c = config();
  return nodemailer.createTransport({
    host: c.host,
    port: c.smtpPort,
    secure: c.smtpPort === 465,
    auth: { user: c.user, pass: c.pass },
    tls: { servername: c.tlsName },
  });
}

function snippet(text, html) {
  const base = String(text || '').replace(/\s+/g, ' ').trim() ||
    String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return base.slice(0, 300);
}

/** Разбирает письмо и сохраняет его вместе с вложениями. */
async function storeMessage({ source, mailbox, direction, uid }) {
  const parsed = await simpleParser(source);
  const from = parsed.from?.value?.[0] || {};
  const to = (parsed.to?.value || []).map((a) => a.address).filter(Boolean).join(', ');
  const cc = (parsed.cc?.value || []).map((a) => a.address).filter(Boolean).join(', ');
  const attachments = parsed.attachments || [];

  const existing = await query(
    'SELECT id FROM mail_messages WHERE mailbox = :m AND imap_uid = :u LIMIT 1',
    { m: mailbox, u: uid },
  );
  if (existing[0]) return { skipped: true, id: existing[0].id };

  const result = await query(
    `INSERT INTO mail_messages
       (message_id, mailbox, direction, subject, from_address, from_name, to_address, cc_address,
        sent_at, is_read, has_attachments, snippet, body_text, body_html, imap_uid)
     VALUES
       (:message_id, :mailbox, :direction, :subject, :from_address, :from_name, :to_address, :cc_address,
        :sent_at, :is_read, :has_attachments, :snippet, :body_text, :body_html, :imap_uid)`,
    {
      message_id: parsed.messageId || null,
      mailbox,
      direction,
      subject: (parsed.subject || '(без темы)').slice(0, 500),
      from_address: from.address || null,
      from_name: from.name || null,
      to_address: to || null,
      cc_address: cc || null,
      sent_at: parsed.date || new Date(),
      is_read: direction === 'incoming' ? 0 : 1,
      has_attachments: attachments.length ? 1 : 0,
      snippet: snippet(parsed.text, parsed.html),
      body_text: parsed.text || null,
      body_html: typeof parsed.html === 'string' ? parsed.html : null,
      imap_uid: uid,
    },
  );

  for (const att of attachments) {
    if (!att.content) continue;
    await query(
      `INSERT INTO mail_attachments (message_id, filename, content_type, size, content)
       VALUES (:message_id, :filename, :content_type, :size, :content)`,
      {
        message_id: result.insertId,
        filename: att.filename || 'file',
        content_type: att.contentType || 'application/octet-stream',
        size: att.size || att.content.length,
        content: att.content,
      },
    );
  }

  return { saved: true, id: result.insertId };
}

/**
 * Синхронизация папки. Берём последние письма, а не всё подряд:
 * ограничение по количеству защищает от тяжёлой выгрузки.
 */
export async function syncMailbox({ mailbox = 'INBOX', limit = 100 } = {}) {
  if (!isMailConfigured()) throw new Error('Почта не настроена: укажите MAIL_USER и MAIL_PASS');
  const client = imapClient();
  let saved = 0;
  let scanned = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const status = client.mailbox;
      const total = Number(status?.exists || 0);
      if (!total) return { saved, scanned, total };
      const direction = /sent|отправ/i.test(mailbox) ? 'outgoing' : 'incoming';
      const from = Math.max(1, total - limit + 1);
      const uids = await client.search({ uid: `${from}:*` }, { uid: true });
      const useUids = Array.isArray(uids) ? uids : [];
      for (const uid of useUids) {
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!msg?.source) continue;
          scanned += 1;
          const res = await storeMessage({ source: msg.source, mailbox, direction, uid });
          if (res.saved) saved += 1;
        } catch {
          /* одно письмо не должно ломать всю синхронизацию */
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return { saved, scanned };
}

/** Полная синхронизация: входящие и отправленные. */
export async function syncAllMail({ limit = 100 } = {}) {
  const inbox = await syncMailbox({ mailbox: 'INBOX', limit });
  // У Plesk папки лежат внутри INBOX.*, у других серверов — в корне
  async function syncFirst(names, cap = 50) {
    for (const mailbox of names) {
      try {
        return await syncMailbox({ mailbox, limit: Math.min(limit, cap) });
      } catch {
        /* пробуем следующее имя */
      }
    }
    return { saved: 0, scanned: 0 };
  }

  const sent = await syncFirst(['INBOX.Sent', 'Sent']);
  const spam = await syncFirst(['INBOX.Spam', 'INBOX.Junk', 'Spam', 'Junk'], 30);
  const drafts = await syncFirst(['INBOX.Drafts', 'Drafts'], 20);
  return { inbox, sent, spam, drafts };
}

/** Отправка письма и сохранение его в исходящих. */
export async function sendMail({ to, cc, subject, text, html, attachments = [], userId = null }) {
  if (!isMailConfigured()) throw new Error('Почта не настроена: укажите MAIL_USER и MAIL_PASS');
  const c = config();
  const transport = smtpTransport();
  const info = await transport.sendMail({
    from: `"${c.fromName}" <${c.user}>`,
    to,
    cc: cc || undefined,
    subject: subject || '(без темы)',
    text: text || undefined,
    html: html || undefined,
    attachments: attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });

  const result = await query(
    `INSERT INTO mail_messages
       (message_id, mailbox, direction, subject, from_address, from_name, to_address, cc_address,
        sent_at, is_read, has_attachments, snippet, body_text, body_html)
     VALUES
       (:message_id, 'Sent', 'outgoing', :subject, :from_address, :from_name, :to_address, :cc_address,
        NOW(), 1, :has_attachments, :snippet, :body_text, :body_html)`,
    {
      message_id: info.messageId || null,
      subject: (subject || '(без темы)').slice(0, 500),
      from_address: c.user,
      from_name: c.fromName,
      to_address: to,
      cc_address: cc || null,
      has_attachments: attachments.length ? 1 : 0,
      snippet: snippet(text, html),
      body_text: text || null,
      body_html: html || null,
    },
  );

  return { id: result.insertId, messageId: info.messageId, accepted: info.accepted };
}

/** Проверка подключения: нужно, чтобы админ видел, работает ли ящик. */
export async function checkConnection() {
  if (!isMailConfigured()) return { ok: false, error: 'Не указаны MAIL_USER и MAIL_PASS' };
  const client = imapClient();
  try {
    await client.connect();
    const mailboxes = await client.list();
    return { ok: true, mailboxes: mailboxes.map((m) => m.path) };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await client.logout().catch(() => {});
  }
}
