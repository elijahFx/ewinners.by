/**
 * Lookup company by UNP via open GRP MNS API (Госреестр плательщиков).
 * https://grp.nalog.gov.by
 */
export async function lookupByUnp(rawUnp) {
  const unp = String(rawUnp || '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(unp)) {
    const err = new Error('УНП должен состоять из 9 цифр');
    err.status = 400;
    throw err;
  }

  const url = `https://grp.nalog.gov.by/api/grp-public/data?unp=${unp}&charset=UTF-8&type=json`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.row) {
    const err = new Error(data?.message || 'Организация с таким УНП не найдена в реестре плательщиков');
    err.status = res.status === 400 ? 404 : 502;
    throw err;
  }

  const row = data.row;
  return {
    unp: row.vunp || unp,
    name: (row.vnaimp || row.vnaimk || '').trim(),
    shortName: (row.vnaimk || '').trim(),
    address: (row.vpadres || '').trim(),
    statusCode: row.ckodsost || null,
    status: row.vkods || null,
    registeredAt: row.dreg || null,
    taxOffice: row.vmns || null,
    source: 'grp.nalog.gov.by',
  };
}
