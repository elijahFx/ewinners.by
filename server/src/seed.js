import bcrypt from 'bcrypt';
import { pool, query } from './db.js';
import { migrate } from './migrate.js';

const ADMIN_EMAIL = 'eadmin';
const ADMIN_PASSWORD = 'tobeornottobe2077';

async function seed() {
  await migrate();

  const services = [
    ['call_minute', 'Минута разговора', 'мин'],
    ['confirmed_lead', 'Подтверждённая заявка', 'шт'],
    ['processed_lead', 'Обработанный лид', 'шт'],
    ['message', 'Отправленное сообщение', 'шт'],
    ['meeting', 'Назначенная встреча', 'шт'],
    ['subscription', 'Абонентская плата', 'мес'],
  ];

  for (const [code, name, unit] of services) {
    await query(
      `INSERT INTO services (code, name, unit)
       VALUES (:code, :name, :unit)
       ON DUPLICATE KEY UPDATE name = VALUES(name), unit = VALUES(unit)`,
      { code, name, unit },
    );
  }

  const existing = await query('SELECT id FROM users WHERE email = :email LIMIT 1', {
    email: ADMIN_EMAIL,
  });

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  if (!existing.length) {
    await query(
      `INSERT INTO users (email, password_hash, full_name, role, status)
       VALUES (:email, :password_hash, :full_name, 'admin', 'active')`,
      {
        email: ADMIN_EMAIL,
        password_hash: passwordHash,
        full_name: 'Администратор',
      },
    );
  } else {
    await query(
      `UPDATE users SET password_hash = :password_hash, role = 'admin', status = 'active', must_set_password = 0,
          full_name = 'Администратор'
       WHERE email = :email`,
      { email: ADMIN_EMAIL, password_hash: passwordHash },
    );
  }

  // Demo default tariffs (global)
  const serviceRows = await query('SELECT id, code FROM services');
  const byCode = Object.fromEntries(serviceRows.map((s) => [s.code, s.id]));
  const defaults = [
    ['call_minute', 1.8, 'minute'],
    ['confirmed_lead', 4.0, 'unit'],
    ['processed_lead', 1.2, 'unit'],
    ['message', 0.5, 'unit'],
    ['meeting', 8.0, 'unit'],
    ['subscription', 500.0, 'subscription'],
  ];

  for (const [code, price, billing_type] of defaults) {
    const serviceId = byCode[code];
    if (!serviceId) continue;
    const found = await query(
      `SELECT id FROM tariffs
       WHERE company_id IS NULL AND project_id IS NULL AND service_id = :service_id AND valid_to IS NULL
       LIMIT 1`,
      { service_id: serviceId },
    );
    if (!found.length) {
      await query(
        `INSERT INTO tariffs (company_id, project_id, service_id, price, billing_type, valid_from)
         VALUES (NULL, NULL, :service_id, :price, :billing_type, CURDATE())`,
        { service_id: serviceId, price, billing_type },
      );
    }
  }

  console.log('Seed OK');
  console.log('Admin login:', ADMIN_EMAIL);
  console.log('Admin password:', ADMIN_PASSWORD);
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
