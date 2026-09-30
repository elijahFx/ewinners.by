import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { config, query } from '../db.js';
import { setBalanceBroadcaster } from './balanceEvents.js';
import { isStaffRole } from './chat.js';

export function attachChatSocket(httpServer, { setChatBroadcasters }) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        String(socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('Unauthorized'));
      const payload = jwt.verify(token, config.jwtSecret);
      const users = await query(
        `SELECT id, email, full_name, role, status, token_version
         FROM users WHERE id = :id LIMIT 1`,
        { id: payload.sub },
      );
      const user = users[0];
      if (!user || user.status === 'blocked') return next(new Error('Unauthorized'));
      if ((user.token_version || 0) !== (payload.tv || 0)) return next(new Error('Unauthorized'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    socket.join(`user:${user.id}`);
    if (isStaffRole(user.role)) {
      socket.join('staff');
    } else if (user.role === 'client') {
      socket.join(`client:${user.id}`);
    }

    socket.on('chat:join', (conversationId) => {
      const id = Number(conversationId);
      if (id) socket.join(`conv:${id}`);
    });

    socket.on('chat:typing', (payload = {}) => {
      const conversationId = Number(payload.conversationId);
      if (!conversationId) return;
      socket.to(`conv:${conversationId}`).emit('chat:typing', {
        conversationId,
        userId: user.id,
        userName: user.full_name,
        isTyping: !!payload.isTyping,
      });
    });
  });

  setChatBroadcasters({
    onMessage(conversation, message) {
      io.to(`conv:${conversation.id}`).emit('chat:message', {
        conversationId: conversation.id,
        message,
      });

      const preview = message.body || (message.attachments?.[0] ? '[Вложение]' : '');
      const payload = {
        conversationId: conversation.id,
        kind: conversation.kind || 'client',
        preview,
        at: message.createdAt,
      };

      if ((conversation.kind || 'client') === 'staff') {
        if (conversation.staff_a_id) {
          io.to(`user:${conversation.staff_a_id}`).emit('chat:conversation-updated', payload);
        }
        if (conversation.staff_b_id) {
          io.to(`user:${conversation.staff_b_id}`).emit('chat:conversation-updated', payload);
        }
      } else {
        io.to('staff').emit('chat:conversation-updated', payload);
        if (conversation.client_user_id) {
          io.to(`client:${conversation.client_user_id}`).emit('chat:conversation-updated', payload);
          io.to(`user:${conversation.client_user_id}`).emit('chat:conversation-updated', payload);
        }
      }

      io.to('staff').emit('chat:unread-changed');
      if (conversation.client_user_id) {
        io.to(`user:${conversation.client_user_id}`).emit('chat:unread-changed');
      }
      if (conversation.staff_a_id) {
        io.to(`user:${conversation.staff_a_id}`).emit('chat:unread-changed');
      }
      if (conversation.staff_b_id) {
        io.to(`user:${conversation.staff_b_id}`).emit('chat:unread-changed');
      }
    },
    onTyping(conversation, payload) {
      io.to(`conv:${conversation.id}`).emit('chat:typing', payload);
    },
  });

  // Изменение баланса: сообщаем сотрудникам и пользователям этого клиента,
  // чтобы открытые страницы перечитали данные без перезагрузки.
  setBalanceBroadcaster(async ({ companyId, balanceAfter }) => {
    const payload = {
      companyId,
      balanceAfter,
      at: new Date().toISOString(),
    };

    io.to('staff').emit('balance:changed', payload);

    const rows = await query(
      `SELECT id FROM users WHERE company_id = :company_id AND status <> 'blocked'`,
      { company_id: companyId },
    );
    for (const row of rows) {
      io.to(`user:${row.id}`).emit('balance:changed', payload);
    }
  });

  return io;
}
