import path from 'path';

const sanitizeNamespace = (value, fallback = 'default') => {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
};

export const resolveNamespacedStorageDir = ({
  exactDirEnv = 'UPLOAD_DIR',
  baseDirEnv = 'UPLOAD_BASE_DIR',
  defaultBaseDir = '/opt/uploads',
  namespaceEnv = ['APP_INSTANCE_NAME', 'APP_SUBDOMAIN', 'SUBDOMAIN', 'HOSTNAME'],
  defaultNamespace = 'default',
} = {}) => {
  const exactDir = process.env[exactDirEnv];
  if (exactDir) {
    return path.resolve(exactDir);
  }

  const baseDir = process.env[baseDirEnv]
    ? path.resolve(process.env[baseDirEnv])
    : defaultBaseDir;

  const rawNamespace = namespaceEnv
    .map((key) => process.env[key])
    .find((value) => Boolean(value));

  return path.join(baseDir, sanitizeNamespace(rawNamespace || path.basename(process.cwd()), defaultNamespace));
};
