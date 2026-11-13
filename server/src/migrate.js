import { pool } from './db.js';
import { listAccounts } from './services/accounts.js';

const statements = [
  `CREATE TABLE IF NOT EXISTS companies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    unp VARCHAR(32) NULL,
    legal_address TEXT NULL,
    bank_name VARCHAR(255) NULL,
    iban VARCHAR(64) NULL,
    bic VARCHAR(32) NULL,
    status ENUM('active','suspended','blocked') NOT NULL DEFAULT 'active',
    direction ENUM('hr','digital','kc') NOT NULL DEFAULT 'kc',
    is_oneoff TINYINT(1) NOT NULL DEFAULT 0,
    balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0,
    min_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    notify_threshold DECIMAL(14,2) NOT NULL DEFAULT 500,
    low_balance_action ENUM('hard_stop','allow_credit','allow_debt') NOT NULL DEFAULT 'allow_credit',
    buyout_enabled TINYINT(1) NOT NULL DEFAULT 0,
    salesrender_id VARCHAR(64) NULL,
    last_digest_at DATETIME NULL,
    low_balance_notified_at DATETIME NULL,
    manager_name VARCHAR(255) NULL,
    manager_phone VARCHAR(64) NULL,
    manager_email VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(64) NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(512) NULL,
    role ENUM('admin','accountant','manager','client','hr') NOT NULL DEFAULT 'client',
    company_id INT NULL,
    status ENUM('active','blocked','invited') NOT NULL DEFAULT 'active',
    must_set_password TINYINT(1) NOT NULL DEFAULT 0,
    notify_email TINYINT(1) NOT NULL DEFAULT 1,
    notify_telegram TINYINT(1) NOT NULL DEFAULT 0,
    telegram_chat_id VARCHAR(64) NULL,
    token_version INT NOT NULL DEFAULT 0,
    last_login_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    status ENUM('active','paused','closed') NOT NULL DEFAULT 'active',
    description TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_projects_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(64) NOT NULL DEFAULT 'шт',
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS tariffs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NULL,
    project_id INT NULL,
    service_id INT NOT NULL,
    price DECIMAL(14,2) NOT NULL,
    billing_type ENUM('unit','minute','fixed','subscription') NOT NULL DEFAULT 'unit',
    valid_from DATE NOT NULL,
    valid_to DATE NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tariffs_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_tariffs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_tariffs_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    number VARCHAR(64) NOT NULL UNIQUE,
    company_id INT NOT NULL,
    project_id INT NULL,
    amount DECIMAL(14,2) NOT NULL,
    status ENUM('created','awaiting_payment','partially_paid','paid','overdue','cancelled','needs_review') NOT NULL DEFAULT 'awaiting_payment',
    purpose TEXT NOT NULL,
    file_path VARCHAR(512) NULL,
    paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME NULL,
    CONSTRAINT fk_invoices_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_invoices_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS bank_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    direction ENUM('income','expense') NOT NULL DEFAULT 'income',
    amount DECIMAL(14,2) NOT NULL,
    payer_name VARCHAR(255) NULL,
    payer_unp VARCHAR(32) NULL,
    reference VARCHAR(255) NULL,
    purpose TEXT NULL,
    invoice_id INT NULL,
    company_id INT NULL,
    status ENUM('unmatched','matched','credited','rejected') NOT NULL DEFAULT 'unmatched',
    operation_date DATE NULL,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_by INT NULL,
    confirmed_at DATETIME NULL,
    CONSTRAINT fk_bank_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    CONSTRAINT fk_bank_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    project_id INT NULL,
    invoice_id INT NULL,
    type ENUM('credit','debit') NOT NULL,
    category ENUM('bank_payment','manual_credit','refund','bonus','transfer','crm_action','subscription','manual_debit','extra_service','recalc') NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    balance_before DECIMAL(14,2) NOT NULL,
    balance_after DECIMAL(14,2) NOT NULL,
    service_id INT NULL,
    tariff_id INT NULL,
    quantity DECIMAL(14,3) NULL,
    unit_price DECIMAL(14,2) NULL,
    crm_event_id VARCHAR(128) NULL,
    employee_name VARCHAR(255) NULL,
    client_order_number VARCHAR(64) NULL,
    customer_name VARCHAR(255) NULL,
    customer_phone VARCHAR(64) NULL,
    cart_total DECIMAL(14,2) NULL,
    is_cross TINYINT(1) NOT NULL DEFAULT 0,
    is_upsell TINYINT(1) NOT NULL DEFAULT 0,
    comment TEXT NULL,
    status ENUM('posted','reversed') NOT NULL DEFAULT 'posted',
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_event (crm_event_id),
    CONSTRAINT fk_tx_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_tx_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    CONSTRAINT fk_tx_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    CONSTRAINT fk_tx_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
    CONSTRAINT fk_tx_tariff FOREIGN KEY (tariff_id) REFERENCES tariffs(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    type ENUM('invoice','act','contract','addendum','report','detail','other') NOT NULL,
    number VARCHAR(64) NULL,
    title VARCHAR(255) NOT NULL,
    amount DECIMAL(14,2) NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'published',
    period_from DATE NULL,
    period_to DATE NULL,
    project_id INT NULL,
    file_path VARCHAR(512) NULL,
    downloaded_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_docs_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS crm_event_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id VARCHAR(128) NULL,
    payload JSON NOT NULL,
    status ENUM('processed','duplicate','error','skipped') NOT NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(128) NOT NULL,
    entity_type VARCHAR(64) NULL,
    entity_id INT NULL,
    details JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS login_challenges (
    id VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_login_chal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    KEY idx_login_chal_user (user_id),
    KEY idx_login_chal_exp (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS auth_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('invite','password_reset') NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_auth_token_hash (token_hash),
    KEY idx_auth_tokens_user_type (user_id, type),
    CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS user_companies (
    user_id INT NOT NULL,
    company_id INT NOT NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, company_id),
    CONSTRAINT fk_uc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_uc_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS chat_conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    kind ENUM('client','staff') NOT NULL DEFAULT 'client',
    client_user_id INT NULL,
    staff_a_id INT NULL,
    staff_b_id INT NULL,
    last_message_at DATETIME NULL,
    last_message_preview VARCHAR(255) NULL,
    client_unread INT NOT NULL DEFAULT 0,
    staff_unread INT NOT NULL DEFAULT 0,
    a_unread INT NOT NULL DEFAULT 0,
    b_unread INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_chat_client (client_user_id),
    UNIQUE KEY uq_chat_staff_pair (staff_a_id, staff_b_id),
    KEY idx_chat_kind (kind),
    CONSTRAINT fk_chat_conv_client FOREIGN KEY (client_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_conv_staff_a FOREIGN KEY (staff_a_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_conv_staff_b FOREIGN KEY (staff_b_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    sender_id INT NOT NULL,
    body TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_chat_msg_conv (conversation_id, id),
    CONSTRAINT fk_chat_msg_conv FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS chat_attachments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id INT NOT NULL,
    file_path VARCHAR(512) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes INT NOT NULL DEFAULT 0,
    kind ENUM('image','video','file') NOT NULL DEFAULT 'file',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_chat_att_msg FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Финансовое состояние клиента и остановка его проектов в SalesRender.
  `CREATE TABLE IF NOT EXISTS company_financial_state (
    company_id INT NOT NULL PRIMARY KEY,
    blocked_by_balance TINYINT(1) NOT NULL DEFAULT 0,
    applied TINYINT(1) NOT NULL DEFAULT 0,
    dry_run TINYINT(1) NOT NULL DEFAULT 0,
    reason VARCHAR(32) NULL,
    available DECIMAL(14,2) NULL,
    pending_count INT NOT NULL DEFAULT 0,
    pending_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    blocked_at DATETIME NULL,
    unblocked_at DATETIME NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_cfs_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Какие проекты SalesRender мы архивировали сами.
  `CREATE TABLE IF NOT EXISTS salesrender_project_state (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    salesrender_project_id VARCHAR(64) NOT NULL,
    archived_by_us TINYINT(1) NOT NULL DEFAULT 0,
    archived_at DATETIME NULL,
    unarchived_at DATETIME NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sr_project (company_id, salesrender_project_id),
    CONSTRAINT fk_srps_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Пограничная зона: заказы, которые не удалось списать из-за лимита.
  `CREATE TABLE IF NOT EXISTS salesrender_pending_charges (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    project_id INT NULL,
    salesrender_project_id VARCHAR(64) NULL,
    order_id VARCHAR(64) NOT NULL,
    event_id VARCHAR(128) NOT NULL,
    kind ENUM('accepted','delivered') NOT NULL DEFAULT 'accepted',
    service_id INT NULL,
    tariff_id INT NULL,
    amount DECIMAL(14,2) NOT NULL,
    status ENUM('pending','charging','charged','canceled') NOT NULL DEFAULT 'pending',
    reason ENUM('insufficient_funds','overdraft_limit','manual') NOT NULL DEFAULT 'insufficient_funds',
    employee_name VARCHAR(255) NULL,
    comment VARCHAR(255) NULL,
    payload JSON NULL,
    details JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    charged_at DATETIME NULL,
    transaction_id INT NULL,
    canceled_at DATETIME NULL,
    canceled_by INT NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    UNIQUE KEY uq_pending_event (event_id),
    KEY idx_pending_company (company_id, status, created_at),
    CONSTRAINT fk_spc_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_spc_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    CONSTRAINT fk_spc_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
    CONSTRAINT fk_spc_tariff FOREIGN KEY (tariff_id) REFERENCES tariffs(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column],
  );
  if (Number(rows[0]?.c) === 0) {
    await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    return true;
  }
  return false;
}

/**
 * Первичное распределение клиентов по направлениям.
 *
 * У старых клиентов направления не было. Берём последний счёт с явно указанным
 * расчётным счётом: если он выставлен на счёт Digital — клиент Digital, и т.д.
 * Клиенты без таких счетов остаются в КЦ. Дальше направление меняется вручную
 * в карточке клиента.
 */
async function backfillCompanyDirections() {
  const byIban = new Map(listAccounts().map((account) => [account.iban, account.code]));
  const [rows] = await pool.query(
    `SELECT company_id, account_iban, id
       FROM invoices
      WHERE account_iban IS NOT NULL
      ORDER BY id ASC`,
  );

  // Считаем, в каком направлении у клиента больше выставленных счетов.
  // При равенстве берём направление самого свежего счёта.
  const byCompany = new Map();
  for (const row of rows) {
    const iban = String(row.account_iban || '').replace(/\s+/g, '').toUpperCase();
    const direction = byIban.get(iban);
    if (!direction) continue;
    let entry = byCompany.get(row.company_id);
    if (!entry) {
      entry = { counts: new Map(), lastDirection: null };
      byCompany.set(row.company_id, entry);
    }
    entry.counts.set(direction, (entry.counts.get(direction) || 0) + 1);
    entry.lastDirection = direction;
  }

  for (const [companyId, entry] of byCompany) {
    let best = null;
    let bestCount = -1;
    for (const [direction, count] of entry.counts) {
      if (count > bestCount) {
        best = direction;
        bestCount = count;
      }
    }
    const tied = [...entry.counts.entries()]
      .filter(([, count]) => count === bestCount)
      .map(([direction]) => direction);
    const direction = tied.includes(entry.lastDirection) ? entry.lastDirection : best;
    await pool.execute(
      `UPDATE companies SET direction = ? WHERE id = ? AND direction = 'kc'`,
      [direction, companyId],
    );
  }
}

export async function migrate() {
  for (const sql of statements) {
    await pool.execute(sql);
  }
  await ensureColumn('users', 'avatar_url', 'VARCHAR(512) NULL AFTER full_name');
  await ensureColumn('users', 'notify_email', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER must_set_password');
  await ensureColumn('users', 'notify_telegram', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER notify_email');
  await ensureColumn('users', 'telegram_chat_id', 'VARCHAR(64) NULL AFTER notify_telegram');
  // Направление клиента: HR, Digital или КЦ. Именно по нему рабочие места
  // показывают «своих» клиентов и счета.
  const directionAdded = await ensureColumn(
    'companies',
    'direction',
    "ENUM('hr','digital','kc') NOT NULL DEFAULT 'kc' AFTER status",
  );
  if (directionAdded) await backfillCompanyDirections();

  // Флаги автоматической остановки: чтобы не перепутать с ручной блокировкой
  // и снимать приостановку только с того, что приостановили мы.
  await ensureColumn(
    'companies',
    'is_oneoff',
    'TINYINT(1) NOT NULL DEFAULT 0 AFTER direction',
  );
  await ensureColumn(
    'companies',
    'suspended_by_balance',
    'TINYINT(1) NOT NULL DEFAULT 0 AFTER direction',
  );
  await ensureColumn(
    'projects',
    'paused_by_balance',
    'TINYINT(1) NOT NULL DEFAULT 0 AFTER status',
  );

  await ensureColumn('companies', 'api_key', 'VARCHAR(96) NULL UNIQUE AFTER manager_email');
  await ensureColumn('companies', 'api_key_created_at', 'DATETIME NULL AFTER api_key');
  // Отдел выкупа: клиенту дополнительно списывается 1,50 BYN за выкупленный заказ.
  await ensureColumn(
    'companies',
    'buyout_enabled',
    'TINYINT(1) NOT NULL DEFAULT 0 AFTER api_key_created_at',
  );
  // ID клиента в SalesRender: по нему webhook находит компанию (приоритетнее названия).
  await ensureColumn('companies', 'salesrender_id', 'VARCHAR(64) NULL AFTER buyout_enabled');
  // Уведомления о балансе: дневная сводка вместо письма на каждое списание,
  // плюс отметка о последнем предупреждении при пересечении порога.
  await ensureColumn('companies', 'last_digest_at', 'DATETIME NULL AFTER salesrender_id');
  await ensureColumn('companies', 'low_balance_notified_at', 'DATETIME NULL AFTER last_digest_at');

  // Детали заказа SalesRender для детализации и выгрузки в Excel.
  await ensureColumn('transactions', 'client_order_number', 'VARCHAR(64) NULL');
  await ensureColumn('transactions', 'customer_name', 'VARCHAR(255) NULL');
  await ensureColumn('transactions', 'customer_phone', 'VARCHAR(64) NULL');
  await ensureColumn('transactions', 'cart_total', 'DECIMAL(14,2) NULL');
  await ensureColumn('transactions', 'is_cross', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('transactions', 'is_upsell', 'TINYINT(1) NOT NULL DEFAULT 0');

  // Расчётный счёт, на который выставлен счёт
  await pool.execute('ALTER TABLE invoices ADD COLUMN account_iban VARCHAR(64) NULL').catch(() => {});

  // Один месячный акт на клиента: ACT-ГГГГММ-<id>. Уникальный ключ защищает
  // от дублей, если планировщик и ручной запуск совпадут по времени.
  try {
    await pool.execute(
      'ALTER TABLE documents ADD UNIQUE KEY uq_documents_company_type_number (company_id, type, number)',
    );
  } catch {
    /* индекс уже есть */
  }

  // Новая роль HR: сотрудник направления, видит только свою страницу
  await pool.execute(
    "ALTER TABLE users MODIFY role ENUM('admin','accountant','manager','client','hr') NOT NULL DEFAULT 'client'",
  );

  // У одного клиента может быть несколько проектов в SalesRender, а баланс —
  // один. Основной ID лежит в companies.salesrender_id, дополнительные здесь.
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS company_salesrender_projects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      salesrender_id VARCHAR(64) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_csp_sr (salesrender_id),
      CONSTRAINT fk_csp_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  // Почтовый клиент: письма, вложения и служебное состояние
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS mail_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_id VARCHAR(255) NULL,
      mailbox VARCHAR(64) NOT NULL DEFAULT 'INBOX',
      direction ENUM('incoming','outgoing') NOT NULL DEFAULT 'incoming',
      subject VARCHAR(500) NULL,
      from_address VARCHAR(255) NULL,
      from_name VARCHAR(255) NULL,
      to_address TEXT NULL,
      cc_address TEXT NULL,
      sent_at DATETIME NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      has_attachments TINYINT(1) NOT NULL DEFAULT 0,
      snippet TEXT NULL,
      body_text MEDIUMTEXT NULL,
      body_html MEDIUMTEXT NULL,
      imap_uid INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_mail_uid (mailbox, imap_uid),
      KEY idx_mail_sent (sent_at),
      KEY idx_mail_dir (direction)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS mail_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_id INT NOT NULL,
      filename VARCHAR(255) NULL,
      content_type VARCHAR(128) NULL,
      size INT NOT NULL DEFAULT 0,
      content LONGBLOB NULL,
      KEY idx_att_message (message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS mail_sync_state (
      key_name VARCHAR(64) PRIMARY KEY,
      value VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  try {
    await pool.execute(
      'ALTER TABLE companies ADD UNIQUE KEY uq_companies_salesrender_id (salesrender_id)',
    );
  } catch {
    /* индекс уже есть */
  }
  await ensureColumn(
    'companies',
    'entity_type',
    "ENUM('ooo','ip','other') NOT NULL DEFAULT 'ooo' AFTER name",
  );
  await ensureColumn(
    'bank_payments',
    'direction',
    "ENUM('income','expense') NOT NULL DEFAULT 'income' AFTER id",
  );
  await ensureColumn(
    'bank_payments',
    'operation_date',
    'DATE NULL AFTER status',
  );
  await ensureColumn(
    'bank_payments',
    'external_id',
    'VARCHAR(128) NULL AFTER reference',
  );
  await ensureColumn(
    'bank_payments',
    'provider',
    "VARCHAR(32) NULL DEFAULT 'manual' AFTER external_id",
  );
  try {
    await pool.execute(
      `ALTER TABLE bank_payments ADD UNIQUE KEY uq_bank_payments_external (provider, external_id)`,
    );
  } catch {
    /* index exists */
  }
  await pool.execute(
    `UPDATE bank_payments
     SET operation_date = DATE(imported_at)
     WHERE operation_date IS NULL`,
  );

  // Allow skipped/processed statuses in crm_event_log
  try {
    await pool.execute(
      `ALTER TABLE crm_event_log
       MODIFY COLUMN status ENUM('processed','duplicate','error','skipped') NOT NULL`,
    );
  } catch {
    /* already updated or table missing */
  }

  // Chat schema upgrades (existing installs)
  await ensureColumn(
    'chat_conversations',
    'kind',
    "ENUM('client','staff') NOT NULL DEFAULT 'client' AFTER id",
  );
  await ensureColumn('chat_conversations', 'staff_a_id', 'INT NULL AFTER client_user_id');
  await ensureColumn('chat_conversations', 'staff_b_id', 'INT NULL AFTER staff_a_id');
  await ensureColumn('chat_conversations', 'a_unread', 'INT NOT NULL DEFAULT 0 AFTER staff_unread');
  await ensureColumn('chat_conversations', 'b_unread', 'INT NOT NULL DEFAULT 0 AFTER a_unread');

  // Allow NULL client_user_id for staff DMs
  try {
    await pool.execute(
      `ALTER TABLE chat_conversations MODIFY COLUMN client_user_id INT NULL`,
    );
  } catch {
    /* already nullable or table missing */
  }

  try {
    await pool.execute(
      `ALTER TABLE chat_conversations
       ADD UNIQUE KEY uq_chat_staff_pair (staff_a_id, staff_b_id)`,
    );
  } catch {
    /* index exists */
  }

  try {
    await pool.execute(
      `ALTER TABLE chat_conversations
       ADD CONSTRAINT fk_chat_conv_staff_a FOREIGN KEY (staff_a_id) REFERENCES users(id) ON DELETE CASCADE`,
    );
  } catch {
    /* exists */
  }
  try {
    await pool.execute(
      `ALTER TABLE chat_conversations
       ADD CONSTRAINT fk_chat_conv_staff_b FOREIGN KEY (staff_b_id) REFERENCES users(id) ON DELETE CASCADE`,
    );
  } catch {
    /* exists */
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.js')) {
  migrate()
    .then(() => {
      console.log('Migration OK');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
