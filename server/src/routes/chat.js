import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import {
  assertConversationAccess,
  chatUpload,
  countPendingDialogs,
  createMessage,
  getOrCreateClientConversation,
  getOrCreateStaffConversation,
  isStaffRole,
  listConversationMessages,
  listConversationsForStaff,
  listStaffPeers,
  mapClientSelfConversation,
  markConversationRead,
} from '../services/chat.js';

const router = Router();
router.use(authRequired);

let broadcastMessage = () => {};
let broadcastTyping = () => {};

export function setChatBroadcasters({ onMessage, onTyping }) {
  if (typeof onMessage === 'function') broadcastMessage = onMessage;
  if (typeof onTyping === 'function') broadcastTyping = onTyping;
}

router.get('/unread-count', async (req, res) => {
  try {
    const count = await countPendingDialogs(req.user);
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось получить счётчик' });
  }
});

router.get('/staff-peers', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const rows = await listStaffPeers(req.user.id);
    res.json({
      items: rows.map((u) => ({
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        avatarUrl: u.avatar_url,
        role: u.role,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить сотрудников' });
  }
});

router.get('/conversations', async (req, res) => {
  try {
    if (isStaffRole(req.user.role)) {
      const items = await listConversationsForStaff(req.user.id);
      return res.json({ items });
    }

    if (req.user.role !== 'client') {
      return res.status(403).json({ error: 'Чат доступен клиентам и сотрудникам' });
    }

    const conv = await getOrCreateClientConversation(req.user.id);
    return res.json({ items: [mapClientSelfConversation(conv)] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить чаты' });
  }
});

router.post('/conversations/with-client', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const clientUserId = Number(req.body.clientUserId);
    if (!clientUserId) return res.status(400).json({ error: 'Укажите clientUserId' });
    const users = await query(
      `SELECT id, email, full_name, role FROM users WHERE id = :id AND role = 'client' LIMIT 1`,
      { id: clientUserId },
    );
    if (!users[0]) return res.status(404).json({ error: 'Клиент не найден' });
    const conv = await getOrCreateClientConversation(clientUserId);
    res.json({
      conversation: {
        id: conv.id,
        kind: 'client',
        title: users[0].full_name,
        clientUserId: conv.client_user_id,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось открыть чат' });
  }
});

router.post('/conversations/with-staff', requireRoles('admin', 'accountant'), async (req, res) => {
  try {
    const staffUserId = Number(req.body.staffUserId);
    if (!staffUserId) return res.status(400).json({ error: 'Укажите staffUserId' });
    if (staffUserId === Number(req.user.id)) {
      return res.status(400).json({ error: 'Нельзя открыть чат с собой' });
    }
    const users = await query(
      `SELECT id, email, full_name, role, avatar_url
       FROM users
       WHERE id = :id AND role IN ('admin', 'accountant') AND status != 'blocked'
       LIMIT 1`,
      { id: staffUserId },
    );
    if (!users[0]) return res.status(404).json({ error: 'Сотрудник не найден' });
    const conv = await getOrCreateStaffConversation(req.user.id, staffUserId);
    res.json({
      conversation: {
        id: conv.id,
        kind: 'staff',
        title: users[0].full_name,
        peerUserId: users[0].id,
        peerRole: users[0].role,
        avatarUrl: users[0].avatar_url,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Не удалось открыть чат' });
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    await assertConversationAccess(req.user, conversationId);
    const items = await listConversationMessages(conversationId, {
      beforeId: req.query.beforeId,
      limit: req.query.limit,
    });
    await markConversationRead(conversationId, req.user);
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Не удалось загрузить сообщения' });
  }
});

router.post(
  '/conversations/:id/messages',
  (req, res, next) => {
    chatUpload.array('files', 5)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки файлов' });
      next();
    });
  },
  async (req, res) => {
    try {
      const conversationId = Number(req.params.id);
      const conv = await assertConversationAccess(req.user, conversationId);
      const message = await createMessage({
        conversationId,
        sender: req.user,
        body: req.body?.body,
        files: req.files || [],
      });
      const fresh = await query(`SELECT * FROM chat_conversations WHERE id = :id LIMIT 1`, {
        id: conversationId,
      });
      broadcastMessage(fresh[0] || conv, message);
      res.status(201).json({ message });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({ error: err.message || 'Не удалось отправить сообщение' });
    }
  },
);

router.post('/conversations/:id/read', async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    await assertConversationAccess(req.user, conversationId);
    await markConversationRead(conversationId, req.user);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Ошибка' });
  }
});

router.post('/conversations/:id/typing', async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const conv = await assertConversationAccess(req.user, conversationId);
    broadcastTyping(conv, {
      conversationId,
      userId: req.user.id,
      userName: req.user.full_name,
      isTyping: !!req.body?.isTyping,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Ошибка' });
  }
});

export default router;
