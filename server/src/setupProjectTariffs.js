import { pool, query } from './db.js';

/**
 * Заводит тарифы SalesRender на уровне проекта.
 *
 *   npm run tariffs:project -- "Товарка"
 *
 * Цены:
 *   sr_order_base       3.00 BYN — принятый заказ без апс/кросс
 *   sr_order_upsell     5.00 BYN — принятый заказ с апс/кросс
 *   sr_order_delivered  1.50 BYN — выкупленный заказ (списывается дополнительно,
 *                                если у клиента включён отдел выкупа)
 *
 * Глобальные тарифы на эти услуги удаляются, чтобы в списке не было дублей.
 * Скрипт идемпотентный: повторный запуск обновляет цены.
 */
const projectName = process.argv.slice(2).join(' ').trim();

const PRICES = [
  ['sr_order_base', 3.0],
  ['sr_order_upsell', 5.0],
  ['sr_order_delivered', 1.5],
];

if (!projectName) {
  console.error('Использование: npm run tariffs:project -- "Название проекта"');
  process.exit(1);
}

async function main() {
  const projects = await query(
    'SELECT id, name, company_id FROM projects WHERE name = :name LIMIT 1',
    { name: projectName },
  );
  const project = projects[0];
  if (!project) {
    const all = await query('SELECT id, name FROM projects ORDER BY id');
    console.error(`Проект «${projectName}» не найден. Есть: ${all.map((p) => p.name).join(', ') || '—'}`);
    process.exit(1);
  }
  console.log(`Проект: ${project.name} (id=${project.id}, company_id=${project.company_id})\n`);

  for (const [code, price] of PRICES) {
    const svc = await query('SELECT id, name FROM services WHERE code = :code LIMIT 1', { code });
    if (!svc[0]) {
      console.warn(`! услуга ${code} не найдена — пропуск (выполните npm run seed)`);
      continue;
    }
    const serviceId = svc[0].id;

    const existing = await query(
      `SELECT id FROM tariffs
       WHERE company_id IS NULL AND project_id = :project_id
         AND service_id = :service_id AND valid_to IS NULL
       LIMIT 1`,
      { project_id: project.id, service_id: serviceId },
    );

    if (existing.length) {
      await query(`UPDATE tariffs SET price = :price, billing_type = 'unit' WHERE id = :id`, {
        price,
        id: existing[0].id,
      });
      console.log(`обновлён: ${svc[0].name} → ${price.toFixed(2)} BYN`);
    } else {
      await query(
        `INSERT INTO tariffs (company_id, project_id, service_id, price, billing_type, valid_from)
         VALUES (NULL, :project_id, :service_id, :price, 'unit', CURDATE())`,
        { project_id: project.id, service_id: serviceId, price },
      );
      console.log(`создан:   ${svc[0].name} → ${price.toFixed(2)} BYN`);
    }

    const del = await query(
      `DELETE FROM tariffs
       WHERE company_id IS NULL AND project_id IS NULL
         AND service_id = :service_id AND valid_to IS NULL`,
      { service_id: serviceId },
    );
    if (del.affectedRows) {
      console.log(`          удалён глобальный тариф (${del.affectedRows} шт.)`);
    }
  }

  const all = await query(
    `SELECT t.id, s.code, s.name, t.price, t.company_id, t.project_id
     FROM tariffs t
     JOIN services s ON s.id = t.service_id
     WHERE s.code IN ('sr_order_base', 'sr_order_upsell', 'sr_order_delivered')
     ORDER BY s.code, t.company_id, t.project_id`,
  );
  console.log('\nТарифы SalesRender сейчас:');
  for (const r of all) {
    const scope = r.company_id
      ? `клиент #${r.company_id}`
      : r.project_id
        ? `проект #${r.project_id}`
        : 'общий';
    console.log(`  ${r.code.padEnd(20)} ${Number(r.price).toFixed(2)} BYN   ${scope}`);
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err.message || err);
    await pool.end();
    process.exit(1);
  });
