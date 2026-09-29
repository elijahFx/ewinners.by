/**
 * MTBank Open API client (Type 1 — x-api-key via AvTunProxy).
 *
 * Guide: server/API_integration_guide.pdf
 * Base: https://openapi.mtbank.by  (through local AvTunProxy)
 *
 * Env:
 *   MTBANK_API_KEY          — required (token from SDBO Open API)
 *   MTBANK_PROXY            — default http://127.0.0.1:10224
 *   MTBANK_BASE_URL         — default https://openapi.mtbank.by
 *   MTBANK_PATH_PREFIX      — default /oapi-channel/open-banking/v1.0
 *   MTBANK_CONSENT_ID       — authorized accountConsentId (X-accountConsentId)
 *   MTBANK_ACCOUNT_ID       — account resource id (or IBAN if bank accepts it)
 *   MTBANK_ACCOUNT_IBAN     — optional; used to pick account / display
 *   MTBANK_INSECURE_TLS     — 1 to pass curl -k (AvTunProxy mitm)
 *   MTBANK_STATEMENT_MODE   — transactions|statements (default transactions)
 */
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

export function mtbankConfig() {
  const apiKey = env('MTBANK_API_KEY');
  const proxy = env('MTBANK_PROXY', 'http://127.0.0.1:10224');
  const baseUrl = env('MTBANK_BASE_URL', 'https://openapi.mtbank.by').replace(/\/$/, '');
  const pathPrefix = env('MTBANK_PATH_PREFIX', '/oapi-channel/open-banking/v1.0').replace(/\/$/, '');
  const consentId = env('MTBANK_CONSENT_ID');
  const accountId = env('MTBANK_ACCOUNT_ID');
  const accountIban = env('MTBANK_ACCOUNT_IBAN', env('COMPANY_IBAN')).replace(/\s+/g, '').toUpperCase();
  const insecureTls = env('MTBANK_INSECURE_TLS', '1') !== '0';
  const statementMode = env('MTBANK_STATEMENT_MODE', 'transactions').toLowerCase();
  const configured = Boolean(apiKey);
  const ready = Boolean(apiKey && consentId && (accountId || accountIban));
  return {
    apiKey,
    proxy,
    baseUrl,
    pathPrefix,
    consentId,
    accountId,
    accountIban,
    insecureTls,
    statementMode,
    configured,
    ready,
  };
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
  if (typeof value === 'object') {
    // MTBank wraps balances as { balanceAmount, creditDebitIndicator, currency, type }
    const inner = value.amount ?? value.Amount ?? value.balanceAmount ?? value.BalanceAmount;
    return inner == null ? 0 : toNumber(inner);
  }
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function toDateOnly(value) {
  if (!value) return null;
  const d = dayjs(value);
  if (d.isValid()) return d.format('YYYY-MM-DD');
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * HTTP via curl so AvTunProxy (-x) works the same way as in the bank guide.
 */
export function mtbankRequest({
  method = 'GET',
  path,
  body,
  headers = {},
  timeoutSec = 60,
} = {}) {
  const cfg = mtbankConfig();
  if (!cfg.apiKey) {
    return Promise.reject(new Error('MTBANK_API_KEY не задан в .env'));
  }

  const url = path.startsWith('http')
    ? path
    : `${cfg.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const args = ['-sS', '-X', method, '--max-time', String(timeoutSec)];
  if (cfg.insecureTls) args.push('-k');
  if (cfg.proxy) args.push('-x', cfg.proxy);

  const interactionId = randomUUID();
  const reqHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-key': cfg.apiKey,
    'x-fapi-interaction-id': interactionId,
    ...headers,
  };
  if (cfg.consentId && !reqHeaders['X-accountConsentId'] && !reqHeaders['x-accountConsentId']) {
    reqHeaders['X-accountConsentId'] = cfg.consentId;
  }
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    reqHeaders['x-idempotency-key'] = reqHeaders['x-idempotency-key'] || randomUUID();
  }

  for (const [k, v] of Object.entries(reqHeaders)) {
    if (v == null || v === '') continue;
    args.push('-H', `${k}: ${v}`);
  }

  if (body !== undefined && body !== null) {
    args.push('--data-binary', typeof body === 'string' ? body : JSON.stringify(body));
  }

  args.push('-w', '\n__HTTP_STATUS__:%{http_code}');
  args.push(url);

  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(new Error(`curl недоступен: ${err.message}`));
    });
    child.on('close', (code) => {
      const marker = '\n__HTTP_STATUS__:';
      const idx = stdout.lastIndexOf(marker);
      let status = 0;
      let raw = stdout;
      if (idx >= 0) {
        status = Number(stdout.slice(idx + marker.length).trim()) || 0;
        raw = stdout.slice(0, idx);
      }
      let payload = null;
      const trimmed = raw.trim();
      if (trimmed) {
        try {
          payload = JSON.parse(trimmed);
        } catch {
          payload = { raw: trimmed };
        }
      } else {
        payload = {};
      }
      if (code !== 0 && !status) {
        reject(new Error(stderr.trim() || `curl exit ${code}`));
        return;
      }
      resolve({ status, payload, interactionId, url });
    });
  });
}

function apiPath(suffix) {
  const cfg = mtbankConfig();
  const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${cfg.pathPrefix}${s}`;
}

function extractErrorMessage(payload, status) {
  if (!payload || typeof payload !== 'object') return `MTBank HTTP ${status}`;
  return (
    payload.message ||
    payload.error_description ||
    payload.error ||
    payload.Message ||
    payload?.Errors?.[0]?.Message ||
    payload?.errors?.[0]?.message ||
    payload?.data?.message ||
    `MTBank HTTP ${status}`
  );
}

export async function createAccountConsent({ expirationDateTime } = {}) {
  // MTBank validates this body against
  //   schemas/NBRB.RW.AISP.POST.accountConsents_SWAGGER.001.00.json
  // which is strict: lowercase `data`/`risk`, `risk` is required (and must be
  // an empty object) and additionalProperties is false. The previous payload
  // used `Data` + `ExpirationDateTime` and was rejected with
  // "Элемент сформирован некорректно".
  const exp =
    expirationDateTime ||
    dayjs().add(3, 'year').endOf('day').format('YYYY-MM-DD');
  const body = {
    data: {
      permissions: [
        'ReadAccountsBasic',
        'ReadAccountsDetail',
        'ReadBalances',
        'ReadTransactionsBasic',
        'ReadTransactionsCredits',
        'ReadTransactionsDebits',
        'ReadTransactionsDetail',
        'ReadStatementsBasic',
        'ReadStatementsDetail',
      ],
      expirationDate: exp,
    },
    risk: {},
  };
  const { status, payload } = await mtbankRequest({
    method: 'POST',
    path: apiPath('/accountConsents'),
    body,
  });
  if (status < 200 || status >= 300) {
    throw new Error(extractErrorMessage(payload, status));
  }
  const data = payload.Data || payload.data || payload;
  const consentId =
    pick(data, ['ConsentId', 'consentId', 'accountConsentId', 'AccountConsentId', 'id', 'Id']) ||
    null;
  return { consentId, status: pick(data, ['Status', 'status']), raw: payload };
}

export async function getAccountConsent(consentId = mtbankConfig().consentId) {
  if (!consentId) throw new Error('Не указан MTBANK_CONSENT_ID');
  const { status, payload } = await mtbankRequest({
    method: 'GET',
    path: apiPath(`/accountConsents/${encodeURIComponent(consentId)}`),
  });
  if (status < 200 || status >= 300) {
    throw new Error(extractErrorMessage(payload, status));
  }
  return payload;
}

function unwrapAccountList(payload) {
  const data = payload?.Data || payload?.data || payload || {};
  const accounts = data.Account || data.account || data.Accounts || data.accounts || data;
  if (Array.isArray(accounts)) return accounts;
  if (accounts && typeof accounts === 'object') return [accounts];
  return [];
}

function mapAccount(raw, fallbackIban) {
  const iban = String(
    pick(raw, ['IBAN', 'iban', 'identification', 'Identification', 'accountNumber', 'AccountNumber']) ||
      raw?.accountDetails?.identification ||
      raw?.Account?.[0]?.Identification ||
      fallbackIban ||
      '',
  )
    .replace(/\s+/g, '')
    .toUpperCase();
  const balanceSrc =
    pick(raw, ['Balance', 'balance', 'Balances', 'balances', 'availableBalance', 'AvailableBalance']) ||
    {};
  const balanceItem = Array.isArray(balanceSrc) ? balanceSrc[0] : balanceSrc;
  const amount =
    toNumber(
      pick(balanceItem, ['Amount', 'amount', 'available', 'Available', 'current', 'Current']) ||
        pick(raw, ['amount', 'Amount', 'balance', 'Balance']),
    ) || null;
  return {
    id: String(
      pick(raw, ['AccountId', 'accountId', 'id', 'Id', 'resourceId', 'ResourceId']) || iban || '',
    ),
    iban,
    currency: String(pick(raw, ['Currency', 'currency', 'ccy']) || balanceItem?.Currency || 'BYN'),
    balance: amount === 0 && balanceItem == null ? null : amount,
    name: String(
      pick(raw, [
        'Nickname',
        'nickname',
        'name',
        'Name',
        'accountName',
        'accountDescription',
        'AccountDescription',
      ]) || 'Расчётный счёт',
    ),
    raw,
  };
}

export async function listAccounts() {
  const cfg = mtbankConfig();
  const { status, payload } = await mtbankRequest({
    method: 'GET',
    path: apiPath('/accounts'),
  });
  if (status < 200 || status >= 300) {
    throw new Error(extractErrorMessage(payload, status));
  }
  return unwrapAccountList(payload).map((a) => mapAccount(a, cfg.accountIban));
}

export async function resolveAccountId() {
  const cfg = mtbankConfig();
  if (cfg.accountId) return cfg.accountId;
  const accounts = await listAccounts();
  if (!accounts.length) throw new Error('MTBank: счета не найдены. Проверьте согласие и авторизацию.');
  if (cfg.accountIban) {
    const match = accounts.find((a) => a.iban.replace(/\s/g, '') === cfg.accountIban);
    if (match) return match.id;
  }
  return accounts[0].id;
}

/**
 * Live account balance.
 * MTBank returns a list of balance types; the available balance (CLAV) is the
 * one worth showing, with a preference order as a fallback.
 */
const BALANCE_TYPE_PREFERENCE = [
  'CLAV', // available
  'ITAV', // interim available
  'CLBD', // closing booked
  'ITBD', // interim booked
  'OPAV', // opening available
  'PRCD', // previously closed booked
  'FWAV', // forward available
  'XPCD', // expected
];

export async function fetchAccountBalance(accountId) {
  const cfg = mtbankConfig();
  const id = accountId || cfg.accountId;
  if (!id) return null;

  const { status, payload } = await mtbankRequest({
    method: 'GET',
    path: apiPath(`/accounts/${encodeURIComponent(id)}/balances`),
  });
  if (status < 200 || status >= 300) {
    throw new Error(extractErrorMessage(payload, status));
  }

  const data = payload?.data || payload?.Data || payload || {};
  const raw = pick(data, ['balance', 'Balance', 'balances', 'Balances']);
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!list.length) return null;

  const typeOf = (b) => String(pick(b, ['type', 'Type']) || '').toUpperCase();
  const chosen =
    BALANCE_TYPE_PREFERENCE.map((t) => list.find((b) => typeOf(b) === t)).find(Boolean) ||
    list[0];

  return {
    amount: toNumber(pick(chosen, ['balanceAmount', 'BalanceAmount', 'amount', 'Amount'])),
    currency: String(pick(chosen, ['currency', 'Currency']) || 'BYN'),
    type: typeOf(chosen),
    dateTime: pick(chosen, ['dateTime', 'DateTime']) || null,
  };
}

function detectDirection(raw, amountSigned) {
  const explicit = String(
    pick(raw, [
      'creditDebitIndicator',
      'CreditDebitIndicator',
      'direction',
      'Direction',
      'type',
      'Type',
    ]) || '',
  ).toLowerCase();
  if (['debit', 'dbt', 'd', 'expense', 'out', 'расход', 'списание'].includes(explicit)) {
    return 'expense';
  }
  if (['credit', 'cdt', 'c', 'income', 'in', 'доход', 'поступление'].includes(explicit)) {
    return 'income';
  }
  if (amountSigned < 0) return 'expense';
  return 'income';
}

export function normalizeMtbankMovement(raw, index = 0) {
  const amountObj = pick(raw, ['Amount', 'amount', 'transactionAmount', 'TransactionAmount']);
  let amount = toNumber(amountObj);
  if (!amount) amount = toNumber(pick(raw, ['equivalentAmount', 'EquivalentAmount', 'sum', 'Sum']));
  amount = Math.abs(amount);

  const direction = detectDirection(raw, toNumber(amountObj?.amount ?? amountObj));
  const date =
    toDateOnly(
      pick(raw, [
        'bookingDateTime',
        'BookingDateTime',
        'valueDateTime',
        'ValueDateTime',
        'bookingDate',
        'BookingDate',
        'valueDate',
        'ValueDate',
        'date',
        'Date',
      ]),
    ) || null;

  const debtor = pick(raw, ['debtor', 'Debtor', 'DebtorAccount', 'debtorAccount']) || {};
  const creditor = pick(raw, ['creditor', 'Creditor', 'CreditorAccount', 'creditorAccount']) || {};
  const party = direction === 'income' ? debtor : creditor;

  const counterparty = String(
    pick(party, ['name', 'Name']) ||
      pick(raw, ['counterpartyName', 'CounterpartyName', 'payerName', 'PayerName', 'name', 'Name']) ||
      '',
  );

  const unp = String(
    pick(party, ['inn', 'Inn', 'unp', 'Unp', 'taxId', 'TaxId']) ||
      party?.organisationIdentification?.[0]?.identification ||
      party?.OrganisationIdentification?.[0]?.Identification ||
      pick(raw, ['unp', 'Unp', 'UNP', 'payerUnp']) ||
      '',
    // MTBank returns the payer's UNP prefixed, e.g. "INN193761799".
  )
    .replace(/^(?:INN|UNP|УНП)\s*/i, '')
    .trim();

  const purpose = String(
    pick(raw, [
      'transactionDetails',
      'TransactionDetails',
      'transactionInformation',
      'TransactionInformation',
      'remittanceInformation',
      'RemittanceInformation',
      'purpose',
      'Purpose',
      'description',
      'Description',
    ]) ||
      (Array.isArray(raw?.RemittanceInformation?.Unstructured)
        ? raw.RemittanceInformation.Unstructured.join(' ')
        : '') ||
      '',
  );

  const id =
    pick(raw, [
      'transactionId',
      'TransactionId',
      'id',
      'Id',
      'statementReference',
      'StatementReference',
      'reference',
      'Reference',
    ]) || `mtb-${date || 'na'}-${index}`;

  return {
    id: String(id),
    direction,
    amount,
    currency: String(
      pick(amountObj || {}, ['currency', 'Currency']) ||
        pick(raw, ['currency', 'Currency', 'ccy']) ||
        'BYN',
    ),
    date,
    counterparty,
    unp,
    purpose,
    reference: String(
      pick(raw, [
        'transactionReference',
        'TransactionReference',
        'reference',
        'Reference',
        'docNumber',
        'DocNumber',
      ]) || id,
    ),
    balanceAfter: (() => {
      const b = pick(raw, ['balance', 'Balance', 'balanceAfter', 'BalanceAfter']);
      if (b == null || b === '') return null;
      if (typeof b === 'object') {
        const inner = b.balanceAmount ?? b.BalanceAmount ?? b.amount ?? b.Amount;
        return inner == null ? null : toNumber(inner);
      }
      return toNumber(b);
    })(),
    raw,
  };
}

function extractTransactions(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const data = payload.Data || payload.data || payload;
  const nested = pick(data, [
    'Transaction',
    'transaction',
    'Transactions',
    'transactions',
    'Statement',
    'statement',
    'items',
  ]);
  if (Array.isArray(nested)) return nested;
  if (nested?.Transaction && Array.isArray(nested.Transaction)) return nested.Transaction;
  if (nested?.transactions && Array.isArray(nested.transactions)) return nested.transactions;
  if (Array.isArray(data)) return data;
  return [];
}

// The bank prepares a transaction list asynchronously and answers 202 until it
// is ready. A year of history is ~650 entries and takes ~20 s to build, so the
// previous 8-attempt budget ran out and callers silently received an empty list.
const LIST_READY_TIMEOUT_MS = 90_000;
const PAGE_SIZE = 25; // bank's maximumEntriesAllowedPerPage
const MAX_LIST_PAGES = 60; // 60 x 25 = 1500 entries, well past the bank's history

async function waitForTransactionList(accountId, listId) {
  const deadline = Date.now() + LIST_READY_TIMEOUT_MS;
  let delay = 1000;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const got = await mtbankRequest({
      method: 'GET',
      path: apiPath(
        `/accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(listId)}`,
      ),
    });
    // 202 and 404 both mean "still being prepared" — check before the 2xx test,
    // because 202 also falls inside the 2xx range.
    if (got.status === 202 || got.status === 404) {
      lastStatus = got.status;
      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.4), 5000);
      continue;
    }
    if (got.status >= 200 && got.status < 300) return got.payload;
    throw new Error(extractErrorMessage(got.payload, got.status));
  }

  throw new Error(
    `MTBank не подготовил перечень транзакций за ${Math.round(
      LIST_READY_TIMEOUT_MS / 1000,
    )} с (HTTP ${lastStatus})`,
  );
}

async function fetchViaTransactions(accountId, from, to) {
  // MTBank builds the list asynchronously:
  //   POST /accounts/{id}/transactions          -> { data: { transaction: { transactionListId } } }
  //   GET  /accounts/{id}/transactions/{listId} -> { data: { transaction: [...] }, meta: {...} }
  // The result is paginated (meta.totalPages / meta.totalEntries).
  const fromIso = dayjs(from).startOf('day').format('YYYY-MM-DDTHH:mm:ssZ');
  const toIso = dayjs(to).endOf('day').format('YYYY-MM-DDTHH:mm:ssZ');

  const create = await mtbankRequest({
    method: 'POST',
    path: apiPath(`/accounts/${encodeURIComponent(accountId)}/transactions`),
    body: {
      // Strict schema: schemas/NBRB.RW.AISP.POST.accountsAccountIdTransactions_SWAGGER.001.00.json
      data: {
        transaction: {
          fromBookingDateTime: fromIso,
          toBookingDateTime: toIso,
        },
      },
      risk: {},
    },
  });
  if (create.status < 200 || create.status >= 300) {
    throw new Error(extractErrorMessage(create.payload, create.status));
  }

  const created = create.payload?.data || create.payload?.Data || {};
  // The id is nested one level deeper than the other identifiers.
  const listId =
    pick(created.transaction || created.Transaction || {}, [
      'transactionListId',
      'TransactionListId',
    ]) || pick(created, ['transactionListId', 'TransactionListId']);

  if (!listId) {
    const inline = extractTransactions(create.payload);
    if (inline.length) return inline;
    throw new Error('MTBank: не получен transactionListId после создания перечня транзакций');
  }

  const first = await waitForTransactionList(accountId, listId);

  const meta = first?.meta || first?.Meta || {};
  const totalPages = Math.max(1, Number(pick(meta, ['totalPages', 'TotalPages']) || 1) || 1);
  const pages = Math.min(totalPages, MAX_LIST_PAGES);

  let all = extractTransactions(first);
  for (let page = 2; page <= pages; page += 1) {
    const got = await mtbankRequest({
      method: 'GET',
      path: apiPath(
        `/accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(
          listId,
        )}?page=${page}&size=${PAGE_SIZE}`,
      ),
    });
    // Keep whatever we already collected if a later page fails.
    if (got.status < 200 || got.status >= 300) break;
    all = all.concat(extractTransactions(got.payload));
  }

  if (totalPages > pages) {
    console.warn(
      `[mtbank] список транзакций усечён: ${pages} из ${totalPages} страниц (${from}..${to})`,
    );
  }
  return all;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchViaStatements(accountId, from, to) {
  // Per the spec the collection path is /statements/{accountId}; the old code
  // posted to /accounts/{accountId}/statements and the bank answered 404.
  const create = await mtbankRequest({
    method: 'POST',
    path: apiPath(`/statements/${encodeURIComponent(accountId)}`),
    body: {
      // Strict schema: schemas/NBRB.RW.AISP.POST.statements_SWAGGER.001.00.json
      data: {
        statement: {
          fromBookingDate: from,
          toBookingDate: to,
        },
      },
      risk: {},
    },
  });
  if (create.status < 200 || create.status >= 300) {
    throw new Error(extractErrorMessage(create.payload, create.status));
  }

  const data = create.payload?.data || create.payload?.Data || create.payload || {};
  // Mirror the transactions response: the id sits inside data.statement.
  const statementId =
    pick(data.statement || data.Statement || {}, ['statementId', 'StatementId']) ||
    pick(data, [
      'StatementId',
      'statementId',
      'id',
      'Id',
      'resourceId',
      'ResourceId',
    ]);
  if (!statementId) {
    const txs = extractTransactions(create.payload);
    if (txs.length) return txs;
    throw new Error('MTBank: не получен statementId после создания выписки');
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await sleep(800 * attempt);
    const got = await mtbankRequest({
      method: 'GET',
      path: apiPath(
        `/accounts/${encodeURIComponent(accountId)}/statements/${encodeURIComponent(statementId)}`,
      ),
    });
    if (got.status === 404 || got.status === 202) {
      lastErr = new Error(extractErrorMessage(got.payload, got.status));
      continue;
    }
    if (got.status < 200 || got.status >= 300) {
      throw new Error(extractErrorMessage(got.payload, got.status));
    }
    return extractTransactions(got.payload);
  }
  throw lastErr || new Error('MTBank: выписка не готова');
}

export async function getMtbankStatus() {
  const cfg = mtbankConfig();
  return {
    configured: cfg.configured,
    ready: cfg.ready,
    accountIban: cfg.accountIban || null,
    accountId: cfg.accountId || null,
    consentId: cfg.consentId || null,
    apiBase: cfg.baseUrl || null,
    proxy: cfg.proxy || null,
    provider: 'mtbank',
  };
}

// A long range takes the bank ~20 s to build plus one request per 25 entries,
// and the admin UI re-queries the same period on every search keystroke or tab
// change. A short cache makes those instant without delaying payment detection
// (the cron asks for its own short period).
const STATEMENT_TTL_MS = 60_000;
const statementCache = new Map();

function cacheGet(key) {
  const hit = statementCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > STATEMENT_TTL_MS) {
    statementCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (statementCache.size > 40) {
    const oldest = [...statementCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) statementCache.delete(oldest[0]);
  }
  statementCache.set(key, { at: Date.now(), value });
}

export async function fetchMtbankStatement({ from, to, refresh = false } = {}) {
  const cfg = mtbankConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      ready: false,
      provider: 'mtbank',
      account: {
        iban: cfg.accountIban || null,
        currency: 'BYN',
        balance: null,
        name: 'Расчётный счёт',
      },
      movements: [],
      fetchedAt: new Date().toISOString(),
      message:
        'MTBank API не настроен. Укажите MTBANK_API_KEY в .env и поднимите AvTunProxy (см. API_integration_guide.pdf).',
    };
  }

  const dateFrom = String(from || '').slice(0, 10);
  const dateTo = String(to || '').slice(0, 10);
  if (!dateFrom || !dateTo) {
    throw new Error('Укажите период from и to (YYYY-MM-DD)');
  }

  if (!cfg.consentId) {
    return {
      configured: true,
      ready: false,
      provider: 'mtbank',
      account: {
        iban: cfg.accountIban || null,
        currency: 'BYN',
        balance: null,
        name: 'Расчётный счёт',
      },
      movements: [],
      fetchedAt: new Date().toISOString(),
      message:
        'Создайте и авторизуйте согласие accountConsents в кабинете MTBank, затем укажите MTBANK_CONSENT_ID (и при необходимости MTBANK_ACCOUNT_ID).',
    };
  }

  const cacheKey = `${cfg.consentId}|${cfg.accountId || cfg.accountIban || ''}|${dateFrom}|${dateTo}`;
  if (!refresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const accountId = await resolveAccountId();
  let accountMeta = {
    id: accountId,
    iban: cfg.accountIban || null,
    currency: 'BYN',
    balance: null,
    name: 'Расчётный счёт MTBank',
  };

  // Accounts, balance and movements are independent calls — run them together
  // so the page pays for one round trip instead of three.
  const useStatements = cfg.statementMode === 'statements';
  const [accountsResult, balanceResult, txsResult] = await Promise.allSettled([
    listAccounts(),
    fetchAccountBalance(accountId),
    useStatements
      ? fetchViaStatements(accountId, dateFrom, dateTo)
      : fetchViaTransactions(accountId, dateFrom, dateTo),
  ]);

  if (accountsResult.status === 'fulfilled') {
    const accounts = accountsResult.value || [];
    const found = accounts.find((a) => a.id === accountId) || accounts[0];
    if (found) accountMeta = { ...accountMeta, ...found };
  }

  if (balanceResult.status === 'fulfilled' && balanceResult.value) {
    accountMeta.balance = balanceResult.value.amount;
    accountMeta.currency = balanceResult.value.currency || accountMeta.currency;
    accountMeta.balanceType = balanceResult.value.type || null;
    accountMeta.balanceAt = balanceResult.value.dateTime || null;
  } else if (balanceResult.status === 'rejected') {
    // A missing balance must not break the statement.
    console.warn(
      '[mtbank] balance unavailable:',
      balanceResult.reason?.message || balanceResult.reason,
    );
  }

  let rawTxs;
  if (txsResult.status === 'fulfilled') {
    rawTxs = txsResult.value;
  } else if (!useStatements) {
    // Fallback to the async statements flow used by some BY banks
    rawTxs = await fetchViaStatements(accountId, dateFrom, dateTo);
  } else {
    throw txsResult.reason;
  }

  const movements = rawTxs.map((row, i) => normalizeMtbankMovement(row, i));
  const result = {
    configured: true,
    ready: true,
    provider: 'mtbank',
    account: {
      iban: accountMeta.iban || cfg.accountIban || null,
      currency: accountMeta.currency || 'BYN',
      balance: accountMeta.balance ?? null,
      balanceType: accountMeta.balanceType || null,
      balanceAt: accountMeta.balanceAt || null,
      name: accountMeta.name || 'Расчётный счёт',
      id: accountMeta.id || accountId,
    },
    period: { from: dateFrom, to: dateTo },
    movements,
    fetchedAt: new Date().toISOString(),
    message: null,
  };

  cacheSet(cacheKey, result);
  return result;
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

/** Find EW-… invoice numbers mentioned in payment purpose. */
export function extractInvoiceNumbersFromPurpose(purpose) {
  const text = String(purpose || '');
  const found = new Set();
  const re = /\bEW-\d{6}-\d+-\d{4}\b/gi;
  let m;
  while ((m = re.exec(text))) {
    found.add(m[0].toUpperCase());
  }
  return [...found];
}

export function amountsMatch(a, b, tolerance = 0.01) {
  const parse = (v) => {
    if (typeof v === 'number') return v;
    return Number(String(v).replace(/\s/g, '').replace(',', '.'));
  };
  return Math.abs(parse(a) - parse(b)) <= tolerance;
}
