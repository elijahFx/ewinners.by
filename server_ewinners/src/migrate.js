import { pool } from './db.js';

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
    balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0,
    min_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    notify_threshold DECIMAL(14,2) NOT NULL DEFAULT 500,
    low_balance_action ENUM('hard_stop','allow_credit','allow_debt') NOT NULL DEFAULT 'allow_credit',
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
    role ENUM('admin','accountant','manager','client') NOT NULL DEFAULT 'client',
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
    amount DECIMAL(14,2) NOT NULL,
    payer_name VARCHAR(255) NULL,
    payer_unp VARCHAR(32) NULL,
    reference VARCHAR(255) NULL,
    purpose TEXT NULL,
    invoice_id INT NULL,
    company_id INT NULL,
    status ENUM('unmatched','matched','credited','rejected') NOT NULL DEFAULT 'unmatched',
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
    status ENUM('processed','duplicate','error') NOT NULL,
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
  await ensureColumn('companies', 'api_key', 'VARCHAR(96) NULL UNIQUE AFTER manager_email');
  await ensureColumn('companies', 'api_key_created_at', 'DATETIME NULL AFTER api_key');
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
