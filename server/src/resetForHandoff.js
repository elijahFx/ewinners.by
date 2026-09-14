import bcrypt from 'bcrypt';
import { pool } from './db.js';

/**
 * Handoff reset: wipe all users/clients and create a single admin.
 * Login field is users.email → use "eadmin".
 *
 *   node src/resetForHandoff.js
 */
const ADMIN_LOGIN = 'eadmin';
const ADMIN_PASSWORD = 'tobeornottobe2077';
const ADMIN_NAME = 'Администратор';

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    const tables = [
      'login_challenges',
      'auth_tokens',
      'notifications',
      'user_companies',
      'transactions',
      'documents',
      'invoices',
      'bank_payments',
      'projects',
      'crm_event_log',
      'audit_log',
    ];
    for (const table of tables) {
      await conn.query(`DELETE FROM \`${table}\``);
    }

    await conn.query('DELETE FROM tariffs WHERE company_id IS NOT NULL');
    await conn.query('DELETE FROM companies');
    await conn.query('DELETE FROM users');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await conn.execute(
      `INSERT INTO users
        (email, password_hash, full_name, role, status, must_set_password, notify_email, notify_telegram)
       VALUES (?, ?, ?, 'admin', 'active', 0, 1, 0)`,
      [ADMIN_LOGIN, passwordHash, ADMIN_NAME],
    );

    await conn.commit();

    const [users] = await conn.query(
      'SELECT id, email, role, status, full_name FROM users ORDER BY id',
    );
    const [[{ companies }]] = await conn.query('SELECT COUNT(*) AS companies FROM companies');

    console.log('Handoff reset OK');
    console.log({ users, companies });
    console.log(`Admin login: ${ADMIN_LOGIN}`);
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
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
