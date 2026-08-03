import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const STATE_KEY = '__rizkiTechbillEnvLoaderState';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '.env.local'),
  path.join(__dirname, '..', '.env.local'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'docker.env'),
];

const parseEnvValue = (rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));

  if (!quoted) {
    return value;
  }

  return value
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
};

const loadEnvFile = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const keys = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.replace(/^\uFEFF/, '').trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) {
      continue;
    }

    const value = parseEnvValue(trimmed.slice(eqIndex + 1));
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
    keys.push(key);
  }

  return {
    loaded: true,
    keys,
  };
};

const findEnvPath = () => {
  for (const candidate of envCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

if (!globalThis[STATE_KEY]) {
  const selectedEnvPath = findEnvPath();
  const envState = selectedEnvPath
    ? loadEnvFile(selectedEnvPath)
    : { loaded: false, keys: [] };

  globalThis[STATE_KEY] = {
    ...envState,
    path: selectedEnvPath,
  };
}

export const envPath = globalThis[STATE_KEY]?.path || null;
export const envState = globalThis[STATE_KEY] || {
  loaded: false,
  keys: [],
  path: null,
};
