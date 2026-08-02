import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'backend');
const distDir = path.join(rootDir, 'dist', 'backend');
const packageJsonPath = path.join(rootDir, 'package.json');
const noObfuscateFiles = new Set([
    path.join('utils', 'oltSnmp.js'),
    path.join('routes', 'oltRoutes.js'),
].map((p) => p.replace(/\\/g, '/')));
const ignoredFiles = [
    '.env',
    'import-trace-current.log',
    'logs/',
    'uploads/',
    'whatsapp_session/',
].map((p) => p.replace(/\\/g, '/'));

function shouldSkipBuildFile(normalizedRelativePath) {
    const pathName = normalizedRelativePath.replace(/\\/g, '/');

    if (ignoredFiles.some((entry) => entry.endsWith('/') ? pathName === entry.slice(0, -1) || pathName.startsWith(entry) : pathName === entry)) {
        return true;
    }

    const segments = pathName.split('/');
    return segments.some((segment) => segment.startsWith('.tmp'));
}

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

async function buildBackend() {
    const packageJson = await readJson(packageJsonPath);
    const obfuscatorOptions = packageJson.obfuscatorOptions || {};

    await cleanDir(distDir);

    const files = (await walkDirectory(sourceDir))
        .map((sourcePath) => ({
            sourcePath,
            relativePath: path.relative(sourceDir, sourcePath).replace(/\\/g, '/'),
        }))
        .filter(({ relativePath }) => !shouldSkipBuildFile(relativePath));
    const builtFiles = [];

    for (const { sourcePath, relativePath: normalizedRelativePath } of files) {
        const targetPath = path.join(distDir, normalizedRelativePath);

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
        .map(({ relativePath }) => relativePath)
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
    await fs.writeFile(path.join(distDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    console.log(`[build:backend] Built ${builtFiles.length} file(s) into dist/backend`);
}

buildBackend().catch((error) => {
    console.error('[build:backend] Failed:', error);
    process.exit(1);
});
