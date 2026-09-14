import { Router } from 'express';
import bcrypt from 'bcrypt';
import fs from 'fs';
import { query } from '../db.js';
import { authRequired, signToken } from '../middleware/auth.js';
import { audit } from '../services/billing.js';
import { absoluteAvatarPath, createAvatarUpload } from '../services/avatars.js';
import {
  createLoginChallenge,
  isAdminTwoFaRole,
  resendLoginChallenge,
  sendTwoFaCode,
  telegramBotConfigured,
  verifyLoginChallenge,
} from '../services/twofa.js';
import {
  acceptInvite,
  findValidToken,
  resetPasswordWithToken,
  sendPasswordResetEmail,
} from '../services/authMail.js';
import { listUserCompanies, mapCompany } from '../services/userCompanies.js';

const upload = createAvatarUpload((req) => req.user.id);
const router = Router();

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.full_name,
    avatarUrl: user.avatar_url || null,
    role: user.role,
    companyId: user.company_id,
    mustSetPassword: !!user.must_set_password,
    notifyEmail: user.notify_email == null ? true : !!user.notify_email,
    notifyTelegram: !!user.notify_telegram,
    telegramChatId: user.telegram_chat_id || '',
    mustSetupTelegram2fa: isAdminTwoFaRole(user.role) && !user.telegram_chat_id,
  };
}

async function issueSession(user, auditAction = 'login') {
  await query('UPDATE users SET last_login_at = NOW() WHERE id = :id', { id: user.id });
  await audit(user.id, auditAction, 'user', user.id, { email: user.email });
  return {
    token: signToken(user),
    user: publicUser(user),
  };
}

router.post('/login', async (req, res) => {
  try {
    const login = String(req.body.login || req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!login || !password) {
      return res.status(400).json({ error: 'Укажите логин (или email) и пароль' });
    }

    const users = await query(
      `SELECT id, email, phone, full_name, avatar_url, role, company_id, status, password_hash, token_version,
              must_set_password, notify_email, notify_telegram, telegram_chat_id
       FROM users WHERE email = :login LIMIT 1`,
      { login },
    );
    const user = users[0];
    if (!user || user.status === 'blocked') {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    if (user.status === 'invited') {
      return res.status(403).json({
        error: 'Аккаунт ещё не активирован. Откройте приглашение из письма и задайте пароль',
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });

    if (isAdminTwoFaRole(user.role) && telegramBotConfigured() && user.telegram_chat_id) {
      try {
        const { challengeId, code, expiresAt, ttlMinutes } = await createLoginChallenge(user.id);
        await sendTwoFaCode({
          chatId: user.telegram_chat_id,
          code,
          email: user.email,
          ttlMinutes,
        });
        await audit(user.id, 'login_2fa_sent', 'user', user.id, { email: user.email, login });
        return res.json({
          requires2fa: true,
          challengeId,
          expiresAt,
          message: 'Код отправлен в Telegram',
        });
      } catch (err) {
        console.error(err);
        return res.status(502).json({
          error: err.message || 'Не удалось отправить код в Telegram',
        });
      }
    }

    if (isAdminTwoFaRole(user.role) && telegramBotConfigured() && !user.telegram_chat_id) {
      const session = await issueSession(user, 'login_needs_2fa_setup');
      return res.json({
        ...session,
        mustSetupTelegram2fa: true,
        message: 'Привяжите Telegram для двухфакторной аутентификации',
      });
    }

    if (isAdminTwoFaRole(user.role) && !telegramBotConfigured()) {
      console.warn('TELEGRAM_BOT_TOKEN не задан — 2FA для админа пропущена');
    }

    res.json(await issueSession(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

router.post('/2fa/verify', async (req, res) => {
  try {
    const challengeId = String(req.body.challengeId || '').trim();
    const code = String(req.body.code || '').trim();
    if (!challengeId || !code) {
      return res.status(400).json({ error: 'Укажите challengeId и код' });
    }

    const user = await verifyLoginChallenge(challengeId, code);
    res.json(await issueSession(user, 'login_2fa_ok'));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Неверный код' });
  }
});

router.post('/2fa/resend', async (req, res) => {
  try {
    const challengeId = String(req.body.challengeId || '').trim();
    if (!challengeId) return res.status(400).json({ error: 'Укажите challengeId' });
    const result = await resendLoginChallenge(challengeId);
    res.json({
      requires2fa: true,
      challengeId: result.challengeId,
      expiresAt: result.expiresAt,
      message: 'Код отправлен повторно в Telegram',
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Не удалось отправить код' });
  }
});

router.get('/token-info', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    const type = String(req.query.type || '').trim();
    if (!token || !['invite', 'password_reset'].includes(type)) {
      return res.status(400).json({ error: 'Некорректный запрос' });
    }
    const row = await findValidToken(token, type);
    if (!row) {
      return res.status(400).json({ error: 'Ссылка недействительна или истекла' });
    }
    res.json({
      ok: true,
      type,
      email: row.email,
      fullName: row.full_name,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Ссылка недействительна' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Укажите email' });
    await sendPasswordResetEmail(email);
    res.json({
      ok: true,
      message: 'Если аккаунт существует, мы отправили письмо со ссылкой для сброса пароля',
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Не удалось отправить письмо' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const user = await resetPasswordWithToken({
      token: req.body.token,
      password: req.body.password,
    });
    await audit(user.id, 'password_reset', 'user', user.id, {});
    res.json(await issueSession(user, 'login_after_reset'));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Не удалось сменить пароль' });
  }
});

router.post('/accept-invite', async (req, res) => {
  try {
    const user = await acceptInvite({
      token: req.body.token,
      password: req.body.password,
    });
    await audit(user.id, 'accept_invite', 'user', user.id, {});
    if (isAdminTwoFaRole(user.role) && telegramBotConfigured() && user.telegram_chat_id) {
      const { challengeId, code, expiresAt, ttlMinutes } = await createLoginChallenge(user.id);
      await sendTwoFaCode({
        chatId: user.telegram_chat_id,
        code,
        email: user.email,
        ttlMinutes,
      });
      return res.json({
        requires2fa: true,
        challengeId,
        expiresAt,
        message: 'Пароль сохранён. Код отправлен в Telegram',
      });
    }
    res.json(await issueSession(user, 'login_after_invite'));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Не удалось принять приглашение' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  let company = null;
  let companies = [];
  if (req.user.company_id) {
    const rows = await query('SELECT * FROM companies WHERE id = :id LIMIT 1', {
      id: req.user.company_id,
    });
    company = rows[0] || null;
  }
  if (req.user.role === 'client') {
    try {
      const rows = await listUserCompanies(req.user.id);
      companies = rows.map(mapCompany);
      if (!company && rows[0]) {
        company = rows[0];
      }
    } catch (err) {
      console.warn('companies list failed', err.message);
    }
  }
  res.json({
    user: publicUser(req.user),
    company,
    companies,
    telegramBotConfigured: telegramBotConfigured(),
  });
});

router.patch('/notification-prefs', authRequired, async (req, res) => {
  try {
    const notifyEmail =
      req.body.notifyEmail !== undefined
        ? !!req.body.notifyEmail
        : req.user.notify_email == null
          ? true
          : !!req.user.notify_email;
    const notifyTelegram =
      req.body.notifyTelegram !== undefined
        ? !!req.body.notifyTelegram
        : !!req.user.notify_telegram;
    const telegramChatId =
      req.body.telegramChatId !== undefined
        ? String(req.body.telegramChatId || '').trim() || null
        : req.user.telegram_chat_id || null;

    await query(
      `UPDATE users SET
         notify_email = :notify_email,
         notify_telegram = :notify_telegram,
         telegram_chat_id = :telegram_chat_id
       WHERE id = :id`,
      {
        id: req.user.id,
        notify_email: notifyEmail ? 1 : 0,
        notify_telegram: notifyTelegram ? 1 : 0,
        telegram_chat_id: telegramChatId,
      },
    );
    const users = await query(
      `SELECT id, email, phone, full_name, avatar_url, role, company_id, must_set_password,
              notify_email, notify_telegram, telegram_chat_id
       FROM users WHERE id = :id`,
      { id: req.user.id },
    );
    await audit(req.user.id, 'update_notify_prefs', 'user', req.user.id, {
      notifyEmail,
      notifyTelegram,
      telegramChatId,
    });
    res.json({ user: publicUser(users[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось сохранить настройки уведомлений' });
  }
});

router.post('/avatar', authRequired, (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
      if (!req.file) return res.status(400).json({ error: 'Выберите файл изображения' });

      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      const prev = req.user.avatar_url;
      await query('UPDATE users SET avatar_url = :avatar_url WHERE id = :id', {
        avatar_url: avatarUrl,
        id: req.user.id,
      });

      const oldPath = absoluteAvatarPath(prev);
      if (oldPath) fs.promises.unlink(oldPath).catch(() => {});

      await audit(req.user.id, 'upload_avatar', 'user', req.user.id, { avatarUrl });
      res.json({ avatarUrl });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Не удалось сохранить аватар' });
    }
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
