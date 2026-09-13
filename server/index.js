import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, pool } from './src/db.js';
import { migrate } from './src/migrate.js';
import { ensureDocsDir } from './src/services/invoicePdf.js';
import { refreshBanksFromNbrb } from './src/services/banks.js';
import authRoutes from './src/routes/auth.js';
import cabinetRoutes from './src/routes/cabinet.js';
import adminRoutes from './src/routes/admin.js';
import crmRoutes from './src/routes/crm.js';
import lookupRoutes from './src/routes/lookup.js';
import telegramRoutes from './src/routes/telegram.js';
import { startTelegramBot } from './src/services/telegramBot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

async function start() {
  ensureDocsDir();
  console.log('Connecting to MySQL...', config.db.host, config.db.database);
  await pool.query('SELECT 1');
  await migrate();
  refreshBanksFromNbrb().then((banks) => {
    console.log(`Bank directory loaded: ${Object.keys(banks).length} codes`);
  });
  startTelegramBot().catch((err) => {
    console.error('Telegram bot failed to start:', err);
  });

  // Passenger (Plesk) manages the port itself
  if (typeof PhusionPassenger !== 'undefined') {
    PhusionPassenger.configure({ autoInstall: false });
    app.listen('passenger', () => {
      console.log('E-Winners API started under Passenger');
    });
    return;
  }

  const host = process.env.HOST || '0.0.0.0';
  const port = config.port;
  const server = app.listen(port, host, () => {
    console.log(`E-Winners API → http://${host}:${port}`);
  });

  server.on('error', (err) => {
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
