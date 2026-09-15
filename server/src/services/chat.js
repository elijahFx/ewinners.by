import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { query } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const chatUploadsDir = path.join(__dirname, '../../uploads/chat');

export function ensureChatUploadsDir() {
  if (!fs.existsSync(chatUploadsDir)) {
    fs.mkdirSync(chatUploadsDir, { recursive: true });
  }
  return chatUploadsDir;
}

function attachmentKind(mime) {
  if (String(mime).startsWith('image/')) return 'image';
  if (String(mime).startsWith('video/')) return 'video';
  return 'file';
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureChatUploadsDir();
    cb(null, chatUploadsDir);
  },
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || 'file')
      .replace(/[^\w.\-а-яА-ЯёЁ]+/g, '_')
      .slice(0, 80);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
  },
});

export const chatUpload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /^(image|video)\//.test(file.mimetype) ||
      [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/zip',
        'text/plain',
      ].includes(file.mimetype);
    cb(ok ? null : new Error('Тип файла не поддерживается'), ok);
  },
});

export function isStaffRole(role) {
  return ['admin', 'accountant'].includes(role);
}

function roleLabel(role) {
  if (role === 'admin') return 'Админ';
  if (role === 'accountant') return 'Бухгалтер';
  if (role === 'client') return 'Клиент';
  return role || '';
}

export async function getOrCreateClientConversation(clientUserId) {
  const existing = await query(
    `SELECT * FROM chat_conversations
     WHERE kind = 'client' AND client_user_id = :uid
     LIMIT 1`,
    { uid: clientUserId },
  );
  if (existing[0]) return existing[0];

  const result = await query(
    `INSERT INTO chat_conversations (kind, client_user_id)
     VALUES ('client', :uid)`,
    { uid: clientUserId },
  );
  const rows = await query(`SELECT * FROM chat_conversations WHERE id = :id`, {
    id: result.insertId,
  });
  return rows[0];
}

export async function getOrCreateStaffConversation(userIdA, userIdB) {
  const a = Math.min(Number(userIdA), Number(userIdB));
  const b = Math.max(Number(userIdA), Number(userIdB));
  if (!a || !b || a === b) {
    const err = new Error('Некорректные участники чата');
    err.status = 400;
    throw err;
  }

  const existing = await query(
    `SELECT * FROM chat_conversations
     WHERE kind = 'staff' AND staff_a_id = :a AND staff_b_id = :b
     LIMIT 1`,
    { a, b },
  );
  if (existing[0]) return existing[0];

  const result = await query(
    `INSERT INTO chat_conversations (kind, staff_a_id, staff_b_id)
     VALUES ('staff', :a, :b)`,
    { a, b },
  );
  const rows = await query(`SELECT * FROM chat_conversations WHERE id = :id`, {
    id: result.insertId,
  });
  return rows[0];
}

export async function assertConversationAccess(user, conversationId) {
  const rows = await query(`SELECT * FROM chat_conversations WHERE id = :id LIMIT 1`, {
    id: conversationId,
  });
  const conv = rows[0];
  if (!conv) {
    const err = new Error('Чат не найден');
    err.status = 404;
    throw err;
  }

  const kind = conv.kind || 'client';
  if (kind === 'client') {
    if (isStaffRole(user.role)) return conv;
    if (Number(conv.client_user_id) !== Number(user.id)) {
      const err = new Error('Нет доступа к чату');
      err.status = 403;
      throw err;
    }
    return conv;
  }

  // staff DM
  if (!isStaffRole(user.role)) {
    const err = new Error('Нет доступа к чату');
    err.status = 403;
    throw err;
  }
  const uid = Number(user.id);
  if (uid !== Number(conv.staff_a_id) && uid !== Number(conv.staff_b_id)) {
    const err = new Error('Нет доступа к чату');
    err.status = 403;
    throw err;
  }
  return conv;
}

export async function mapAttachments(messageId) {
  const rows = await query(
    `SELECT id, file_path, original_name, mime_type, size_bytes, kind
     FROM chat_attachments WHERE message_id = :id ORDER BY id ASC`,
    { id: messageId },
  );
  return rows.map((a) => ({
    id: a.id,
    url: a.file_path,
    name: a.original_name,
    mimeType: a.mime_type,
    size: a.size_bytes,
    kind: a.kind,
  }));
}

export async function mapMessage(row) {
  const attachments = await mapAttachments(row.id);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name || null,
    senderRole: row.sender_role || null,
    body: row.body || '',
    createdAt: row.created_at,
    attachments,
  };
}

export async function listConversationMessages(conversationId, { beforeId, limit = 50 } = {}) {
  const params = { conversation_id: conversationId };
  let sql = `
    SELECT m.*, u.full_name AS sender_name, u.role AS sender_role
    FROM chat_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = :conversation_id`;
  if (beforeId) {
    sql += ' AND m.id < :before_id';
    params.before_id = Number(beforeId);
  }
  const lim = Math.min(100, Number(limit) || 50);
  sql += ` ORDER BY m.id DESC LIMIT ${lim}`;
  const rows = await query(sql, params);
  const messages = [];
  for (const row of rows.reverse()) {
    messages.push(await mapMessage(row));
  }
  return messages;
}

export async function createMessage({ conversationId, sender, body, files = [] }) {
  const text = String(body || '').trim();
  if (!text && (!files || !files.length)) {
    const err = new Error('Пустое сообщение');
    err.status = 400;
    throw err;
  }

  const convRows = await query(`SELECT * FROM chat_conversations WHERE id = :id LIMIT 1`, {
    id: conversationId,
  });
  const conv = convRows[0];
  if (!conv) {
    const err = new Error('Чат не найден');
    err.status = 404;
    throw err;
  }

  const result = await query(
    `INSERT INTO chat_messages (conversation_id, sender_id, body)
     VALUES (:conversation_id, :sender_id, :body)`,
    {
      conversation_id: conversationId,
      sender_id: sender.id,
      body: text || null,
    },
  );
  const messageId = result.insertId;

  for (const file of files) {
    const rel = `/uploads/chat/${path.basename(file.filename || file.path)}`;
    await query(
      `INSERT INTO chat_attachments
        (message_id, file_path, original_name, mime_type, size_bytes, kind)
       VALUES
        (:message_id, :file_path, :original_name, :mime_type, :size_bytes, :kind)`,
      {
        message_id: messageId,
        file_path: rel,
        original_name: file.originalname || 'file',
        mime_type: file.mimetype || 'application/octet-stream',
        size_bytes: file.size || 0,
        kind: attachmentKind(file.mimetype),
      },
    );
  }

  const preview =
    text.slice(0, 120) ||
    (files[0]
      ? `[${attachmentKind(files[0].mimetype) === 'image' ? 'Фото' : attachmentKind(files[0].mimetype) === 'video' ? 'Видео' : 'Файл'}]`
      : '');

  const kind = conv.kind || 'client';
  if (kind === 'staff') {
    const senderId = Number(sender.id);
    const aInc = senderId === Number(conv.staff_a_id) ? 0 : 1;
    const bInc = senderId === Number(conv.staff_b_id) ? 0 : 1;
    await query(
      `UPDATE chat_conversations
       SET last_message_at = NOW(),
           last_message_preview = :preview,
           a_unread = a_unread + :a_inc,
           b_unread = b_unread + :b_inc
       WHERE id = :id`,
      { id: conversationId, preview, a_inc: aInc, b_inc: bInc },
    );
  } else {
    const staffSender = isStaffRole(sender.role);
    await query(
      `UPDATE chat_conversations
       SET last_message_at = NOW(),
           last_message_preview = :preview,
           client_unread = client_unread + :client_inc,
           staff_unread = staff_unread + :staff_inc
       WHERE id = :id`,
      {
        id: conversationId,
        preview,
        client_inc: staffSender ? 1 : 0,
        staff_inc: staffSender ? 0 : 1,
      },
    );
  }

  const rows = await query(
    `SELECT m.*, u.full_name AS sender_name, u.role AS sender_role
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = :id`,
    { id: messageId },
  );
  return mapMessage(rows[0]);
}

export async function markConversationRead(conversationId, user) {
  const rows = await query(`SELECT * FROM chat_conversations WHERE id = :id LIMIT 1`, {
    id: conversationId,
  });
  const conv = rows[0];
  if (!conv) return;

  const kind = conv.kind || 'client';
  if (kind === 'staff') {
    if (Number(user.id) === Number(conv.staff_a_id)) {
      await query(`UPDATE chat_conversations SET a_unread = 0 WHERE id = :id`, {
        id: conversationId,
      });
    } else if (Number(user.id) === Number(conv.staff_b_id)) {
      await query(`UPDATE chat_conversations SET b_unread = 0 WHERE id = :id`, {
        id: conversationId,
      });
    }
    return;
  }

  if (isStaffRole(user.role)) {
    await query(`UPDATE chat_conversations SET staff_unread = 0 WHERE id = :id`, {
      id: conversationId,
    });
  } else {
    await query(`UPDATE chat_conversations SET client_unread = 0 WHERE id = :id`, {
      id: conversationId,
    });
  }
}

function mapClientConversationRow(c) {
  return {
    id: c.id,
    kind: 'client',
    title: c.client_name || 'Клиент',
    subtitle: [c.company_name, roleLabel('client')].filter(Boolean).join(' · ') || 'Клиент',
    avatarUrl: c.client_avatar,
    clientUserId: c.client_user_id,
    peerUserId: null,
    peerRole: 'client',
    lastMessageAt: c.last_message_at,
    lastMessagePreview: c.last_message_preview || null,
    unread: Number(c.staff_unread) || 0,
  };
}

function mapStaffConversationRow(c, currentUserId) {
  const iAmA = Number(currentUserId) === Number(c.staff_a_id);
  const peerName = iAmA ? c.b_name : c.a_name;
  const peerEmail = iAmA ? c.b_email : c.a_email;
  const peerAvatar = iAmA ? c.b_avatar : c.a_avatar;
  const peerRole = iAmA ? c.b_role : c.a_role;
  const peerId = iAmA ? c.staff_b_id : c.staff_a_id;
  const unread = iAmA ? c.a_unread : c.b_unread;

  return {
    id: c.id,
    kind: 'staff',
    title: peerName || 'Сотрудник',
    subtitle: [roleLabel(peerRole), peerEmail].filter(Boolean).join(' · '),
    avatarUrl: peerAvatar,
    clientUserId: null,
    peerUserId: peerId,
    peerRole,
    lastMessageAt: c.last_message_at,
    lastMessagePreview: c.last_message_preview || null,
    unread: Number(unread) || 0,
  };
}

export async function listConversationsForStaff(currentUserId) {
  const clients = await query(
    `SELECT id FROM users WHERE role = 'client' AND status != 'blocked'`,
  );
  for (const c of clients) {
    await getOrCreateClientConversation(c.id);
  }

  const clientRows = await query(
    `SELECT c.*,
            u.full_name AS client_name,
            u.email AS client_email,
            u.avatar_url AS client_avatar,
            co.name AS company_name
     FROM chat_conversations c
     JOIN users u ON u.id = c.client_user_id
     LEFT JOIN companies co ON co.id = u.company_id
     WHERE c.kind = 'client' AND u.role = 'client'
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
  );

  const staffRows = await query(
    `SELECT c.*,
            ua.full_name AS a_name, ua.email AS a_email, ua.avatar_url AS a_avatar, ua.role AS a_role,
            ub.full_name AS b_name, ub.email AS b_email, ub.avatar_url AS b_avatar, ub.role AS b_role
     FROM chat_conversations c
     JOIN users ua ON ua.id = c.staff_a_id
     JOIN users ub ON ub.id = c.staff_b_id
     WHERE c.kind = 'staff'
       AND (c.staff_a_id = :uid OR c.staff_b_id = :uid)
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    { uid: currentUserId },
  );

  return [
    ...staffRows.map((r) => mapStaffConversationRow(r, currentUserId)),
    ...clientRows.map(mapClientConversationRow),
  ].sort((a, b) => {
    const ta = new Date(a.lastMessageAt || 0).getTime();
    const tb = new Date(b.lastMessageAt || 0).getTime();
    return tb - ta;
  });
}

export async function listStaffPeers(currentUserId) {
  return query(
    `SELECT id, email, full_name, avatar_url, role
     FROM users
     WHERE role IN ('admin', 'accountant')
       AND status != 'blocked'
       AND id != :uid
     ORDER BY full_name ASC, email ASC`,
    { uid: currentUserId },
  );
}

export async function countPendingDialogs(user) {
  if (isStaffRole(user.role)) {
    const clientPending = await query(
      `SELECT COUNT(*) AS c FROM chat_conversations
       WHERE kind = 'client' AND staff_unread > 0`,
    );
    const staffPending = await query(
      `SELECT COUNT(*) AS c FROM chat_conversations
       WHERE kind = 'staff'
         AND (
           (staff_a_id = :uid AND a_unread > 0)
           OR (staff_b_id = :uid AND b_unread > 0)
         )`,
      { uid: user.id },
    );
    return Number(clientPending[0]?.c || 0) + Number(staffPending[0]?.c || 0);
  }

  if (user.role === 'client') {
    const rows = await query(
      `SELECT COUNT(*) AS c FROM chat_conversations
       WHERE kind = 'client' AND client_user_id = :uid AND client_unread > 0`,
      { uid: user.id },
    );
    return Number(rows[0]?.c || 0);
  }

  return 0;
}

export function mapClientSelfConversation(conv) {
  return {
    id: conv.id,
    kind: 'client',
    title: 'Поддержка E-Winners',
    subtitle: 'Сообщения администраторам',
    avatarUrl: null,
    clientUserId: conv.client_user_id,
    peerUserId: null,
    peerRole: null,
    lastMessageAt: conv.last_message_at,
    lastMessagePreview: conv.last_message_preview || null,
    unread: Number(conv.client_unread) || 0,
  };
}
