import { Router } from 'express';
import {
  createAccountConsent,
  getAccountConsent,
  getMtbankStatus,
  mtbankConfig,
} from '../services/mtbank.js';
import { syncMtbankPayments } from '../services/bankSync.js';
import { bootstrapYandexDisk, syncAllToYandexDisk } from '../services/yandexBackup.js';
import { yandexDiskConfig } from '../services/yandexDisk.js';

const router = Router();

function cronAuth(req, res, next) {
  const cfg = mtbankConfig();
  const expected =
    String(process.env.MTBANK_CRON_SECRET || process.env.CRM_API_KEY || '').trim();
  const got = String(
    req.headers['x-cron-secret'] ||
      req.headers['x-api-key'] ||
      req.query.secret ||
      '',
  ).trim();

  if (!expected) {
    return res.status(503).json({
      error: 'Задайте MTBANK_CRON_SECRET или CRM_API_KEY для защиты cron-эндпоинта',
    });
  }
  if (!got || got !== expected) {
    return res.status(401).json({ error: 'Неверный секрет cron' });
  }
  next();
}

router.use(cronAuth);

/** PHP / system cron: check incoming payments and mark matching invoices paid */
router.post('/bank/sync', async (req, res) => {
  try {
    const from = req.body?.from || req.query.from || null;
    const to = req.body?.to || req.query.to || null;
    const lookbackDays = Number(req.body?.lookbackDays || req.query.lookbackDays || 7);
    const result = await syncMtbankPayments({ from, to, lookbackDays });
    res.json(result);
  } catch (err) {
    console.error('bank sync failed:', err);
    res.status(400).json({ ok: false, error: err.message || 'Ошибка синхронизации MTBank' });
  }
});

router.get('/bank/sync', async (req, res) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const lookbackDays = Number(req.query.lookbackDays || 7);
    const result = await syncMtbankPayments({ from, to, lookbackDays });
    res.json(result);
  } catch (err) {
    console.error('bank sync failed:', err);
    res.status(400).json({ ok: false, error: err.message || 'Ошибка синхронизации MTBank' });
  }
});

router.get('/bank/status', async (_req, res) => {
  try {
    res.json(await getMtbankStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** One-time helper: create accountConsent (then authorize it in MTBank cabinet) */
router.post('/bank/consent', async (req, res) => {
  try {
    const result = await createAccountConsent({
      expirationDateTime: req.body?.expirationDateTime,
    });
    res.status(201).json({
      ...result,
      hint:
        'Сохраните consentId в MTBANK_CONSENT_ID, затем в кабинете MTBank: Open API → три точки → Авторизовать согласие (счета + SMS).',
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Не удалось создать согласие' });
  }
});

router.get('/bank/consent', async (req, res) => {
  try {
    const id = req.query.id || mtbankConfig().consentId;
    const payload = await getAccountConsent(id);
    res.json(payload);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/yandex/status', async (_req, res) => {
  const cfg = yandexDiskConfig();
  res.json({
    configured: cfg.configured,
    root: cfg.root,
    rootPath: cfg.rootPath,
  });
});

/** Full backfill of documents + chat to Yandex.Disk */
router.post('/yandex/sync', async (_req, res) => {
  try {
    const tree = await bootstrapYandexDisk();
    if (!tree?.ok) {
      return res.status(503).json({ ok: false, error: tree?.error || 'Yandex Disk не настроен' });
    }
    const result = await syncAllToYandexDisk();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ ok: false, error: err.message || 'Ошибка синхронизации Яндекс.Диска' });
  }
});

export default router;
