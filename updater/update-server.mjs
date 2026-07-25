import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const PORT = Number(process.env.PORT || 3140);
const WORKSPACE_DIR = String(process.env.WORKSPACE_DIR || '/workspace');
const RUNTIME_HOME = String(process.env.APP_UPDATE_HOME || '/tmp/app-updater-home').trim() || '/tmp/app-updater-home';
const DOCKER_CONFIG_DIR = String(process.env.APP_UPDATE_DOCKER_CONFIG || path.join(RUNTIME_HOME, '.docker')).trim() || path.join(RUNTIME_HOME, '.docker');
const SSH_DIR = String(process.env.APP_UPDATE_SSH_DIR || path.join(RUNTIME_HOME, '.ssh')).trim() || path.join(RUNTIME_HOME, '.ssh');
const UPDATE_TOKEN = String(process.env.APP_UPDATE_TOKEN || '').trim();
const REPO_URL = String(process.env.APP_UPDATE_REPO_URL || '').trim();
const GIT_REMOTE = String(process.env.APP_UPDATE_GIT_REMOTE || 'origin').trim() || 'origin';
const GIT_BRANCH = String(process.env.APP_UPDATE_GIT_BRANCH || 'main').trim() || 'main';
const COMPOSE_FILE = String(process.env.APP_UPDATE_COMPOSE_FILE || 'docker-compose.vps.yml').trim() || 'docker-compose.vps.yml';
const ENV_FILE = String(process.env.APP_UPDATE_ENV_FILE || 'docker.env').trim() || 'docker.env';
const MAX_LOG_ENTRIES = 200;

let currentJob = null;

const nowIso = () => new Date().toISOString();

const readJsonFile = async (filePath) => {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const resolveBuildInfo = async () => {
    const manifestCandidates = [
        path.join(WORKSPACE_DIR, 'release-manifest.json'),
        path.join(WORKSPACE_DIR, 'build-manifest.json'),
        path.join(WORKSPACE_DIR, 'package.json'),
    ];

    for (const filePath of manifestCandidates) {
        const data = await readJsonFile(filePath);
        if (!data) continue;

        const builtAt = data.builtAt || data.built_at || null;
        const appVersion = data.appVersion || data.app_version || data.version || null;
        const gitCommit = data.gitCommit || data.git_commit || null;
        const gitBranch = data.gitBranch || data.git_branch || null;

        if (appVersion || builtAt || gitCommit || gitBranch) {
            return {
                app_version: appVersion || (gitCommit ? `build-${gitCommit}` : 'unknown'),
                built_at: builtAt,
                git_commit: gitCommit,
                git_branch: gitBranch,
                source_file: path.basename(filePath),
            };
        }
    }

    return {
        app_version: 'unknown',
        built_at: null,
        git_commit: null,
        git_branch: null,
        source_file: null,
    };
};

const normalizeMessage = (value) => String(value || '').trim();

const createJob = () => ({
    id: randomUUID(),
    status: 'queued',
    progress_percent: 0,
    current_step: 'Queued',
    message: 'Waiting to start application update.',
    error_message: null,
    logs: [],
    started_at: null,
    finished_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    git_remote: GIT_REMOTE,
    git_branch: GIT_BRANCH,
    compose_file: COMPOSE_FILE,
});

const formatJob = (job) => {
    if (!job) return null;
    return {
        ...job,
        logs: [...(job.logs || [])],
    };
};

const persistJob = (job) => {
    currentJob = job;
    return job;
};

const addLog = (job, stream, message) => {
    const text = normalizeMessage(message);
    if (!text) return;

    job.logs.push({
        at: nowIso(),
        stream,
        message: text,
    });

    if (job.logs.length > MAX_LOG_ENTRIES) {
        job.logs.splice(0, job.logs.length - MAX_LOG_ENTRIES);
    }

    job.updated_at = nowIso();
};

const setJobProgress = (job, progress, currentStep, message) => {
    job.progress_percent = Math.max(0, Math.min(100, Number(progress || 0)));
    if (currentStep) {
        job.current_step = currentStep;
    }
    if (message !== undefined) {
        job.message = normalizeMessage(message);
    }
    job.updated_at = nowIso();
};

const runCommand = (job, label, command, args, extraEnv = {}, options = {}) => {
    return new Promise((resolve, reject) => {
        const commandLabel = options.commandLabel || label || command;
        addLog(job, 'system', `Running ${commandLabel}...`);

        const child = spawn(command, args, {
            cwd: WORKSPACE_DIR,
            env: {
                ...process.env,
                HOME: RUNTIME_HOME,
                DOCKER_CONFIG: DOCKER_CONFIG_DIR,
                XDG_CONFIG_HOME: path.join(RUNTIME_HOME, '.config'),
                APP_UPDATE_HOME: RUNTIME_HOME,
                APP_UPDATE_DOCKER_CONFIG: DOCKER_CONFIG_DIR,
                ...extraEnv,
            },
            shell: false,
        });

        child.stdout.on('data', (chunk) => {
            String(chunk).split(/\r?\n/).forEach((line) => addLog(job, 'stdout', line));
        });

        child.stderr.on('data', (chunk) => {
            String(chunk).split(/\r?\n/).forEach((line) => addLog(job, 'stderr', line));
        });

        child.on('error', (error) => {
            addLog(job, 'stderr', `${label} failed to start: ${error.message}`);
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            const error = new Error(`${label} failed with exit code ${code}`);
            error.exitCode = code;
            reject(error);
        });
    });
};

const performUpdate = async (job) => {
    persistJob(job);
    job.status = 'running';
    job.started_at = nowIso();
    job.updated_at = nowIso();
    setJobProgress(job, 5, 'Preparing', 'Starting application update.');
    addLog(job, 'system', `Workspace: ${WORKSPACE_DIR}`);
    addLog(job, 'system', `Repository remote: ${GIT_REMOTE}`);
    addLog(job, 'system', `Branch: ${GIT_BRANCH}`);

    try {
        if (REPO_URL) {
            setJobProgress(job, 12, 'Configuring remote', 'Applying configured repository URL.');
            await runCommand(job, 'git remote set-url', 'git', ['remote', 'set-url', GIT_REMOTE, REPO_URL], {}, {
                commandLabel: 'configuring repository remote',
            });
        }

        setJobProgress(job, 20, 'Fetching', 'Fetching latest changes from origin.');
        await runCommand(job, 'git fetch', 'git', ['fetch', GIT_REMOTE], {}, {
            commandLabel: 'fetching latest changes',
        });

        setJobProgress(job, 45, 'Resetting', 'Resetting workspace to the latest main branch.');
        await runCommand(job, 'git reset', 'git', ['reset', '--hard', `${GIT_REMOTE}/${GIT_BRANCH}`], {}, {
            commandLabel: 'resetting workspace',
        });

        setJobProgress(job, 65, 'Cleaning', 'Cleaning untracked files while preserving database and uploads.');
        await runCommand(job, 'git clean', 'git', [
            'clean',
            '-fd',
            '-e',
            ENV_FILE,
            '-e',
            'backend/uploads',
            '-e',
            'backend/whatsapp_session',
        ], {}, {
            commandLabel: 'cleaning workspace',
        });

        setJobProgress(job, 90, 'Rebuilding', 'Rebuilding the application containers.');
        await runCommand(job, 'docker compose up', 'docker', [
            'compose',
            '--env-file',
            ENV_FILE,
            '-f',
            COMPOSE_FILE,
            'up',
            '-d',
            '--build',
            '--remove-orphans',
            'app',
            'app-watchdog',
        ], {}, {
            commandLabel: 'rebuilding application containers',
        });

        setJobProgress(job, 100, 'Completed', 'Application update completed successfully.');
        job.status = 'completed';
        job.finished_at = nowIso();
        job.updated_at = nowIso();
        addLog(job, 'system', 'Update finished successfully.');
    } catch (error) {
        job.status = 'failed';
        job.error_message = error.message || 'Application update failed.';
        job.message = error.message || 'Application update failed.';
        job.finished_at = nowIso();
        job.updated_at = nowIso();
        addLog(job, 'stderr', job.error_message);
    }
};

const prepareRuntimeDirs = async () => {
    await fs.mkdir(RUNTIME_HOME, { recursive: true });
    await fs.mkdir(DOCKER_CONFIG_DIR, { recursive: true });
    await fs.mkdir(SSH_DIR, { recursive: true });
};

const requireToken = (req) => {
    if (!UPDATE_TOKEN) return false;

    const headerToken = String(req.headers['x-app-update-token'] || '').trim();
    const bearerToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    return headerToken === UPDATE_TOKEN || bearerToken === UPDATE_TOKEN;
};

const sendJson = (res, statusCode, payload) => {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload));
};

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, {
            success: true,
            status: 'ok',
            job: formatJob(currentJob),
            build: await resolveBuildInfo(),
        });
        return;
    }

    if (url.pathname === '/status' && req.method === 'GET') {
        sendJson(res, 200, {
            success: true,
            job: formatJob(currentJob),
            build: await resolveBuildInfo(),
        });
        return;
    }

    if (url.pathname === '/update' && req.method === 'POST') {
        if (!UPDATE_TOKEN) {
            sendJson(res, 500, {
                success: false,
                message: 'APP_UPDATE_TOKEN is not configured.',
            });
            return;
        }

        if (!requireToken(req)) {
            sendJson(res, 401, {
                success: false,
                message: 'Unauthorized.',
            });
            return;
        }

        if (currentJob && ['queued', 'running'].includes(currentJob.status)) {
            sendJson(res, 409, {
                success: false,
                message: 'An application update job is already running.',
                job: formatJob(currentJob),
            });
            return;
        }

        const job = createJob();
        persistJob(job);
        sendJson(res, 202, {
            success: true,
            message: 'Application update queued.',
            job: formatJob(job),
            build: await resolveBuildInfo(),
        });

        void performUpdate(job);
        return;
    }

    sendJson(res, 404, {
        success: false,
        message: 'Not found.',
    });
});

await prepareRuntimeDirs();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[app-updater] listening on port ${PORT}`);
    console.log(`[app-updater] workspace: ${WORKSPACE_DIR}`);
    console.log(`[app-updater] runtime home: ${RUNTIME_HOME}`);
    console.log(`[app-updater] docker config: ${DOCKER_CONFIG_DIR}`);
});
