import mysql from 'mysql2/promise';
import './env.js';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rizkitechbill',
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(dbConfig);

export const getDatabaseConfig = () => ({ ...dbConfig });

const maskValue = (value) => {
  const text = String(value || '');
  if (!text) return '(empty)';
  if (text.length <= 6) return '***';
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
};

export const getDatabaseConfigSummary = () => ({
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: maskValue(dbConfig.user),
});

export const testDatabaseConnection = async () => {
  const startedAt = Date.now();
  const summary = getDatabaseConfigSummary();
  let connection;

  console.log('[DB] Testing MySQL connection...');
  console.log(`[DB] host=${summary.host}`);
  console.log(`[DB] port=${summary.port}`);
  console.log(`[DB] database=${summary.database}`);
  console.log(`[DB] user=${summary.user}`);

  try {
    connection = await pool.getConnection();
    await connection.query('SELECT 1');
    console.log(`[DB] Connection test succeeded in ${Date.now() - startedAt}ms`);
    return true;
  } catch (error) {
    console.error(`[DB] Connection test FAILED (${Date.now() - startedAt}ms)`);
    console.error(error?.stack || error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const createRestoreConnection = async () => {
  return mysql.createConnection({
    ...dbConfig,
    multipleStatements: true,
  });
};

export default pool;
