/**
 * Yandex.Disk backups for documents + chat.
 * Failures are logged and never break the main request flow.
 */
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { query } from '../db.js';
import { chatUploadsDir } from './chat.js';
import {
  diskPath,
  ensureRootTree,
  uploadJson,
  uploadLocalFile,
  uploadText,
  yandexDiskConfig,
} from './yandexDisk.js';

function safeName(value, fallback = 'item') {
  const s = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return s || fallback;
}

/**
 * Fire-and-forget backup queue.
 *
 * Tasks are de-duplicated by name (queueing the same document twice keeps a
 * single pending job) and executed strictly one at a time, so the request flow
 * is never blocked and the Disk API is not hammered. Failures are logged and
 * swallowed on purpose — backups must not break the main flow.
 */
const backupQueue = new Map();
let backupWorkerRunning = false;

export function scheduleYandexBackup(name, task) {
  if (typeof task !== 'function') return;
  if (!yandexDiskConfig().configured) return;
  backupQueue.set(String(name), task);
  void runBackupQueue();
}

async function runBackupQueue() {
  if (backupWorkerRunning) return;
  backupWorkerRunning = true;
  try {
    while (backupQueue.size > 0) {
      const [name, task] = backupQueue.entries().next().value;
      backupQueue.delete(name);
      try {
        await task();
      } catch (err) {
        console.warn(`[yandex-disk] ${name} failed:`, err.message);
      }
    }
  } finally {
    backupWorkerRunning = false;
  }
}

export function queueDocumentBackup(doc) {
  if (!doc?.id) return;
  scheduleYandexBackup(`document-${doc.id}`, () => backupDocument(doc));
}

export function queueChatMessageBackup(messageId) {
  if (!messageId) return;
  scheduleYandexBackup(`chat-message-${messageId}`, () => backupChatMessage(messageId));
}

async function companyFolderMeta(companyId) {
  const rows = await query(
    `SELECT id, name, unp FROM companies WHERE id = :id LIMIT 1`,
    { id: companyId },
  );
  const c = rows[0];
  if (!c) return `company-${companyId}`;
  const unp = c.unp ? `-${safeName(c.unp)}` : '';
  return `company-${c.id}${unp}-${safeName(c.name, 'company')}`;
}

function docTypeFolder(type) {
  if (type === 'invoice') return 'invoices';
  if (type === 'act') return 'acts';
  if (type === 'detail') return 'details';
  return 'other';
}

/** Upload a cabinet document PDF (+ meta json). */
export async function backupDocument(doc) {
  if (!doc?.file_path || !fs.existsSync(doc.file_path)) return null;
  const companyDir = await companyFolderMeta(doc.company_id);
  const typeDir = docTypeFolder(doc.type);
  const base = `${safeName(doc.number || doc.id)}-${safeName(doc.title || doc.type)}`;
  const ext = path.extname(doc.file_path) || '.pdf';
  const remoteFile = diskPath('documents', companyDir, typeDir, `${base}${ext}`);
  const remoteMeta = diskPath('documents', companyDir, typeDir, `${base}.json`);

  await uploadLocalFile(doc.file_path, remoteFile, { overwrite: true });
  await uploadJson(
    remoteMeta,
    {
      id: doc.id,
      companyId: doc.company_id,
      type: doc.type,
      number: doc.number,
      title: doc.title,
      amount: doc.amount,
      status: doc.status,
      periodFrom: doc.period_from || null,
      periodTo: doc.period_to || null,
      createdAt: doc.created_at || null,
      backedUpAt: new Date().toISOString(),
      localFile: path.basename(doc.file_path),
    },
    { overwrite: true },
  );
  return remoteFile;
}

export async function backupDocumentById(documentId) {
  const rows = await query(`SELECT * FROM documents WHERE id = :id LIMIT 1`, {
    id: documentId,
  });
  if (!rows[0]) return null;
  return backupDocument(rows[0]);
}

async function conversationFolderName(conv) {
  if (!conv) return 'unknown';
  if (conv.kind === 'staff') {
    const users = await query(
      `SELECT id, full_name, email FROM users WHERE id = :a OR id = :b`,
      { a: conv.staff_a_id, b: conv.staff_b_id },
    );
    const names = users.map((u) => safeName(u.full_name || u.email || u.id)).join('_');
    return `staff-${conv.id}-${names || 'dm'}`;
  }
  const users = await query(
    `SELECT u.id, u.full_name, u.email, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE u.id = :id LIMIT 1`,
    { id: conv.client_user_id },
  );
  const u = users[0];
  const label = safeName(u?.company_name || u?.full_name || u?.email || conv.client_user_id);
  return `client-${conv.id}-${label}`;
}

function localChatFilePath(filePathOrUrl) {
  if (!filePathOrUrl) return null;
  if (path.isAbsolute(filePathOrUrl) && fs.existsSync(filePathOrUrl)) return filePathOrUrl;
  const base = path.basename(String(filePathOrUrl));
  const candidate = path.join(chatUploadsDir, base);
  return fs.existsSync(candidate) ? candidate : null;
}

/** Save one chat message + attachments + refresh conversation transcript. */
export async function backupChatMessage(messageId) {
  const rows = await query(
    `SELECT m.*, u.full_name AS sender_name, u.role AS sender_role, u.email AS sender_email
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = :id LIMIT 1`,
    { id: messageId },
  );
  const msg = rows[0];
  if (!msg) return null;

  const convRows = await query(`SELECT * FROM chat_conversations WHERE id = :id LIMIT 1`, {
    id: msg.conversation_id,
  });
  const conv = convRows[0];
  const folder = await conversationFolderName(conv);
  const baseDir = ['chat', 'conversations', folder];

  const attachments = await query(
    `SELECT * FROM chat_attachments WHERE message_id = :id ORDER BY id ASC`,
    { id: messageId },
  );

  const uploadedFiles = [];
  for (const att of attachments) {
    const local = localChatFilePath(att.file_path);
    if (!local) continue;
    const remote = diskPath(
      ...baseDir,
      'files',
      `${att.id}-${safeName(att.original_name || path.basename(local))}`,
    );
    await uploadLocalFile(local, remote, { overwrite: true });
    uploadedFiles.push({
      id: att.id,
      name: att.original_name,
      mimeType: att.mime_type,
      size: att.size_bytes,
      kind: att.kind,
      remotePath: remote,
    });
  }

  const payload = {
    id: msg.id,
    conversationId: msg.conversation_id,
    senderId: msg.sender_id,
    senderName: msg.sender_name,
    senderRole: msg.sender_role,
    senderEmail: msg.sender_email,
    body: msg.body || '',
    createdAt: msg.created_at,
    attachments: uploadedFiles,
    backedUpAt: new Date().toISOString(),
  };

  await uploadJson(
    diskPath(...baseDir, 'messages', `${String(msg.id).padStart(8, '0')}.json`),
    payload,
    { overwrite: true },
  );

  await refreshConversationTranscript(conv, folder);
  return payload;
}

async function refreshConversationTranscript(conv, folderName) {
  if (!conv) return;
  const folder = folderName || (await conversationFolderName(conv));
  const messages = await query(
    `SELECT m.id, m.body, m.created_at, u.full_name, u.role, u.email
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = :id
     ORDER BY m.id ASC`,
    { id: conv.id },
  );

  const attRows = await query(
    `SELECT a.message_id, a.original_name, a.kind
     FROM chat_attachments a
     JOIN chat_messages m ON m.id = a.message_id
     WHERE m.conversation_id = :id
     ORDER BY a.id ASC`,
    { id: conv.id },
  );
  const attsByMsg = new Map();
  for (const a of attRows) {
    if (!attsByMsg.has(a.message_id)) attsByMsg.set(a.message_id, []);
    attsByMsg.get(a.message_id).push(a);
  }

  const lines = [];
  lines.push(`# Переписка #${conv.id} (${conv.kind || 'client'})`);
  lines.push(`Обновлено: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`);
  lines.push('');

  for (const m of messages) {
    const when = dayjs(m.created_at).format('YYYY-MM-DD HH:mm:ss');
    const who = `${m.full_name || m.email || m.id} [${m.role}]`;
    lines.push(`[${when}] ${who}`);
    if (m.body) lines.push(m.body);
    const files = attsByMsg.get(m.id) || [];
    for (const f of files) {
      lines.push(`  📎 ${f.original_name} (${f.kind})`);
    }
    lines.push('');
  }

  await uploadText(
    diskPath('chat', 'conversations', folder, 'transcript.txt'),
    lines.join('\n'),
    { overwrite: true },
  );

  await uploadJson(
    diskPath('chat', 'conversations', folder, 'meta.json'),
    {
      id: conv.id,
      kind: conv.kind,
      clientUserId: conv.client_user_id,
      staffAId: conv.staff_a_id,
      staffBId: conv.staff_b_id,
      createdAt: conv.created_at,
      lastMessageAt: conv.last_message_at,
      messageCount: messages.length,
      backedUpAt: new Date().toISOString(),
    },
    { overwrite: true },
  );
}

/** One-shot / periodic sync of all documents + chats already in DB. */
export async function syncAllToYandexDisk({ limitDocs = 5000, limitMessages = 20000 } = {}) {
  const cfg = yandexDiskConfig();
  if (!cfg.configured) {
    return { ok: false, message: 'YANDEX_DISK_TOKEN не задан' };
  }

  await ensureRootTree();

  const docs = await query(
    `SELECT * FROM documents
     WHERE file_path IS NOT NULL
     ORDER BY id DESC
     LIMIT ${Number(limitDocs) || 5000}`,
  );
  let docsOk = 0;
  let docsFail = 0;
  for (const doc of docs) {
    try {
      await backupDocument(doc);
      docsOk += 1;
    } catch (err) {
      docsFail += 1;
      console.warn('[yandex-disk] doc', doc.id, err.message);
    }
  }

  const messages = await query(
    `SELECT id FROM chat_messages ORDER BY id ASC LIMIT ${Number(limitMessages) || 20000}`,
  );
  let msgOk = 0;
  let msgFail = 0;
  for (const m of messages) {
    try {
      await backupChatMessage(m.id);
      msgOk += 1;
    } catch (err) {
      msgFail += 1;
      console.warn('[yandex-disk] message', m.id, err.message);
    }
  }

  return {
    ok: true,
    documents: { ok: docsOk, fail: docsFail, total: docs.length },
    messages: { ok: msgOk, fail: msgFail, total: messages.length },
  };
}

export async function bootstrapYandexDisk() {
  const cfg = yandexDiskConfig();
  if (!cfg.configured) {
    console.log('[yandex-disk] skipped (no YANDEX_DISK_TOKEN)');
    return { ok: false };
  }
  try {
    const tree = await ensureRootTree();
    console.log('[yandex-disk] root ready:', tree.root);
    return tree;
  } catch (err) {
    console.warn('[yandex-disk] bootstrap failed:', err.message);
    return { ok: false, error: err.message };
  }
}
