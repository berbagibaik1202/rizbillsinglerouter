import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const releaseDir = path.join(rootDir, 'release');
const distBackendManifestPath = path.join(distDir, 'backend', 'build-manifest.json');
const sourceBackendManifestPath = path.join(rootDir, 'backend', 'build-manifest.json');
const releaseBackendManifestPath = path.join(releaseDir, 'build-manifest.json');
const releaseManifestPath = path.join(releaseDir, 'release-manifest.json');
const sourceReleaseManifestPath = path.join(rootDir, 'release-manifest.json');

const rootFilesToCopy = [
    'package.json',
    'package-lock.json',
    'install-vps.sh',
    'docker-entrypoint.js',
    'docker-compose.vps.yml',
    'Dockerfile.updater',
    'docker.env.example',
    'scripts/docker-healthwatch.sh',
];

function resolveGitInfo() {
    const headResult = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
        cwd: rootDir,
        encoding: 'utf8',
    });

    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: rootDir,
        encoding: 'utf8',
    });

    const commit = headResult.status === 0 ? String(headResult.stdout || '').trim() : '';
    const branch = branchResult.status === 0 ? String(branchResult.stdout || '').trim() : '';

    return {
        gitCommit: commit || null,
        gitBranch: branch || null,
    };
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

async function copyDirectory(sourceDir, targetDir) {
    const files = await walkDirectory(sourceDir);
    for (const sourcePath of files) {
        const relativePath = path.relative(sourceDir, sourcePath);
        const targetPath = path.join(targetDir, relativePath);
        await copyFile(sourcePath, targetPath);
    }
}

async function readJsonIfExists(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function collectCurrentAssetReferences(sourceDir) {
    const referenced = new Set();
    const inspectFiles = [
        path.join(sourceDir, 'index.html'),
        path.join(sourceDir, 'manifest.webmanifest'),
        path.join(sourceDir, 'sw.js'),
    ];

    for (const filePath of inspectFiles) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            for (const match of content.matchAll(/\/assets\/[^"'`\s)<>]+/g)) {
                referenced.add(match[0].replace(/^\//, ''));
            }
            for (const match of content.matchAll(/workbox-[^"'`\s)]+\.js/g)) {
                referenced.add(match[0]);
            }
            for (const match of content.matchAll(/(?:registerSW\.js|manifest\.webmanifest|sw\.js)/g)) {
                referenced.add(match[0]);
            }
        } catch {
            // ignore missing optional files
        }
    }

    return referenced;
}

async function pruneUnusedReleaseAssets(releaseDirPath, sourceDir) {
    const referenced = await collectCurrentAssetReferences(sourceDir);
    const assetsDir = path.join(releaseDirPath, 'assets');

    try {
        const assetFiles = await walkDirectory(assetsDir);
        for (const filePath of assetFiles) {
            const relativePath = path.relative(releaseDirPath, filePath).replace(/\\/g, '/');
            if (!referenced.has(relativePath)) {
                await fs.rm(filePath, { force: true });
            }
        }
    } catch {
        // no assets directory yet
    }

    const releaseFiles = await walkDirectory(releaseDirPath);
    for (const filePath of releaseFiles) {
        const relativePath = path.relative(releaseDirPath, filePath).replace(/\\/g, '/');
        const baseName = path.basename(relativePath);
        if (/^workbox-[^/]+\.js$/.test(baseName) && !referenced.has(baseName)) {
            await fs.rm(filePath, { force: true });
        }
    }
}

async function writeJson(filePath, data) {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeReleaseDockerfile(targetPath) {
    const dockerfile = [
        'FROM node:20-bookworm-slim',
        '',
        'WORKDIR /app',
        'ENV NODE_ENV=production',
        '',
        'RUN apt-get update \\',
        '    && apt-get install -y --no-install-recommends mariadb-client \\',
        '    && rm -rf /var/lib/apt/lists/*',
        '',
        'COPY package*.json ./',
        'RUN npm ci --omit=dev && npm cache clean --force',
        '',
        'COPY . /app/dist',
        'COPY docker-entrypoint.js ./docker-entrypoint.js',
        '',
        'EXPOSE 3002',
        '',
        'CMD ["node", "docker-entrypoint.js"]',
        '',
    ].join('\n');

    await fs.writeFile(targetPath, dockerfile, 'utf8');
}

async function writeReleaseDockerignore(targetPath) {
    const dockerignore = [
        '.git',
        'node_modules',
        'dist',
        'release',
        'docker.env',
        'docker.env.example',
        'Dockerfile',
        'docker-compose.vps.yml',
        'release-manifest.json',
        'scripts/',
        '*.log',
        '.env',
        '.env.local',
        'backend/.env',
        '',
    ].join('\n');

    await fs.writeFile(targetPath, dockerignore, 'utf8');
}

async function writeReleaseReadme(targetPath) {
    const readme = [
        '# RizBill Release Package',
        '',
        '## Install Cepat',
        '',
        'Jalankan 3 perintah ini:',
        '',
        '```bash',
        'git clone https://github.com/berbagibaik1202/rizbillsinglerouter.git',
        'cd rizbillsinglerouter',
        'bash install-vps.sh',
        '```',
        '',
        'Installer akan otomatis membuat `docker.env`, database, dan credential aplikasi.',
        'Kalau kamu memakai repo build public, isi `APP_UPDATE_REPO_URL` di `docker.env` agar tombol `Update App` bisa melakukan update dari halaman Settings.',
        'Kalau `docker.env` lama belum punya key update, jalankan ulang `bash install-vps.sh` supaya nilai dari `docker.env.example` tersinkron ke file env aktif.',
        '',
        'Kalau pakai Nginx Proxy Manager, arahkan upstream ke `APP_INSTANCE_NAME:3002`.',
        'Kalau akses langsung ke `IP-VPS:3002`, itu tidak akan jalan kecuali kamu menambahkan port mapping host di compose.',
        '',
        '## Reset Total dan Build Ulang',
        '',
        'Kalau kamu mau mematikan semua container stack ini lalu membangun ulang termasuk database MariaDB, pakai urutan berikut:',
        '',
        '```bash',
        'docker compose --env-file docker.env -f docker-compose.vps.yml down -v --remove-orphans',
        'docker compose --env-file docker.env -f docker-compose.vps.yml up -d --build',
        '```',
        '',
        'Catatan: opsi `down -v` akan menghapus volume database, jadi semua data lama ikut terhapus.',
        '',
        'Untuk restart/update deployment manual, pakai urutan aman ini:',
        '',
        '```bash',
        'git fetch origin',
        'git reset --hard origin/release-push',
        'git clean -fd -e docker.env -e backend/uploads -e backend/whatsapp_session',
        'docker compose --env-file docker.env -f docker-compose.vps.yml down',
        'docker compose --env-file docker.env -f docker-compose.vps.yml up -d --build',
        '```',
        '',
        'Kalau mau multi-instance, set `APP_INSTANCE_NAME`, `COMPOSE_PROJECT_NAME`, `DB_NAME`, dan `WA_SESSION_BASE_DIR` berbeda untuk tiap folder deploy.',
        'Network proxy yang dipakai adalah external network yang sama dengan NPM, dan installer akan membuatnya otomatis kalau belum ada.',
        'Di halaman Settings ada tab `Update App` untuk menjalankan update aplikasi tanpa menghapus volume database MariaDB.',
        '',
    ].join('\n');

    await fs.writeFile(targetPath, readme, 'utf8');
}

async function main() {
    await fs.access(distDir);
    await cleanDir(releaseDir);

    await copyDirectory(distDir, releaseDir);
    await copyDirectory(path.join(rootDir, 'updater'), path.join(releaseDir, 'updater'));

    for (const relativePath of rootFilesToCopy) {
        const sourcePath = path.join(rootDir, relativePath);
        const targetPath = path.join(releaseDir, relativePath);
        await copyFile(sourcePath, targetPath);
    }

    const backendManifest =
        await readJsonIfExists(distBackendManifestPath) ||
        await readJsonIfExists(sourceBackendManifestPath);

    await writeReleaseDockerfile(path.join(releaseDir, 'Dockerfile'));
    await writeReleaseDockerignore(path.join(releaseDir, '.dockerignore'));
    await writeReleaseReadme(path.join(releaseDir, 'README.md'));
    await pruneUnusedReleaseAssets(releaseDir, distDir);

    if (backendManifest) {
        await writeJson(releaseBackendManifestPath, backendManifest);
    }

    const builtAt = new Date().toISOString();
    const gitInfo = resolveGitInfo();
    const manifest = {
        appVersion: gitInfo.gitCommit ? `build-${gitInfo.gitCommit}` : `build-${builtAt.replace(/[:.]/g, '-')}`,
        gitCommit: gitInfo.gitCommit,
        gitBranch: gitInfo.gitBranch,
        builtAt,
        sourceDir: distDir,
        releaseDir,
        copiedRootFiles: rootFilesToCopy,
        dockerfile: 'Dockerfile',
        note: 'Release folder contains flattened dist output plus deployment files outside dist.',
    };

    await writeJson(releaseManifestPath, manifest);
    await writeJson(sourceReleaseManifestPath, manifest);

    console.log(`[package:release] Created release package at ${releaseDir}`);
}

main().catch((error) => {
    console.error('[package:release] Failed:', error);
    process.exit(1);
});
