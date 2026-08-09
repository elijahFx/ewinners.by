import { Router } from 'express';
import { handleTelegramUpdate } from '../services/telegramBot.js';

const router = Router();

router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      if (header !== secret) {
        return res.status(401).json({ error: 'Invalid secret' });
      }
    }
    await handleTelegramUpdate(req.body || {});
    res.json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error:', err);
    // Always 200 to Telegram to avoid retries storm on logic errors
    res.json({ ok: false });
  }
});

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    mode: process.env.TELEGRAM_WEBHOOK_URL ? 'webhook' : 'polling',
  });
});

export default router;
