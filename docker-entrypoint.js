import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import mysql from 'mysql2/promise';

const rootDir = process.cwd();
const migrateScript = path.join(rootDir, 'dist', 'backend', 'migrate.js');
const serverScript = path.join(rootDir, 'dist', 'backend', 'server.js');
const uploadDir = process.env.WA_SESSION_BASE_DIR || path.join(rootDir, 'whatsapp_sessions');
const instanceName = process.env.APP_INSTANCE_NAME || process.env.COMPOSE_PROJECT_NAME || 'default';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDatabase = async () => {
  const host = process.env.DB_HOST || 'mariadb';
  const port = Number(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'rizkitechbill';
  const timeoutMs = Number(process.env.DB_CONNECT_TIMEOUT_MS || 5000);
  const maxWaitMs = Number(process.env.DB_WAIT_TIMEOUT_MS || 180000);
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < maxWaitMs) {
    attempt += 1;
    try {
      const conn = await mysql.createConnection({
        host,
        port,
        user,
        password,
        database,
        connectTimeout: timeoutMs,
      });

      await conn.ping();
      await conn.end();
      console.log(`[Docker Entrypoint] Database ready after ${attempt} attempt(s).`);
      return;
    } catch (error) {
      console.log(`[Docker Entrypoint] Waiting for database (attempt ${attempt})... ${error.message}`);
      await sleep(3000);
    }
  }

  throw new Error('Database was not ready before timeout.');
};

const runNodeScript = (scriptPath) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [scriptPath], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`Script ${path.basename(scriptPath)} exited with code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}`));
  });
});

const startServer = () => {
  const child = spawn(process.execPath, [serverScript], {
    stdio: 'inherit',
    env: process.env,
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));

  child.on('exit', (code, signal) => {
    process.exitCode = code ?? 0;
    if (signal) {
      console.log(`[Docker Entrypoint] Server exited due to ${signal}.`);
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('[Docker Entrypoint] Failed to start server:', error);
    process.exit(1);
  });
};

const main = async () => {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`[Docker Entrypoint] instance=${instanceName}`);

  if (process.env.AUTO_MIGRATE_ON_START !== 'false') {
    await waitForDatabase();

    if (!fs.existsSync(migrateScript)) {
      throw new Error(`Migration script not found: ${migrateScript}`);
    }

    console.log('[Docker Entrypoint] Running first-time/ idempotent migration...');
    await runNodeScript(migrateScript);
    console.log('[Docker Entrypoint] Migration completed.');
  }

  if (!fs.existsSync(serverScript)) {
    throw new Error(`Server script not found: ${serverScript}`);
  }

  startServer();
};

main().catch((error) => {
  console.error('[Docker Entrypoint] Fatal startup error:', error);
  process.exit(1);
});
