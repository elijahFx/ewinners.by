/**
 * Belarus IBAN → bank name + BIC (from NBRB directory).
 * BY IBAN (28 chars): BY + check(2) + bankCode(4) + account...
 */

// Fallback snapshot from NBRB API (head offices)
const BANKS_BY_CODE = {
  ABIG: { bic: 'ABIGBY25', name: "ОАО «НКФО «Белинкасгрупп»" },
  ABLT: { bic: 'ABLTBY22', name: "ЗАО «ОптиКурс» НКФО" },
  AEBK: { bic: 'AEBKBY2X', name: "ЗАО «Нео Банк Азия»" },
  AKBB: { bic: 'AKBBBY2X', name: "ОАО «АСБ Беларусбанк»" },
  ALFA: { bic: 'ALFABY2X', name: "ЗАО «Альфа-Банк»" },
  ATOM: { bic: 'ATOMBY25', name: "ЗАО «Дельта Банк»" },
  BAPB: { bic: 'BAPBBY2X', name: "ОАО «Белагропромбанк»" },
  BBTK: { bic: 'BBTKBY2X', name: "ЗАО «ТК Банк»" },
  BCSX: { bic: 'BCSXBY22', name: "ОАО «Белорусская валютно-фондовая биржа»" },
  BELB: { bic: 'BELBBY2X', name: "ОАО «Банк БелВЭБ»" },
  BITM: { bic: 'BITMBY25', name: "ЗАО «БИТ-БАНК»" },
  BLBB: { bic: 'BLBBBY2X', name: "ОАО «Белинвестбанк»" },
  BLNB: { bic: 'BLNBBY2X', name: "ОАО «БНБ-Банк»" },
  BPSB: { bic: 'BPSBBY2X', name: "ОАО «Сбер Банк»" },
  BRRB: { bic: 'BRRBBY2X', name: "ОАО «Банк развития Республики Беларусь»" },
  CASH: { bic: 'CASHBY25', name: "ЗАО «НКФО «ИНКАСС.ЭКСПЕРТ»" },
  EUBK: { bic: 'EUBKBY2X', name: "ЗАО «ЕВРОБАНК»" },
  GTBN: { bic: 'GTBNBY22', name: "ОАО «ФРАНСАБАНК»" },
  HNRB: { bic: 'HNRBBY2X', name: "ЗАО «Н.Е.Б. БАНК»" },
  IPBK: { bic: 'IPBKBY2X', name: "ЗАО «ИНТЕРПЭЙБАНК»" },
  IRJS: { bic: 'IRJSBY22', name: "ОАО «СтатусБанк»" },
  LOJS: { bic: 'LOJSBY22', name: "ОАО «НКФО «ХОУМ КРЕДИТ»" },
  MMBN: { bic: 'MMBNBY22', name: "ОАО «Банк Дабрабыт»" },
  MTBK: { bic: 'MTBKBY22', name: "ЗАО «МТБанк»" },
  NBRB: { bic: 'NBRBBY2X', name: "Национальный банк Республики Беларусь" },
  OLMP: { bic: 'OLMPBY2X', name: "ОАО «Белгазпромбанк»" },
  PJCB: { bic: 'PJCBBY2X', name: "ОАО «Приорбанк»" },
  POIS: { bic: 'POISBY2X', name: "ОАО «Паритетбанк»" },
  REDJ: { bic: 'REDJBY22', name: "ЗАО «Банк РРБ»" },
  RSHN: { bic: 'RSHNBY2X', name: "ЗАО «Банк «Решение»" },
  SLAN: { bic: 'SLANBY22', name: "ЗАО Банк ВТБ (Беларусь)" },
  SOMA: { bic: 'SOMABY22', name: "ЗАО «Идея Банк»" },
  SSIS: { bic: 'SSISBY25', name: "ОАО «НКФО «ЕРИП»" },
  TECN: { bic: 'TECNBY22', name: "ОАО «Технобанк»" },
  UNBS: { bic: 'UNBSBY2X', name: "ЗАО «БСБ Банк»" },
  ZEPT: { bic: 'ZEPTBY2X', name: "ЗАО «Цептер Банк»" },
};

let runtimeBanks = { ...BANKS_BY_CODE };
let lastFetchAt = 0;

function cleanName(name) {
  return String(name || '')
    .replace(/'/g, '«')
    .replace(/«([^«»]*)«/g, '«$1»')
    .replace(/'/g, '»')
    .trim();
}

export async function refreshBanksFromNbrb() {
  try {
    const res = await fetch('https://www.nbrb.by/api/bic', {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return runtimeBanks;
    const rows = await res.json();
    const next = { ...BANKS_BY_CODE };
    for (const row of rows || []) {
      const bic = String(row.CDHeadBank || row.CDBank || '')
        .trim()
        .toUpperCase();
      if (bic.length < 8) continue;
      const code = bic.slice(0, 4);
      const name = cleanName(row.NmBankShort || row.NmBank || '');
      if (!name) continue;
      // Prefer head office record
      if (!next[code] || row.CDBank === row.CDHeadBank) {
        next[code] = { bic: bic.slice(0, 8), name };
      }
    }
    runtimeBanks = next;
    lastFetchAt = Date.now();
    return runtimeBanks;
  } catch {
    return runtimeBanks;
  }
}

export async function ensureBanksFresh() {
  if (Date.now() - lastFetchAt > 12 * 60 * 60 * 1000) {
    await refreshBanksFromNbrb();
  }
  return runtimeBanks;
}

export function normalizeIban(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function lookupBankByIban(rawIban, banks = runtimeBanks) {
  const iban = normalizeIban(rawIban);
  if (!iban) {
    const err = new Error('Укажите номер счёта (IBAN)');
    err.status = 400;
    throw err;
  }

  if (!iban.startsWith('BY')) {
    const err = new Error('Поддерживаются только белорусские счета (IBAN, начинающийся с BY)');
    err.status = 400;
    throw err;
  }

  if (iban.length < 8) {
    return {
      iban,
      complete: false,
      bankCode: null,
      bankName: null,
      bic: null,
      message: 'Введите счёт полностью или хотя бы код банка',
    };
  }

  const bankCode = iban.slice(4, 8);
  const bank = banks[bankCode];

  if (!bank) {
    return {
      iban,
      complete: iban.length === 28,
      bankCode,
      bankName: null,
      bic: null,
      message: `Банк с кодом ${bankCode} не найден в справочнике НБРБ. Проверьте счёт или укажите БИК вручную.`,
      guessed: true,
    };
  }

  return {
    iban,
    complete: iban.length === 28,
    bankCode,
    bankName: bank.name,
    bic: bank.bic,
    message: null,
    guessed: false,
  };
}

export function listBanks() {
  return Object.entries(runtimeBanks).map(([code, bank]) => ({
    code,
    ...bank,
  }));
}
