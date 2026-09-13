import jwt from 'jsonwebtoken';
import { config, query } from '../db.js';

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      companyId: user.company_id || null,
      tv: user.token_version || 0,
    },
    config.jwtSecret,
    { expiresIn: '7d' },
  );
}

export async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

    const payload = jwt.verify(token, config.jwtSecret);
    const users = await query(
      `SELECT id, email, phone, full_name, avatar_url, role, company_id, status, token_version, must_set_password,
              notify_email, notify_telegram, telegram_chat_id
       FROM users WHERE id = :id LIMIT 1`,
      { id: payload.sub },
    );
    const user = users[0];
    if (!user || user.status === 'blocked') {
      return res.status(401).json({ error: 'Пользователь недоступен' });
    }
    if ((user.token_version || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ error: 'Сессия истекла' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}

export async function crmAuth(req, res, next) {
  try {
    const key = String(req.headers['x-api-key'] || req.query.api_key || '').trim();
    if (!key) {
      return res.status(401).json({ error: 'Требуется X-Api-Key' });
    }

    const rows = await query(
      `SELECT id, name, unp, status, balance, credit_limit, notify_threshold, low_balance_action,
              api_key, api_key_created_at
       FROM companies
       WHERE api_key = :api_key
       LIMIT 1`,
      { api_key: key },
    );
    const company = rows[0];
    if (!company) {
      return res.status(401).json({ error: 'Неверный CRM API key' });
    }
    if (company.status === 'blocked') {
      return res.status(403).json({ error: 'Компания заблокирована' });
    }

    req.crmCompany = company;
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Ошибка авторизации CRM' });
  }
}
