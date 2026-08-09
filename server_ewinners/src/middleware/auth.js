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
      `SELECT id, email, phone, full_name, role, company_id, status, token_version, must_set_password
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

export function crmAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key || key !== config.crmApiKey) {
    return res.status(401).json({ error: 'Неверный CRM API key' });
  }
  next();
}
