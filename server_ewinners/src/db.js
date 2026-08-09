import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

export const config = {
  port: Number(process.env.PORT || 5000),
  jwtSecret: process.env.JWT_SECRET || 'ewinners-dev-secret',
  crmApiKey: process.env.CRM_API_KEY || 'ewinners-crm-api-key',
  company: {
    name:
      process.env.COMPANY_NAME ||
      'Общество с ограниченной ответственностью «Е Винерс»',
    activity:
      process.env.COMPANY_ACTIVITY ||
      'Деятельность телефонных справочно-информационных служб',
    unp: process.env.COMPANY_UNP || '193834361',
    address:
      process.env.COMPANY_ADDRESS ||
      '220014, Московский район, г. Минск, ул. Попова, д. 24А, корпус 3, каб. 203',
    bank: process.env.COMPANY_BANK || '',
    iban: process.env.COMPANY_IBAN || '',
    bic: process.env.COMPANY_BIC || '',
    accountantPhone: process.env.COMPANY_ACCOUNTANT_PHONE || '+375 (25) 505-69-17',
  },
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    timezone: '+03:00',
  },
};

export const pool = mysql.createPool(config.db);

export async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
