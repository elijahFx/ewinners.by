import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { config, pool } from './src/db.js';
import { migrate } from './src/migrate.js';
import { ensureDocsDir } from './src/services/invoicePdf.js';
import { ensureChatUploadsDir } from './src/services/chat.js';
import { refreshBanksFromNbrb } from './src/services/banks.js';
import authRoutes from './src/routes/auth.js';
import cabinetRoutes from './src/routes/cabinet.js';
import adminRoutes from './src/routes/admin.js';
import crmRoutes from './src/routes/crm.js';
import lookupRoutes from './src/routes/lookup.js';
import telegramRoutes from './src/routes/telegram.js';
import chatRoutes, { setChatBroadcasters } from './src/routes/chat.js';
import internalRoutes from './src/routes/internal.js';
import { attachChatSocket } from './src/services/chatSocket.js';
import { startTelegramBot } from './src/services/telegramBot.js';
import { bootstrapYandexDisk, scheduleYandexBackup, syncAllToYandexDisk } from './src/services/yandexBackup.js';
import { ensureSalesRenderServices } from './src/services/salesrender.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/cabinet', cabinetRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/lookup', lookupRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/internal', internalRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

attachChatSocket(httpServer, { setChatBroadcasters });

async function start() {
  ensureDocsDir();
  ensureChatUploadsDir();
  console.log('Connecting to MySQL...', config.db.host, config.db.database);
  await pool.query('SELECT 1');
  await migrate();
  refreshBanksFromNbrb().then((banks) => {
    console.log(`Bank directory loaded: ${Object.keys(banks).length} codes`);
  });
  startTelegramBot().catch((err) => {
    console.error('Telegram bot failed to start:', err);
  });

  bootstrapYandexDisk().then((res) => {
    if (res?.ok) {
      // Initial backfill of existing docs/chats (async, non-blocking)
      scheduleYandexBackup('initial-sync', () => syncAllToYandexDisk());
    }
  });

  ensureSalesRenderServices()
    .then(() => console.log('SalesRender services/tariffs ready'))
    .catch((err) => console.warn('SalesRender services bootstrap:', err.message));

  // Passenger (Plesk) manages the port itself
  if (typeof PhusionPassenger !== 'undefined') {
    PhusionPassenger.configure({ autoInstall: false });
    // Passenger expects listen on the app; Socket.io is attached to httpServer.
    // For WebSockets under Passenger, enable websocket support in the panel.
    httpServer.listen('passenger', () => {
      console.log('E-Winners API started under Passenger (with Socket.io)');
    });
    return;
  }

  const host = process.env.HOST || '0.0.0.0';
  const port = config.port;
  httpServer.listen(port, host, () => {
    console.log(`E-Winners API → http://${host}:${port}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Порт ${port} уже занят. Остановите старый процесс Node (в Plesk: Node.js → Restart App) и запустите снова.`,
      );
      process.exit(1);
    }
    throw err;
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
