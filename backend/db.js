import mysql from 'mysql2/promise';
import './env.js';

// Create a connection pool. This is more efficient than creating a new connection for every query.
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rizkitechbill',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

export const getDatabaseConfig = () => ({ ...dbConfig });

let pool;
try {
  pool = mysql.createPool(dbConfig);
} catch (error) {
  // This will catch synchronous errors during pool creation, if any.
  console.error('[FATAL] Failed to create MySQL connection pool. This indicates a critical configuration error.');
  console.error('Please check your backend/.env file and ensure all DB_* variables are correct.');
  console.error('Original Error:', error);
  // Re-throw to ensure the bootstrap script catches it and exits.
  throw new Error(
    `Failed to create MySQL pool. Check DB config in .env. Original message: ${error.message}`
  );
}

const maskValue = (value) => {
  const text = String(value || '');
  if (!text) return '(unset)';
  if (text.length <= 4) return '****';
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
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

  console.log('[DB] Starting MySQL connection test...');
  console.log(`[DB] host=${summary.host}`);
  console.log(`[DB] port=${summary.port}`);
  console.log(`[DB] database=${summary.database}`);
  console.log(`[DB] user=${summary.user}`);

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query('SELECT 1');
    console.log(`[DB] MySQL connection OK (${Date.now() - startedAt}ms).`);
    return true;
  } catch (error) {
    console.error(`[DB] MySQL connection FAILED (${Date.now() - startedAt}ms).`);
    console.error(error?.stack || error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const createRestoreConnection = async () => {
  // Restore jobs are admin-only and may need multiple SQL statements per roundtrip.
  // A dedicated connection keeps the main pool safe while enabling faster imports.
  return mysql.createConnection({
    ...dbConfig,
    multipleStatements: true,
  });
};

// We removed the immediate connection test here to allow migrate.js to handle 
// database creation if the database doesn't exist yet.

export default pool;
