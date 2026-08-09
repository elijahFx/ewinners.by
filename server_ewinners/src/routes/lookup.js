import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { lookupByUnp } from '../services/egr.js';
import { lookupBankByIban, listBanks, ensureBanksFresh } from '../services/banks.js';

const router = Router();

router.use(authRequired);

router.get('/unp/:unp', async (req, res) => {
  try {
    const data = await lookupByUnp(req.params.unp);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Ошибка поиска по УНП' });
  }
});

router.get('/iban', async (req, res) => {
  try {
    const banks = await ensureBanksFresh();
    const data = lookupBankByIban(req.query.iban || '', banks);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Ошибка определения банка' });
  }
});

router.get('/banks', async (_req, res) => {
  await ensureBanksFresh();
  res.json({ items: listBanks() });
});

export default router;
