import fs from 'fs';
import { envPath, envState } from './env.js';

if (!globalThis.__rizkiTechbillEnvBootstrapped) {
  globalThis.__rizkiTechbillEnvBootstrapped = true;

  const mask = (value) => {
    const text = String(value || '');
    if (!text) return '(empty)';
    if (text.length <= 4) return '****';
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
  };

  console.log('[Bootstrap] Environment loaded.');
  console.log(`[Bootstrap] env loaded from file: ${envState.loaded ? 'yes' : 'no'}`);
  console.log(`[Bootstrap] env keys loaded: ${Array.isArray(envState.keys) ? envState.keys.length : 0}`);
  console.log(`[Bootstrap] cwd: ${process.cwd()}`);
  console.log(`[Bootstrap] env file: ${envPath}`);
  console.log(`[Bootstrap] env file exists: ${fs.existsSync(envPath) ? 'yes' : 'no'}`);
  console.log(`[Bootstrap] NODE_ENV=${process.env.NODE_ENV || '(unset)'}`);
  console.log(`[Bootstrap] APP_INSTANCE_NAME=${process.env.APP_INSTANCE_NAME || '(unset)'}`);
  console.log(`[Bootstrap] COMPOSE_PROJECT_NAME=${process.env.COMPOSE_PROJECT_NAME || '(unset)'}`);
  console.log(`[Bootstrap] APP_HOST=${process.env.APP_HOST || '(unset)'}`);
  console.log(`[Bootstrap] HOST(legacy)=${process.env.HOST || '(unset)'}`);
  console.log(`[Bootstrap] APP_PORT=${process.env.APP_PORT || '(unset)'}`);
  console.log(`[Bootstrap] SERVER_PORT=${process.env.SERVER_PORT || '(unset)'}`);
  console.log(`[Bootstrap] OPENSHIFT_NODEJS_PORT=${process.env.OPENSHIFT_NODEJS_PORT || '(unset)'}`);
  console.log(`[Bootstrap] SMTP_HOST=${process.env.SMTP_HOST || '(unset)'}`);
  console.log(`[Bootstrap] PORT=${process.env.PORT || '(unset)'}`);
  console.log(`[Bootstrap] PASSENGER_PORT=${process.env.PASSENGER_PORT || '(unset)'}`);
  console.log(`[Bootstrap] NODE_PORT=${process.env.NODE_PORT || '(unset)'}`);
  console.log(`[Bootstrap] IP=${process.env.IP || '(unset)'}`);
  console.log(`[Bootstrap] DB_HOST=${process.env.DB_HOST || '(unset)'}`);
  console.log(`[Bootstrap] DB_PORT=${process.env.DB_PORT || '(unset)'}`);
  console.log(`[Bootstrap] DB_NAME=${process.env.DB_NAME || '(unset)'}`);
  console.log(`[Bootstrap] DB_USER=${process.env.DB_USER ? mask(process.env.DB_USER) : '(unset)'}`);
  console.log(`[Bootstrap] JWT_SECRET=${process.env.JWT_SECRET ? 'set' : '(unset)'}`);
  console.log(`[Bootstrap] CPANEL_LIGHTWEIGHT=${process.env.CPANEL_LIGHTWEIGHT || '(unset)'}`);
  console.log(`[Bootstrap] DISABLE_BACKGROUND_SERVICES=${process.env.DISABLE_BACKGROUND_SERVICES || '(unset)'}`);
  console.log(`[Bootstrap] DISABLE_WHATSAPP=${process.env.DISABLE_WHATSAPP || '(unset)'}`);
  console.log(`[Bootstrap] WA_SESSION_BASE_DIR=${process.env.WA_SESSION_BASE_DIR || '(unset)'}`);

  process.on('exit', (code) => {
    console.log(`[Bootstrap] Process exit code: ${code}`);
  });
}
