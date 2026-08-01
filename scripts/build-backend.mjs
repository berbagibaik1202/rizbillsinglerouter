import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'backend');
const distDir = path.join(rootDir, 'dist', 'backend');
const sourceManifestPath = path.join(rootDir, 'backend', 'build-manifest.json');
const distManifestPath = path.join(distDir, 'build-manifest.json');
const packageJsonPath = path.join(rootDir, 'package.json');

const noObfuscateFiles = new Set([
    path.join('utils', 'oltSnmp.js'),
    path.join('routes', 'oltRoutes.js'),
].map((p) => p.replace(/\\/g, '/')));

const ignoredSegments = new Set([
    'node_modules',
    '.git',
    'dist',
    'data',
    'logs',
    'uploads',
    'whatsapp_session',
    'whatsapp_sessions',
    '.cache',
    '.idea',
    '.vscode',
]);

const ignoredBasenames = new Set([
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    '.env.test',
    'build-manifest.json',
    'npm-debug.log',
    'yarn-error.log',
]);

const shouldIgnoreSourcePath = (relativePath) => {
    const normalized = relativePath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const base = path.posix.basename(normalized);

    if (normalized === 'data/settings.json') {
        return true;
    }

    if (base.endsWith('.log') || base.endsWith('.sqlite') || base.endsWith('.sqlite3') || base.endsWith('.db')) {
        return true;
    }

    if (base.startsWith('.env') || ignoredBasenames.has(base)) {
        return true;
    }

    return parts.some((segment) => ignoredSegments.has(segment));
};

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
}

async function cleanDir(dirPath) {
    await fs.rm(dirPath, { recursive: true, force: true });
    await ensureDir(dirPath);
}

async function copyFile(sourcePath, targetPath) {
    await ensureDir(path.dirname(targetPath));
    await fs.copyFile(sourcePath, targetPath);
}

async function walkDirectory(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...await walkDirectory(fullPath));
            continue;
        }
        results.push(fullPath);
    }

    return results;
}

async function writeJson(filePath, data) {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function buildBackend() {
    const packageJson = await readJson(packageJsonPath);
    const obfuscatorOptions = packageJson.obfuscatorOptions || {};

    await cleanDir(distDir);

    const files = (await walkDirectory(sourceDir))
        .map((sourcePath) => ({
            sourcePath,
            relativePath: path.relative(sourceDir, sourcePath).replace(/\\/g, '/'),
        }))
        .filter(({ relativePath }) => !shouldIgnoreSourcePath(relativePath))
        .map(({ sourcePath }) => sourcePath);
    const builtFiles = [];

    for (const sourcePath of files) {
        const relativePath = path.relative(sourceDir, sourcePath);
        const normalizedRelativePath = relativePath.replace(/\\/g, '/');
        const targetPath = path.join(distDir, relativePath);

        await ensureDir(path.dirname(targetPath));

        const shouldObfuscate =
            path.extname(sourcePath).toLowerCase() === '.js' &&
            !noObfuscateFiles.has(normalizedRelativePath);

        if (shouldObfuscate) {
            const sourceCode = await fs.readFile(sourcePath, 'utf8');
            const result = JavaScriptObfuscator.obfuscate(sourceCode, {
                ...obfuscatorOptions,
                target: 'node',
            });
            await fs.writeFile(targetPath, result.getObfuscatedCode(), 'utf8');
        } else {
            await copyFile(sourcePath, targetPath);
        }

        builtFiles.push(normalizedRelativePath);
    }

    const criticalFiles = [
        'server.js',
        path.join('routes', 'customerRoutes.js'),
        'utils.js',
    ];

    for (const criticalFile of criticalFiles) {
        const built = path.join(distDir, criticalFile);
        try {
            await fs.access(built);
        } catch {
            throw new Error(`Critical backend build file missing: ${criticalFile}`);
        }
    }

    const sortedSource = files
        .map((sourcePath) => path.relative(sourceDir, sourcePath).replace(/\\/g, '/'))
        .sort();
    const sortedBuilt = [...builtFiles].sort();
    if (sortedSource.length !== sortedBuilt.length) {
        throw new Error(`Build parity check failed: source=${sortedSource.length}, built=${sortedBuilt.length}`);
    }
    for (let i = 0; i < sortedSource.length; i += 1) {
        if (sortedSource[i] !== sortedBuilt[i]) {
            throw new Error(`Build parity mismatch at index ${i}: source="${sortedSource[i]}", built="${sortedBuilt[i]}"`);
        }
    }

    const manifest = {
        builtAt: new Date().toISOString(),
        sourceCount: sortedSource.length,
        builtCount: sortedBuilt.length,
        noObfuscateFiles: [...noObfuscateFiles].sort(),
        files: sortedBuilt,
    };

    await writeJson(distManifestPath, manifest);
    await writeJson(sourceManifestPath, manifest);

    console.log(`[build:backend] Built ${builtFiles.length} file(s) into dist/backend`);
}

buildBackend().catch((error) => {
    console.error('[build:backend] Failed:', error);
    process.exit(1);
});
