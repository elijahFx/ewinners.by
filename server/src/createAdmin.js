import bcrypt from 'bcrypt';
import { pool, query } from './db.js';

/**
 * Create or update an admin account.
 *
 *   npm run create:admin -- <login> <password> [ФИО]
 *
 * Example:
 *   npm run create:admin -- pavel 12345678910 "Павел"
 *
 * Safe to re-run: an existing login gets its password and role reset and all
 * its sessions invalidated (token_version is bumped).
 */
const [, , loginArg, passwordArg, ...nameParts] = process.argv;

const LOGIN = String(loginArg || '').trim().toLowerCase();
const PASSWORD = String(passwordArg || '');
const FULL_NAME = nameParts.join(' ').trim() || 'Администратор';

if (!LOGIN || !PASSWORD) {
  console.error('Использование: npm run create:admin -- <login> <password> [ФИО]');
  process.exit(1);
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const existing = await query('SELECT id FROM users WHERE email = :email LIMIT 1', {
    email: LOGIN,
  });

  if (!existing.length) {
    await query(
      `INSERT INTO users
        (email, password_hash, full_name, role, status, must_set_password, notify_email, notify_telegram)
       VALUES
        (:email, :password_hash, :full_name, 'admin', 'active', 0, 1, 0)`,
      {
        email: LOGIN,
        password_hash: passwordHash,
        full_name: FULL_NAME,
      },
    );
    console.log(`Создан админ: ${LOGIN}`);
  } else {
    await query(
      `UPDATE users
       SET password_hash = :password_hash,
           full_name = :full_name,
           role = 'admin',
           status = 'active',
           must_set_password = 0,
           token_version = token_version + 1
       WHERE email = :email`,
      {
        email: LOGIN,
        password_hash: passwordHash,
        full_name: FULL_NAME,
      },
    );
    console.log(`Обновлён админ: ${LOGIN}`);
  }

  const rows = await query(
    `SELECT id, email, full_name, role, status FROM users WHERE email = :email LIMIT 1`,
    { email: LOGIN },
  );
  console.log('Запись в БД:', JSON.stringify(rows[0]));
  console.log(`Логин: ${LOGIN}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
