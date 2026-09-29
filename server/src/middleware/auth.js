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

/**
 * Auth for SalesRender webhooks.
 * Accepts:
 *  1) SALESRENDER_API_KEY (global shared secret from .env)
 *  2) or a company api_key (legacy / per-client webhooks)
 *
 * Company for debit is resolved from (in order):
 *  - body.companyName / organization / company.name  → поиск по названию в companies
 *  - body.companyId / company_id
 *  - body.companyApiKey matching companies.api_key
 *  - SALESRENDER_COMPANY_ID from .env
 *  - company bound when auth was via company api_key
 */
function normalizeCompanyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(ооо|оао|зао|ип|чтуп|удп|пао)\b\.?/gi, '')
    .trim();
}

function extractCompanyName(payload) {
  if (!payload || typeof payload !== 'object') return '';
  try {
    // lazy import-free: mirror salesrender extractors inline for auth middleware
    const orders =
      payload?.data?.ordersFetcher?.orders ||
      payload?.ordersFetcher?.orders ||
      null;
    const order = Array.isArray(orders) ? orders[0] : null;
    const candidates = [
      payload.companyName,
      payload.company_name,
      payload.organization,
      payload.organisation,
      payload.orgName,
      payload.org_name,
      payload.company?.name,
      payload.organizationName,
      payload.organization_name,
      payload.clientCompany,
      payload.client_company,
      payload.project?.name,
      order?.project?.name,
      order?.companyName,
    ];
    for (const c of candidates) {
      const s = String(c || '').trim();
      if (s) return s;
    }
  } catch {
    /* ignore */
  }
  return '';
}

async function findCompanyByName(name) {
  const raw = String(name || '').trim();
  if (!raw) return { company: null, matches: [] };

  const exact = await query(
    `SELECT id, name, unp, status, balance, credit_limit, notify_threshold, low_balance_action,
            api_key, api_key_created_at
     FROM companies
     WHERE LOWER(TRIM(name)) = LOWER(TRIM(:name))
     LIMIT 5`,
    { name: raw },
  );
  if (exact.length === 1) return { company: exact[0], matches: exact };
  if (exact.length > 1) return { company: null, matches: exact };

  const needle = normalizeCompanyName(raw);
  if (!needle) return { company: null, matches: [] };

  const rows = await query(
    `SELECT id, name, unp, status, balance, credit_limit, notify_threshold, low_balance_action,
            api_key, api_key_created_at
     FROM companies
     WHERE status <> 'blocked'
     ORDER BY id ASC
     LIMIT 500`,
  );
  const matches = rows.filter((c) => {
    const n = normalizeCompanyName(c.name);
    return n === needle || n.includes(needle) || needle.includes(n);
  });

  // Prefer exact normalized equality over partial includes
  const exactNorm = matches.filter((c) => normalizeCompanyName(c.name) === needle);
  if (exactNorm.length === 1) return { company: exactNorm[0], matches: exactNorm };
  if (exactNorm.length > 1) return { company: null, matches: exactNorm };
  if (matches.length === 1) return { company: matches[0], matches };
  return { company: null, matches };
}

export async function salesrenderWebhookAuth(req, res, next) {
  try {
    const key = String(
      req.headers['x-api-key'] ||
        req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
        req.query.api_key ||
        '',
    ).trim();
    if (!key) {
      return res.status(401).json({ error: 'Требуется X-Api-Key' });
    }

    const srKey = String(process.env.SALESRENDER_API_KEY || config.salesrenderApiKey || '').trim();
    const payload = req.body || {};
    let company = null;
    let authMode = null;

    if (srKey && key === srKey) {
      authMode = 'salesrender';

      const companyName = extractCompanyName(payload);
      const companyApiKey = String(
        payload.companyApiKey || payload.company_api_key || '',
      ).trim();
      const companyId =
        payload.companyId != null
          ? Number(payload.companyId)
          : payload.company_id != null
            ? Number(payload.company_id)
            : null;

      if (companyName) {
        const found = await findCompanyByName(companyName);
        if (found.company) {
          company = found.company;
        } else if (found.matches.length > 1) {
          return res.status(409).json({
            error: `Найдено несколько компаний по названию «${companyName}»`,
            matches: found.matches.map((c) => ({ id: c.id, name: c.name, unp: c.unp })),
          });
        } else {
          return res.status(404).json({
            error: `Компания с названием «${companyName}» не найдена в E-Winners`,
          });
        }
      } else if (companyApiKey) {
        const rows = await query(
          `SELECT id, name, unp, status, balance, credit_limit, notify_threshold, low_balance_action,
                  api_key, api_key_created_at
           FROM companies WHERE api_key = :api_key LIMIT 1`,
          { api_key: companyApiKey },
        );
        company = rows[0] || null;
      } else if (companyId) {
        const rows = await query(
          `SELECT id, name, unp, status, balance, credit_limit, notify_threshold, low_balance_action,
                  api_key, api_key_created_at
           FROM companies WHERE id = :id LIMIT 1`,
          { id: companyId },
        );
        company = rows[0] || null;
      } else if (config.salesrenderCompanyId || process.env.SALESRENDER_COMPANY_ID) {
        const fallbackId =
          config.salesrenderCompanyId || Number(process.env.SALESRENDER_COMPANY_ID);
        const rows = await query(
          `SELECT id, name, unp, status, balance, credit_limit, notify_threshold, low_balance_action,
                  api_key, api_key_created_at
           FROM companies WHERE id = :id LIMIT 1`,
          { id: fallbackId },
        );
        company = rows[0] || null;
      } else {
        return res.status(400).json({
          error:
            'Укажите companyName (название организации) в теле webhook — по нему ищем компанию в E-Winners',
        });
      }
    } else {
      const rows = await query(
        `SELECT id, name, unp, status, balance, credit_limit, notify_threshold, low_balance_action,
                api_key, api_key_created_at
         FROM companies WHERE api_key = :api_key LIMIT 1`,
        { api_key: key },
      );
      company = rows[0] || null;
      authMode = 'company';
    }

    if (!company) {
      return res.status(401).json({ error: 'Неверный API key или компания не найдена' });
    }
    if (company.status === 'blocked') {
      return res.status(403).json({ error: 'Компания заблокирована' });
    }

    req.crmCompany = company;
    req.salesrenderAuthMode = authMode;
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Ошибка авторизации SalesRender' });
  }
}
