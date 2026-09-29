/**
 * One-shot: create MTBank accountConsent and print ConsentId to put into .env
 *
 *   node scripts/createMtbankConsent.js
 *
 * Then in MTBank cabinet → Open API → authorize consent (accounts + SMS).
 */
import { createAccountConsent, mtbankConfig } from '../src/services/mtbank.js';

async function main() {
  const cfg = mtbankConfig();
  if (!cfg.apiKey) {
    console.error('MTBANK_API_KEY is empty in server/.env');
    process.exit(1);
  }
  console.log('Proxy:', cfg.proxy);
  console.log('Base:', cfg.baseUrl + cfg.pathPrefix);
  const result = await createAccountConsent();
  console.log(JSON.stringify(result, null, 2));
  if (result.consentId) {
    console.log('\nAdd to .env:\nMTBANK_CONSENT_ID=' + result.consentId);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
