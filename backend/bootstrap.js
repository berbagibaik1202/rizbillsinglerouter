import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.join(__dirname, 'logs');
const logFile = path.join(logDir, 'startup.log');

fs.mkdirSync(logDir, { recursive: true });

const appendLog = (level, message) => {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  fs.appendFileSync(logFile, line, 'utf8');
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

const startedAt = Date.now();
const elapsed = () => `${Date.now() - startedAt}ms`;
const instanceName = process.env.APP_INSTANCE_NAME || process.env.COMPOSE_PROJECT_NAME || 'default';

console.log(`[Bootstrap] Starting backend bootstrap at ${new Date().toISOString()}`);
console.log(`[Bootstrap] instance: ${instanceName}`);
console.log(`[Bootstrap] cwd: ${process.cwd()}`);
console.log('[Bootstrap] Loading backend/server.js...');

try {
  await import('./preload-env.js');
  await import('./server.js');
  console.log(`[Bootstrap] backend/server.js loaded in ${elapsed()}.`);
} catch (error) {
  const errorMessage = `[Bootstrap] Failed to start backend after ${elapsed()}:\n${error?.stack || error}\n`;
  fs.appendFileSync(logFile, errorMessage, 'utf8');
  if (error?.cause) {
    const causeMessage = `[Bootstrap] Root cause:\n${error.cause?.stack || error.cause}\n`;
    fs.appendFileSync(logFile, causeMessage, 'utf8');
  }
  process.exit(1);
}
