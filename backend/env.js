import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envCandidates = [
  path.join(__dirname, '..', 'docker.env'),
  path.join(__dirname, 'docker.env'),
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '.env.docker'),
];

const parseEnvValue = (rawValue) => {
  const value = rawValue.trim();
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const inner = value.slice(1, -1);
    return inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
  }
  return value;
};

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return { loaded: false, keys: [] };
  }

  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const keys = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#')) continue;

    const cleanLine = line.startsWith('export ') ? line.slice(7).trim() : line;
    const equalsIndex = cleanLine.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = cleanLine.slice(0, equalsIndex).trim();
    if (!key) continue;

    const value = parseEnvValue(cleanLine.slice(equalsIndex + 1));
    const existingValue = process.env[key];
    if (existingValue === undefined || existingValue === '') {
      process.env[key] = value;
    }
    keys.push(key);
  }

  return { loaded: true, keys };
};

if (!globalThis.__rizkiTechbillEnvLoaded) {
  globalThis.__rizkiTechbillEnvLoaded = true;
  const selectedEnvPath = envCandidates.find((candidate) => fs.existsSync(candidate)) || null;
  const envState = selectedEnvPath ? loadEnvFile(selectedEnvPath) : { loaded: false, keys: [] };
  globalThis.__rizkiTechbillEnvState = {
    ...envState,
    path: selectedEnvPath,
  };
}

export const envPath = globalThis.__rizkiTechbillEnvState?.path || null;
export const envState = globalThis.__rizkiTechbillEnvState || { loaded: false, keys: [], path: null };
