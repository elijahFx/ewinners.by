import crypto from 'crypto';
import { query } from '../db.js';

export function generateCrmApiKey() {
  return `ew_${crypto.randomBytes(24).toString('hex')}`;
}

export async function setCompanyApiKey(companyId) {
  const apiKey = generateCrmApiKey();
  await query(
    `UPDATE companies
     SET api_key = :api_key, api_key_created_at = NOW()
     WHERE id = :id`,
    { id: companyId, api_key: apiKey },
  );
  return apiKey;
}

export function maskApiKey(key) {
  if (!key) return null;
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
