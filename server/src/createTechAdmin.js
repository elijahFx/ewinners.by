import bcrypt from 'bcrypt';
import { pool, query } from './db.js';

/**
 * Create or update technical admin account.
 *
 *   npm run create:techadmin
 */
const LOGIN = 'techadmin';
const PASSWORD = 'tobeornottobe2001';
const FULL_NAME = 'Технический администратор';

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
    console.log('Created techadmin');
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
    console.log('Updated techadmin');
  }

  console.log(`Login: ${LOGIN}`);
  console.log(`Password: ${PASSWORD}`);
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
