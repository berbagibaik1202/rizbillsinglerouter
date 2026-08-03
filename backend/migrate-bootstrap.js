import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const startedAt = Date.now();
const instanceName = process.env.APP_INSTANCE_NAME || process.env.COMPOSE_PROJECT_NAME || 'default';
const logDir = path.join(__dirname, 'logs');
const logFile = path.join(logDir, 'migrate.log');

fs.mkdirSync(logDir, { recursive: true });

const appendLog = (level, message) => {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  fs.appendFileSync(logFile, line, 'utf8');
};

const mask = (value) => {
  const text = String(value || '');
  if (!text) return '(unset)';
  if (text.length <= 4) return '****';
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
};

const log = (message) => {
  appendLog('INFO', message);
  console.log(`[Migrate Bootstrap] ${message}`);
};

const logError = (message, error) => {
  appendLog('ERROR', message);
  console.error(`[Migrate Bootstrap] ${message}`);
  if (error) {
    appendLog('ERROR', error?.stack || String(error));
    console.error(error?.stack || error);
  }
};

const originalConsoleLog = console.log.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);

console.log = (...args) => {
  appendLog('INFO', args.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' '));
  originalConsoleLog(...args);
};

console.warn = (...args) => {
  appendLog('WARN', args.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' '));
  originalConsoleWarn(...args);
};

console.error = (...args) => {
  appendLog('ERROR', args.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' '));
  originalConsoleError(...args);
};

process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection during migration bootstrap:', reason);
});

process.on('uncaughtException', (error) => {
  logError('Uncaught exception during migration bootstrap:', error);
  process.exitCode = 1;
});

process.on('exit', (code) => {
  log(`Process exit code: ${code} after ${Date.now() - startedAt}ms`);
});

log(`Starting migration bootstrap at ${new Date().toISOString()}`);
log(`instance: ${instanceName}`);
log(`cwd: ${process.cwd()}`);
log(`module file: ${__filename}`);
log(`backend dir: ${__dirname}`);
log(`env file: ${path.join(__dirname, '.env')}`);
log(`env file exists: ${fs.existsSync(path.join(__dirname, '.env')) ? 'yes' : 'no'}`);
log(`NODE_ENV=${process.env.NODE_ENV || '(unset)'}`);
log(`DB_HOST=${process.env.DB_HOST || '(unset)'}`);
log(`DB_PORT=${process.env.DB_PORT || '(unset)'}`);
log(`DB_NAME=${process.env.DB_NAME || '(unset)'}`);
log(`DB_USER=${process.env.DB_USER ? mask(process.env.DB_USER) : '(unset)'}`);
log(`DB_PASSWORD=${process.env.DB_PASSWORD ? 'set' : '(unset)'}`);

try {
  await import('./preload-env.js');
  const { migrateDatabase } = await import('./migrate.js');
  await migrateDatabase();
  log(`migrate.js finished loading in ${Date.now() - startedAt}ms`);
} catch (error) {
  logError('Failed to load migrate.js:', error);
  if (error?.cause) {
    logError('Root cause:', error.cause);
  }
  process.exitCode = 1;
}
