/**
 * Расчётные счета компании по направлениям.
 *
 * У каждого направления свой счёт — он попадает в счёт на оплату и в акт,
 * чтобы клиент платил именно туда. Значения можно переопределить в окружении.
 */
const ACCOUNTS = [
  {
    code: 'kc',
    label: 'КЦ',
    iban: String(process.env.ACCOUNT_IBAN_KC || 'BY84MTBK30120001093300130382').replace(/\s+/g, ''),
  },
  {
    code: 'hr',
    label: 'HR',
    iban: String(process.env.ACCOUNT_IBAN_HR || 'BY57MTBK30120001093300130383').replace(/\s+/g, ''),
  },
  {
    code: 'digital',
    label: 'Digital',
    iban: String(process.env.ACCOUNT_IBAN_DIGITAL || 'BY30MTBK30120001093300130384').replace(/\s+/g, ''),
  },
];

const BANK = String(process.env.COMPANY_BANK || 'МТБанк');
const BIC = String(process.env.COMPANY_BIC || 'MTBKBY22');

export function listAccounts() {
  return ACCOUNTS.map((a) => ({
    ...a,
    // Читаемый вид: BY30 MTBK 3012 0001 0933 0013 0384
    formatted: a.iban.replace(/(.{4})/g, '$1 ').trim(),
    bank: BANK,
    bic: BIC,
  }));
}

/** Счёт направления. Если код неизвестен — счёт КЦ (основной). */
export function accountForDirection(direction) {
  const code = String(direction || '').toLowerCase();
  return listAccounts().find((a) => a.code === code) || listAccounts()[0];
}

/** Счёт по IBAN — нужен при выборе вручную. */
export function accountByIban(iban) {
  const clean = String(iban || '').replace(/\s+/g, '').toUpperCase();
  return listAccounts().find((a) => a.iban === clean) || null;
}
