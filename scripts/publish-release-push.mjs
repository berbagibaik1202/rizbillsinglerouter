import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const releaseBranch = 'release-push';

function runGit(args, cwd = rootDir, env = {}) {
    const result = spawnSync('git', args, {
        cwd,
        env: { ...process.env, ...env },
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        const command = ['git', ...args].join(' ');
        throw new Error(
            `[release:push] ${command} failed${result.stdout ? `\n${result.stdout}` : ''}${result.stderr ? `\n${result.stderr}` : ''}`,
        );
    }

    return String(result.stdout || '').trim();
}

function runGitOptional(args, cwd = rootDir) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        return '';
    }

    return String(result.stdout || '').trim();
}

async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
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

async function mirrorDirectory(sourceDir, targetDir) {
    await ensureDir(targetDir);

    const currentEntries = await fs.readdir(targetDir, { withFileTypes: true });
    for (const entry of currentEntries) {
        if (entry.name === '.git') {
            continue;
        }
        await fs.rm(path.join(targetDir, entry.name), { recursive: true, force: true });
    }

    const files = await walkDirectory(sourceDir);
    for (const sourcePath of files) {
        const relativePath = path.relative(sourceDir, sourcePath);
        const targetPath = path.join(targetDir, relativePath);
        await ensureDir(path.dirname(targetPath));
        await fs.copyFile(sourcePath, targetPath);
    }
}

function findReleaseWorktree() {
    const output = runGit(['worktree', 'list', '--porcelain'], rootDir);
    const lines = output.split(/\r?\n/);
    let currentPath = '';
    let currentBranch = '';

    for (const line of lines) {
        if (!line) {
            if (currentBranch === `refs/heads/${releaseBranch}` && currentPath) {
                return currentPath;
            }
            currentPath = '';
            currentBranch = '';
            continue;
        }

        if (line.startsWith('worktree ')) {
            currentPath = line.slice('worktree '.length).trim();
            continue;
        }

        if (line.startsWith('branch ')) {
            currentBranch = line.slice('branch '.length).trim();
        }
    }

    if (currentBranch === `refs/heads/${releaseBranch}` && currentPath) {
        return currentPath;
    }

    return '';
}

function getGitIdentity(cwd) {
    const name = runGitOptional(['config', '--get', 'user.name'], cwd) || 'Codex Release Bot';
    const email = runGitOptional(['config', '--get', 'user.email'], cwd) || 'codex@example.com';

    return { name, email };
}

async function main() {
    const worktreeDir = findReleaseWorktree();
    if (!worktreeDir) {
        throw new Error(`[release:push] Could not find a git worktree checked out on ${releaseBranch}.`);
    }

    await fs.access(releaseDir);
    await mirrorDirectory(releaseDir, worktreeDir);

    runGit(['add', '-A'], worktreeDir);

    const tree = runGit(['write-tree'], worktreeDir);
    const identity = getGitIdentity(worktreeDir);
    const commit = runGit(
        ['commit-tree', tree, '-m', 'build: publish release snapshot'],
        worktreeDir,
        {
            GIT_AUTHOR_NAME: identity.name,
            GIT_AUTHOR_EMAIL: identity.email,
            GIT_COMMITTER_NAME: identity.name,
            GIT_COMMITTER_EMAIL: identity.email,
        },
    );

    runGit(['reset', '--hard', commit], worktreeDir);
    runGit(['push', '--force', 'origin', releaseBranch], worktreeDir);

    console.log(`[release:push] Published ${releaseBranch} as snapshot commit ${commit}`);
}

main().catch((error) => {
    console.error('[release:push] Failed:', error);
    process.exit(1);
});
