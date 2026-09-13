/**
 * Priorbank corporate Open API client.
 * Credentials via env; when unset the banking UI stays read-only empty.
 *
 * PRIORBANK_API_BASE   — e.g. https://api.priorbank.by/...
 * PRIORBANK_CLIENT_ID
 * PRIORBANK_CLIENT_SECRET
 * PRIORBANK_ACCESS_TOKEN — optional static bearer (skips client-credentials)
 * PRIORBANK_ACCOUNT_IBAN — account to read
 * PRIORBANK_STATEMENT_PATH — override statement path template
 *   default: /accounts/{iban}/statement?dateFrom={from}&dateTo={to}
 */
const DEFAULT_STATEMENT_PATH =
  '/accounts/{iban}/statement?dateFrom={from}&dateTo={to}';

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

export function priorbankConfig() {
  const apiBase = env('PRIORBANK_API_BASE').replace(/\/$/, '');
  const clientId = env('PRIORBANK_CLIENT_ID');
  const clientSecret = env('PRIORBANK_CLIENT_SECRET');
  const accessToken = env('PRIORBANK_ACCESS_TOKEN');
  const accountIban = env('PRIORBANK_ACCOUNT_IBAN').replace(/\s+/g, '').toUpperCase();
  const statementPath = env('PRIORBANK_STATEMENT_PATH', DEFAULT_STATEMENT_PATH);
  const configured = Boolean(apiBase && accountIban && (accessToken || (clientId && clientSecret)));
  return {
    apiBase,
    clientId,
    clientSecret,
    accessToken,
    accountIban,
    statementPath,
    configured,
  };
}

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function obtainAccessToken(cfg) {
  if (cfg.accessToken) return cfg.accessToken;
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 30_000) {
    return cachedToken;
  }

  const tokenUrl = `${cfg.apiBase}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Priorbank OAuth HTTP ${res.status}`);
  }
  cachedToken = data.access_token;
  const ttlSec = Number(data.expires_in) || 3600;
  cachedTokenExpiresAt = Date.now() + ttlSec * 1000;
  return cachedToken;
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] != null && obj[key] !== '') return obj[key];
  }
  return null;
}

function toNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return value;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const s = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  return d.toISOString().slice(0, 10);
}

function detectDirection(raw, amount) {
  const explicit = String(
    pick(raw, ['direction', 'Direction', 'type', 'Type', 'creditDebitIndicator', 'CreditDebitIndicator']) || '',
  ).toLowerCase();
  if (['expense', 'debit', 'dbt', 'd', 'out', 'расход', 'списание'].includes(explicit)) {
    return 'expense';
  }
  if (['income', 'credit', 'cdt', 'c', 'in', 'доход', 'поступление'].includes(explicit)) {
    return 'income';
  }
  if (amount < 0) return 'expense';
  const debit = toNumber(pick(raw, ['debit', 'Debit', 'debitAmount', 'outcome', 'withdrawal']));
  const credit = toNumber(pick(raw, ['credit', 'Credit', 'creditAmount', 'income', 'deposit']));
  if (debit > 0 && credit <= 0) return 'expense';
  if (credit > 0 && debit <= 0) return 'income';
  return 'income';
}

export function normalizeMovement(raw, index = 0) {
  const credit = toNumber(pick(raw, ['credit', 'Credit', 'creditAmount', 'income', 'deposit']));
  const debit = toNumber(pick(raw, ['debit', 'Debit', 'debitAmount', 'outcome', 'withdrawal']));
  let amount = toNumber(pick(raw, ['amount', 'Amount', 'sum', 'Sum', 'transactionAmount']));
  if (!amount) amount = credit || debit;
  amount = Math.abs(amount);

  const direction = detectDirection(raw, toNumber(pick(raw, ['amount', 'Amount'])));
  const date =
    toDateOnly(pick(raw, [
      'operationDate',
      'OperationDate',
      'bookingDate',
      'BookingDate',
      'valueDate',
      'ValueDate',
      'date',
      'Date',
      'transactionDate',
    ])) || null;

  const id =
    pick(raw, ['id', 'Id', 'transactionId', 'TransactionId', 'docId', 'DocId', 'reference', 'Reference']) ||
    `pb-${date || 'na'}-${index}`;

  return {
    id: String(id),
    direction,
    amount,
    currency: String(pick(raw, ['currency', 'Currency', 'ccy']) || 'BYN'),
    date,
    counterparty: String(
      pick(raw, [
        'counterpartyName',
        'CounterpartyName',
        'payerName',
        'PayerName',
        'recipientName',
        'RecipientName',
        'name',
        'Name',
      ]) || '',
    ),
    unp: String(pick(raw, ['counterpartyUnp', 'Unp', 'UNP', 'payerUnp', 'taxId', 'inn']) || ''),
    purpose: String(pick(raw, ['purpose', 'Purpose', 'paymentPurpose', 'description', 'Description', 'narration']) || ''),
    reference: String(pick(raw, ['reference', 'Reference', 'docNumber', 'DocNumber', 'paymentNumber']) || ''),
    balanceAfter: (() => {
      const b = pick(raw, ['balanceAfter', 'BalanceAfter', 'balance', 'Balance', 'runningBalance']);
      return b == null ? null : toNumber(b);
    })(),
    raw,
  };
}

function extractMovements(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const nested = pick(payload, [
    'items',
    'transactions',
    'Transactions',
    'movements',
    'Movements',
    'operations',
    'Operations',
    'statementLines',
    'StatementLines',
    'data',
  ]);
  if (Array.isArray(nested)) return nested;
  if (nested && typeof nested === 'object') {
    const deeper = pick(nested, ['items', 'transactions', 'movements', 'operations']);
    if (Array.isArray(deeper)) return deeper;
  }
  return [];
}

function extractAccount(payload, fallbackIban) {
  const src = payload?.account || payload?.Account || payload || {};
  return {
    iban: String(pick(src, ['iban', 'IBAN', 'accountNumber', 'AccountNumber']) || fallbackIban || ''),
    currency: String(pick(src, ['currency', 'Currency', 'ccy']) || 'BYN'),
    balance: (() => {
      const b = pick(src, ['balance', 'Balance', 'availableBalance', 'AvailableBalance', 'currentBalance']);
      return b == null ? null : toNumber(b);
    })(),
    name: String(pick(src, ['name', 'Name', 'accountName', 'AccountName']) || 'Расчётный счёт'),
  };
}

export async function getPriorbankStatus() {
  const cfg = priorbankConfig();
  return {
    configured: cfg.configured,
    accountIban: cfg.accountIban || null,
    apiBase: cfg.apiBase || null,
    provider: 'priorbank',
  };
}

export async function fetchPriorbankStatement({ from, to } = {}) {
  const cfg = priorbankConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      provider: 'priorbank',
      account: {
        iban: cfg.accountIban || null,
        currency: 'BYN',
        balance: null,
        name: 'Расчётный счёт',
      },
      movements: [],
      fetchedAt: new Date().toISOString(),
      message: 'Priorbank API не настроен. Укажите PRIORBANK_API_BASE, PRIORBANK_ACCOUNT_IBAN и токен или client credentials.',
    };
  }

  const dateFrom = String(from || '').slice(0, 10);
  const dateTo = String(to || '').slice(0, 10);
  if (!dateFrom || !dateTo) {
    throw new Error('Укажите период from и to (YYYY-MM-DD)');
  }

  const token = await obtainAccessToken(cfg);
  const path = cfg.statementPath
    .replace('{iban}', encodeURIComponent(cfg.accountIban))
    .replace('{from}', encodeURIComponent(dateFrom))
    .replace('{to}', encodeURIComponent(dateTo));
  const url = path.startsWith('http') ? path : `${cfg.apiBase}${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = payload.message || payload.error || payload.error_description || `Priorbank HTTP ${res.status}`;
    throw new Error(msg);
  }

  const movements = extractMovements(payload).map((row, i) => normalizeMovement(row, i));
  return {
    configured: true,
    provider: 'priorbank',
    account: extractAccount(payload, cfg.accountIban),
    period: { from: dateFrom, to: dateTo },
    movements,
    fetchedAt: new Date().toISOString(),
    message: null,
  };
}

export function summarizeMovements(movements) {
  let income = 0;
  let expense = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  for (const m of movements) {
    if (m.direction === 'expense') {
      expense += Number(m.amount) || 0;
      expenseCount += 1;
    } else {
      income += Number(m.amount) || 0;
      incomeCount += 1;
    }
  }
  return {
    income,
    expense,
    net: income - expense,
    incomeCount,
    expenseCount,
  };
}
