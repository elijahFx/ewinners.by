import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { audit } from '../services/billing.js';
import { checkConnection, isMailConfigured, sendMail, syncAllMail } from '../services/mail.js';

/**
 * Почтовый клиент кабинета.
 *
 * Доступ у админа и бухгалтера: это рабочая почта компании, не клиентская.
 * Синхронизация тянет письма с IMAP, отправка идёт через SMTP.
 */
const router = Router();
router.use(authRequired, requireRoles('admin', 'accountant'));

router.get('/status', async (req, res) => {
  try {
    const configured = isMailConfigured();
    const counters = await query(
      `SELECT
         SUM(CASE WHEN direction = 'incoming' AND is_read = 0 THEN 1 ELSE 0 END) AS unread,
         COUNT(*) AS total
       FROM mail_messages`,
    );
    res.json({
      configured,
      user: String(process.env.MAIL_USER || '').trim() || null,
      host: String(process.env.MAIL_HOST || 'ewinners.by').trim(),
      unread: Number(counters[0]?.unread || 0),
      total: Number(counters[0]?.total || 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось получить состояние почты' });
  }
});

router.get('/connection', async (req, res) => {
  const result = await checkConnection();
  res.json(result);
});

router.get('/messages', async (req, res) => {
  try {
    const params = {};
    const where = [];
    if (req.query.direction === 'incoming' || req.query.direction === 'outgoing') {
      where.push('direction = :direction');
      params.direction = req.query.direction;
    }
    // Папки, которые тянем отдельно: спам и черновики
    if (req.query.folder === 'spam') {
      where.push("mailbox LIKE '%Spam%' OR mailbox LIKE '%Junk%'");
    } else if (req.query.folder === 'drafts') {
      where.push("mailbox LIKE '%Draft%'");
    } else if (req.query.folder === 'inbox') {
      where.push("mailbox = 'INBOX'");
    } else if (req.query.folder === 'sent') {
      where.push("mailbox LIKE '%Sent%' OR direction = 'outgoing'");
    }
    if (req.query.unread === '1') where.push('is_read = 0');
    if (req.query.q) {
      where.push('(subject LIKE :q OR from_address LIKE :q OR to_address LIKE :q OR snippet LIKE :q)');
      params.q = `%${String(req.query.q).trim()}%`;
    }
    const sql = `SELECT id, direction, subject, from_address, from_name, to_address,
                        sent_at, is_read, has_attachments, snippet
                   FROM mail_messages
                  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                  ORDER BY sent_at DESC
                  LIMIT 200`;
    const rows = await query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить письма' });
  }
});

router.get('/messages/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM mail_messages WHERE id = :id LIMIT 1', {
      id: Number(req.params.id),
    });
    const message = rows[0];
    if (!message) return res.status(404).json({ error: 'Письмо не найдено' });
    const attachments = await query(
      'SELECT id, filename, content_type, size FROM mail_attachments WHERE message_id = :id',
      { id: message.id },
    );
    // помечаем прочитанным при открытии
    if (!message.is_read) {
      await query('UPDATE mail_messages SET is_read = 1 WHERE id = :id', { id: message.id });
    }
    res.json({ message, attachments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось открыть письмо' });
  }
});

router.post('/messages/:id/read', async (req, res) => {
  try {
    const isRead = req.body?.isRead === false ? 0 : 1;
    await query('UPDATE mail_messages SET is_read = :r WHERE id = :id', {
      r: isRead,
      id: Number(req.params.id),
    });
    res.json({ ok: true, isRead: Boolean(isRead) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось изменить статус письма' });
  }
});

router.get('/messages/:id/attachments/:attId', async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM mail_attachments WHERE id = :attId AND message_id = :id LIMIT 1',
      { attId: Number(req.params.attId), id: Number(req.params.id) },
    );
    const att = rows[0];
    if (!att?.content) return res.status(404).json({ error: 'Вложение не найдено' });
    res.setHeader('Content-Type', att.content_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(att.filename || 'file')}"`,
    );
    return res.send(att.content);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось скачать вложение' });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const result = await syncAllMail({ limit: Number(req.body?.limit || 100) });
    await audit(req.user.id, 'mail_sync', 'mail', null, {
      saved: result.inbox.saved + result.sent.saved,
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Синхронизация не удалась' });
  }
});

router.post('/send', async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim();
    if (!to) return res.status(400).json({ error: 'Укажите получателя' });
    const result = await sendMail({
      to,
      cc: String(req.body?.cc || '').trim() || null,
      subject: String(req.body?.subject || '').trim(),
      text: String(req.body?.text || ''),
      html: req.body?.html || null,
      userId: req.user.id,
    });
    await audit(req.user.id, 'mail_send', 'mail', result.id, { to });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Не удалось отправить письмо' });
  }
});

export default router;
