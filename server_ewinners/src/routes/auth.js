import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { authRequired, signToken } from '../middleware/auth.js';
import { audit } from '../services/billing.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Укажите email и пароль' });

    const users = await query(
      `SELECT id, email, phone, full_name, role, company_id, status, password_hash, token_version, must_set_password
       FROM users WHERE email = :email LIMIT 1`,
      { email },
    );
    const user = users[0];
    if (!user || user.status === 'blocked') {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });

    await query('UPDATE users SET last_login_at = NOW() WHERE id = :id', { id: user.id });
    await audit(user.id, 'login', 'user', user.id, { email });

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.full_name,
        role: user.role,
        companyId: user.company_id,
        mustSetPassword: !!user.must_set_password,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  let company = null;
  if (req.user.company_id) {
    const rows = await query('SELECT * FROM companies WHERE id = :id LIMIT 1', {
      id: req.user.company_id,
    });
    company = rows[0] || null;
  }
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      phone: req.user.phone,
      fullName: req.user.full_name,
      role: req.user.role,
      companyId: req.user.company_id,
      mustSetPassword: !!req.user.must_set_password,
    },
    company,
  });
});

router.post('/change-password', authRequired, async (req, res) => {
  try {
    const password = String(req.body.password || '');
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await query(
      `UPDATE users
       SET password_hash = :password_hash, must_set_password = 0, token_version = token_version + 1
       WHERE id = :id`,
      { password_hash: passwordHash, id: req.user.id },
    );
    const users = await query('SELECT * FROM users WHERE id = :id', { id: req.user.id });
    const token = signToken(users[0]);
    await audit(req.user.id, 'change_password', 'user', req.user.id, {});
    res.json({ ok: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось сменить пароль' });
  }
});

router.post('/logout-all', authRequired, async (req, res) => {
  await query('UPDATE users SET token_version = token_version + 1 WHERE id = :id', {
    id: req.user.id,
  });
  await audit(req.user.id, 'logout_all', 'user', req.user.id, {});
  res.json({ ok: true });
});

export default router;
