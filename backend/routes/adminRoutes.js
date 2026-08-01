import express from 'express';
import pool from '../db.js';
import { getSettings, formatRupiah, replacePlaceholders, dbDateToISO, toMySQLDatetime, randomDelay, dateToYMD, parseLocalDateString } from '../utils.js';
import mikrotikApi from '../mikrotik-api.js';
import whatsappService from '../whatsappService.js';
import { sendTestEmail } from '../emailService.js';
import { getCashSummary } from '../cashMutationService.js';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDeviceProfileByModel } from '../utils/deviceProfiles.js';
import { getLastDigiflazzPing } from '../services/digiflazzWebhookState.js';
import { isSnmpEnabledForDevice, readSnmpSystemInfo } from '../utils/oltSnmp.js';
import { handleWhatsappMessage } from './chatbotRoutes.js';
import {
    insertWhatsAppLog,
    updateWhatsAppLogById,
} from '../services/whatsappLogService.js';

const { promises: fsPromises } = fs;

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const upload = multer({ dest: UPLOAD_DIR });
const playlistStorage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname || '').toLowerCase() || '.m3u';
        cb(null, `playlist-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
});
const playlistUpload = multer({ storage: playlistStorage });
let adminNotificationsHasKeyColumn = null;
const DASHBOARD_ROUTER_TIMEOUT_MS = 6500;

const getKirimdevTemplateConfig = (settings = {}) => {
    const gateway = settings?.whatsapp?.customGateway || {};
    return {
        name: String(gateway.outsideWindowTemplateName || '').trim(),
        language: String(gateway.outsideWindowTemplateLanguage || 'id').trim() || 'id',
    };
};

const sendOutboundWhatsAppMessage = async (settings, recipientNumber, messageBody) => {
    whatsappService.applySettings(settings);

    const deliveryMode = String(settings?.whatsapp?.deliveryMode || 'baileys').toLowerCase();
    const templateConfig = getKirimdevTemplateConfig(settings);

    if (deliveryMode === 'custom' && templateConfig.name) {
        return whatsappService.sendTemplateMessage(
            recipientNumber,
            messageBody,
            templateConfig.name,
            templateConfig.language,
        );
    }

    return whatsappService.sendMessage(recipientNumber, messageBody);
};

const withDashboardTimeout = (promise, fallback, timeoutMs = DASHBOARD_ROUTER_TIMEOUT_MS, label = 'dashboard task') => {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            console.warn(`[Admin Dashboard] ${label} timed out after ${timeoutMs}ms; using fallback.`);
            resolve(fallback);
        }, timeoutMs);

        Promise.resolve(promise)
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timer);
                console.warn(`[Admin Dashboard] ${label} failed:`, error?.message || error);
                resolve(fallback);
            });
    });
};

const isValidPlaylistFilename = (filename = '') => {
    return /\.(m3u8?|txt)$/i.test(String(filename || '').trim());
};

const validatePlaylistContent = (content = '') => {
    const lines = String(content || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    let extinfCount = 0;
    let urlCount = 0;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.startsWith('#EXTINF')) {
            extinfCount += 1;
            for (let j = i + 1; j < lines.length; j += 1) {
                const candidate = lines[j];
                if (!candidate) continue;
                if (candidate.startsWith('#') && !/^https?:\/\//i.test(candidate)) {
                    continue;
                }
                if (!candidate.startsWith('#')) {
                    urlCount += 1;
                    break;
                }
            }
        }
    }

    return {
        valid: extinfCount > 0 && urlCount > 0,
        extinfCount,
        urlCount,
    };
};

const debugPlaylistSource = async (rawUrl) => {
    const playlistHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    };

    const fetchPlaylistText = async (targetUrl) => {
        const response = await fetch(targetUrl, {
            headers: playlistHeaders,
            redirect: 'follow',
        });
        const body = await response.text();
        return { response, body };
    };

    let { response, body } = await fetchPlaylistText(rawUrl);

    const looksLikePlaylist = body.includes('#EXTINF') || body.includes('#EXTM3U');
    const looksLikeHtml = /<\s*html/i.test(body) || /<!doctype html/i.test(body);

    if ((!response.ok || !looksLikePlaylist) && looksLikeHtml) {
        const urlMatches = Array.from(body.matchAll(/https?:\/\/[^\s"'<>]+/gi)).map((match) => match[0]);
        const fallbackUrl = urlMatches.find((candidate) => candidate !== rawUrl && !candidate.includes('googleapis.com')) || null;
        if (fallbackUrl) {
            const retry = await fetchPlaylistText(fallbackUrl);
            response = retry.response;
            body = retry.body;
        }
    }

    return {
        response,
        body,
    };
};

const getBroadcastDelayProfile = (settings, overrides = {}) => {
    const defaultDelayMode = settings?.whatsapp?.broadcastDelayMode || 'step';
    const defaultDelayStart = Number(settings?.whatsapp?.broadcastDelayStartMs ?? 1000);
    const defaultDelayIncrement = Number(settings?.whatsapp?.broadcastDelayIncrementMs ?? 750);
    const defaultDelayMax = Number(settings?.whatsapp?.broadcastDelayMaxMs ?? 7000);
    const defaultDelayStepEvery = Number(settings?.whatsapp?.broadcastDelayStepEvery ?? 5);
    const defaultDelayRandomJitter = Number(settings?.whatsapp?.broadcastDelayRandomJitterMs ?? 1500);

    const resolvedDelayMode = ['flat', 'linear', 'step', 'randomized'].includes(String(overrides.delayMode))
        ? String(overrides.delayMode)
        : defaultDelayMode;
    const resolvedDelayStart = Math.max(0, Number.isFinite(Number(overrides.delayStartMs)) ? Number(overrides.delayStartMs) : defaultDelayStart);
    const resolvedDelayIncrement = Math.max(0, Number.isFinite(Number(overrides.delayIncrementMs)) ? Number(overrides.delayIncrementMs) : defaultDelayIncrement);
    const resolvedDelayMax = Math.max(resolvedDelayStart, Number.isFinite(Number(overrides.delayMaxMs)) ? Number(overrides.delayMaxMs) : defaultDelayMax);
    const resolvedDelayStepEvery = Math.max(1, Number.isFinite(Number(overrides.delayStepEvery)) ? Number(overrides.delayStepEvery) : defaultDelayStepEvery);
    const resolvedDelayRandomJitter = Math.max(0, Number.isFinite(Number(overrides.delayRandomJitterMs)) ? Number(overrides.delayRandomJitterMs) : defaultDelayRandomJitter);

    return {
        mode: resolvedDelayMode,
        startMs: resolvedDelayStart,
        incrementMs: resolvedDelayIncrement,
        maxMs: resolvedDelayMax,
        stepEvery: resolvedDelayStepEvery,
        randomJitterMs: resolvedDelayRandomJitter,
    };
};

const computeBroadcastDelay = (index, profile) => {
    if (profile.mode === 'flat') {
        return profile.startMs;
    }
    if (profile.mode === 'linear') {
        return Math.min(
            profile.startMs + (Math.max(0, index) * profile.incrementMs),
            profile.maxMs,
        );
    }
    if (profile.mode === 'randomized') {
        const randomOffset = Math.floor(Math.random() * (profile.randomJitterMs + 1));
        return Math.min(
            profile.startMs + randomOffset,
            profile.maxMs,
        );
    }

    const stepIndex = Math.floor(Math.max(0, index) / profile.stepEvery);
    return Math.min(
        profile.startMs + (stepIndex * profile.incrementMs),
        profile.maxMs,
    );
};

const resolveMysqlBinary = (...binaryNames) => {
    const isWindows = process.platform === 'win32';
    const names = binaryNames.flat().map((name) => String(name || '').trim()).filter(Boolean);
    const searchNames = names.length > 0 ? names : ['mysqldump'];
    const candidatePaths = [];

    for (const binaryName of searchNames) {
        const resolvedName = isWindows && !binaryName.toLowerCase().endsWith('.exe')
            ? `${binaryName}.exe`
            : binaryName;

        candidatePaths.push(
            ...(isWindows
                ? [
                    path.join('C:\\xampp\\mysql\\bin', resolvedName),
                    path.join('D:\\xampp\\mysql\\bin', resolvedName),
                    path.join('E:\\xampp\\mysql\\bin', resolvedName),
                    path.join('C:\\Program Files\\MariaDB 10.4\\bin', resolvedName),
                    path.join('C:\\Program Files\\MariaDB 10.5\\bin', resolvedName),
                    path.join('C:\\Program Files\\MariaDB 10.6\\bin', resolvedName),
                    path.join('C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin', resolvedName),
                ]
                : [
                    `/usr/bin/${resolvedName}`,
                    `/usr/local/bin/${resolvedName}`,
                    `/opt/lampp/bin/${resolvedName}`,
                    `/opt/xampp/bin/${resolvedName}`,
                ])
        );
    }

    for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    const locator = isWindows ? 'where' : 'which';
    for (const binaryName of searchNames) {
        const resolvedName = isWindows && !binaryName.toLowerCase().endsWith('.exe')
            ? `${binaryName}.exe`
            : binaryName;
        const probe = spawnSync(locator, [resolvedName], { encoding: 'utf8' });
        if (probe.status === 0) {
            const firstMatch = String(probe.stdout || '')
                .split(/\r?\n/)
                .map(line => line.trim())
                .find(Boolean);
            if (firstMatch) {
                return firstMatch;
            }
        }
    }

    return searchNames[0];
};

const ensureAdminNotificationsKeyColumn = async () => {
    if (adminNotificationsHasKeyColumn !== null) {
        return adminNotificationsHasKeyColumn;
    }
    try {
        const [rows] = await pool.query("SHOW COLUMNS FROM admin_notifications LIKE 'key'");
        adminNotificationsHasKeyColumn = rows.length > 0;
    } catch (error) {
        console.error("Failed to inspect admin_notifications columns:", error);
        adminNotificationsHasKeyColumn = false;
    }
    return adminNotificationsHasKeyColumn;
};

const DATABASE_RESTORE_JOB_STATUSES = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELED: 'canceled',
};

const DATABASE_RESTORE_WORKER_PATH = path.join(__dirname, '../jobs/databaseRestoreWorker.js');
const DATABASE_RESTORE_JOB_POLL_INTERVAL_MS = 5000;
let databaseRestoreSchedulerStarted = false;
let databaseRestoreWorkerRunning = false;
const APP_UPDATE_SERVICE_URL = String(process.env.APP_UPDATE_SERVICE_URL || 'http://app-updater:3140').replace(/\/+$/, '');
const APP_UPDATE_SERVICE_TOKEN = String(process.env.APP_UPDATE_TOKEN || process.env.APP_UPDATE_SERVICE_TOKEN || '').trim();
const APP_UPDATE_REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.APP_UPDATE_REQUEST_TIMEOUT_MS || 15000));

const formatDatabaseRestoreJob = (job) => {
    if (!job) return null;

    return {
        ...job,
        processed_count: Number(job.processed_count || 0),
        progress_percent: Number(job.progress_percent || 0),
        total_statements: Number(job.total_statements || 0),
        worker_pid: job.worker_pid == null ? null : Number(job.worker_pid),
        created_at: job.created_at ? dbDateToISO(job.created_at) : null,
        updated_at: job.updated_at ? dbDateToISO(job.updated_at) : null,
        started_at: job.started_at ? dbDateToISO(job.started_at) : null,
        finished_at: job.finished_at ? dbDateToISO(job.finished_at) : null,
    };
};

const getDatabaseRestoreJobById = async (jobId) => {
    const [rows] = await pool.query(
        'SELECT * FROM database_restore_jobs WHERE id = ? LIMIT 1',
        [jobId]
    );
    return rows.length > 0 ? rows[0] : null;
};

const getActiveDatabaseRestoreJob = async () => {
    const [rows] = await pool.query(
        `SELECT * FROM database_restore_jobs
         WHERE status IN (?, ?)
         ORDER BY created_at DESC
         LIMIT 1`,
        [DATABASE_RESTORE_JOB_STATUSES.QUEUED, DATABASE_RESTORE_JOB_STATUSES.RUNNING]
    );
    return rows.length > 0 ? rows[0] : null;
};

const getNextQueuedDatabaseRestoreJob = async () => {
    const [rows] = await pool.query(
        `SELECT * FROM database_restore_jobs
         WHERE status = ?
         ORDER BY created_at ASC
         LIMIT 1`,
        [DATABASE_RESTORE_JOB_STATUSES.QUEUED]
    );
    return rows.length > 0 ? rows[0] : null;
};

const createDatabaseRestoreJob = async ({ backupPath, originalFilename }) => {
    const id = uuidv4();
    await pool.query(
        `INSERT INTO database_restore_jobs
            (id, status, processed_count, progress_percent, message, backup_path, original_filename, worker_pid, total_statements)
         VALUES (?, ?, 0, 0, ?, ?, ?, NULL, 0)`,
        [id, DATABASE_RESTORE_JOB_STATUSES.QUEUED, 'Queued for processing', backupPath, originalFilename || null]
    );
    return getDatabaseRestoreJobById(id);
};

const updateDatabaseRestoreJob = async (jobId, fields = {}) => {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;

    const assignments = keys.map((key) => `\`${key}\` = ?`).join(', ');
    const values = keys.map((key) => fields[key]);
    values.push(jobId);

    await pool.query(
        `UPDATE database_restore_jobs SET ${assignments} WHERE id = ?`,
        values
    );
};

const finalizeDatabaseRestoreJob = async (jobId, status, fields = {}) => {
    await updateDatabaseRestoreJob(jobId, {
        status,
        progress_percent: status === DATABASE_RESTORE_JOB_STATUSES.COMPLETED ? 100 : Number(fields.progress_percent || 0),
        finished_at: fields.finished_at || new Date(),
        updated_at: new Date(),
        ...fields,
    });
};

const claimDatabaseRestoreJob = async (jobId) => {
    const [result] = await pool.query(
        `UPDATE database_restore_jobs
         SET status = ?, started_at = COALESCE(started_at, NOW()), message = ?, updated_at = NOW()
         WHERE id = ? AND status = ?`,
        [DATABASE_RESTORE_JOB_STATUSES.RUNNING, 'Database restore worker starting...', jobId, DATABASE_RESTORE_JOB_STATUSES.QUEUED]
    );

    return result.affectedRows > 0;
};

const launchDatabaseRestoreWorker = (jobId) => {
    const child = spawn(process.execPath, [DATABASE_RESTORE_WORKER_PATH, jobId], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });

    updateDatabaseRestoreJob(jobId, {
        worker_pid: child.pid || null,
        updated_at: new Date(),
    }).catch((error) => {
        console.error('[Database Restore] Failed to store worker pid:', error);
    });

    child.unref();
    return child;
};

const processDatabaseRestoreQueue = async () => {
    if (databaseRestoreWorkerRunning) return;

    const nextJob = await getNextQueuedDatabaseRestoreJob();
    if (!nextJob) {
        return;
    }

    databaseRestoreWorkerRunning = true;
    try {
        const claimed = await claimDatabaseRestoreJob(nextJob.id);
        if (!claimed) {
            return;
        }

        launchDatabaseRestoreWorker(nextJob.id);
    } catch (error) {
        console.error('[Database Restore] Failed to launch restore worker:', error);
        await finalizeDatabaseRestoreJob(nextJob.id, DATABASE_RESTORE_JOB_STATUSES.FAILED, {
            error_message: error.message || 'Failed to launch database restore worker.',
            message: error.message || 'Failed to launch database restore worker.',
        });
        if (nextJob.backup_path) {
            fs.unlink(nextJob.backup_path, () => {});
        }
    } finally {
        databaseRestoreWorkerRunning = false;
    }
};

export const startDatabaseRestoreJobScheduler = () => {
    if (process.env.CPANEL_LIGHTWEIGHT === 'true' || process.env.DISABLE_BACKGROUND_SERVICES === 'true') {
        console.warn('[Database Restore] Restore scheduler disabled by runtime flag.');
        return;
    }

    if (databaseRestoreSchedulerStarted) return;
    databaseRestoreSchedulerStarted = true;

    pool.query(
        `UPDATE database_restore_jobs
         SET status = ?, message = ?, updated_at = NOW()
         WHERE status = ?`,
        [DATABASE_RESTORE_JOB_STATUSES.QUEUED, 'Recovered after service restart', DATABASE_RESTORE_JOB_STATUSES.RUNNING]
    ).catch((error) => {
        console.error('[Database Restore] Failed to recover running jobs on startup:', error);
    });

    const tick = () => {
        processDatabaseRestoreQueue().catch((error) => {
            console.error('[Database Restore] Scheduler tick failed:', error);
        });
    };

    tick();
    setInterval(tick, DATABASE_RESTORE_JOB_POLL_INTERVAL_MS);
};

const cancelDatabaseRestoreWorker = (workerPid) => {
    const pid = Number(workerPid);
    if (!Number.isFinite(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 'SIGTERM');
        return true;
    } catch (error) {
        if (error?.code === 'ESRCH') {
            return false;
        }
        throw error;
    }
};

const callAppUpdateService = async (method, endpoint, body) => {
    if (!APP_UPDATE_SERVICE_TOKEN) {
        throw new Error('APP_UPDATE_SERVICE_TOKEN is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), APP_UPDATE_REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(`${APP_UPDATE_SERVICE_URL}${endpoint}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-App-Update-Token': APP_UPDATE_SERVICE_TOKEN,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
        });

        const data = await response.json().catch(() => ({}));
        return { response, data };
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('App update service request timed out.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

const APP_ROOT_DIR = path.resolve(__dirname, '..', '..');

const readJsonIfExists = async (filePath) => {
    try {
        const raw = await fsPromises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const resolveLocalAppBuildInfo = async () => {
    const candidates = [
        path.join(APP_ROOT_DIR, 'release-manifest.json'),
        path.join(APP_ROOT_DIR, 'build-manifest.json'),
        path.join(APP_ROOT_DIR, 'package.json'),
    ];

    for (const candidate of candidates) {
        const data = await readJsonIfExists(candidate);
        if (!data) continue;

        const appVersion = data.appVersion || data.app_version || data.version || null;
        const builtAt = data.builtAt || data.built_at || null;
        const gitCommit = data.gitCommit || data.git_commit || null;
        const gitBranch = data.gitBranch || data.git_branch || null;

        if (appVersion || builtAt || gitCommit || gitBranch) {
            return {
                app_version: appVersion || (gitCommit ? `build-${gitCommit}` : 'unknown'),
                built_at: builtAt,
                git_commit: gitCommit,
                git_branch: gitBranch,
                source_file: path.basename(candidate),
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

// --- Server Time Endpoint ---
router.get('/server-time', (req, res) => {
    // Mengembalikan waktu server saat ini dalam format UTC ISO 8601
    // Frontend dapat dengan andal membuat objek Date dari string ini.
    res.json({ serverTime: new Date().toISOString() });
});

router.get('/dashboard-summary', async (req, res) => {
    try {
        const settings = await getSettings();
        const timezone = settings.app?.timezone || 'Asia/Jakarta';

        const [
            [customerKpiRows],
            [invoiceKpiRows],
            [userKpiRows],
            [recentTransactionRows],
            routerStatsEnabled,
            activePppoeConnections,
            activeHotspotConnections,
            [activeVoucherRows],
        ] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*) AS totalCustomers,
                    COALESCE(SUM(status = 'Active'), 0) AS activeCustomers,
                    COALESCE(SUM(status = 'Unregister'), 0) AS pendingRegistrations
                FROM customers
            `),
            pool.query(`
                SELECT
                    COALESCE(SUM(status = 'Overdue'), 0) AS overdueCount,
                    COALESCE(SUM(CASE WHEN status = 'Overdue' THEN amount ELSE 0 END), 0) AS overdueAmount,
                    COALESCE(SUM(status = 'Unpaid'), 0) AS unpaidCount,
                    COALESCE(SUM(CASE WHEN status = 'Unpaid' THEN amount ELSE 0 END), 0) AS unpaidAmount
                FROM invoices
            `),
            pool.query(`
                SELECT COUNT(*) AS resellerCount
                FROM users
                WHERE role = 'reseller'
            `),
            pool.query(`
                SELECT
                    cm.*,
                    c.name AS customer_name,
                    u.username AS user_name,
                    cb.username AS created_by_name
                FROM cash_mutations cm
                LEFT JOIN customers c ON c.id = cm.customer_id
                LEFT JOIN users u ON u.id = cm.user_id
                LEFT JOIN users cb ON cb.id = cm.created_by
                ORDER BY cm.date DESC
                LIMIT 15
            `),
            withDashboardTimeout(
                mikrotikApi.testMikrotikConnection().then(() => true),
                false,
                DASHBOARD_ROUTER_TIMEOUT_MS,
                'router connectivity check'
            ),
            withDashboardTimeout(
                mikrotikApi.fetchActivePppoeConnections(),
                [],
                DASHBOARD_ROUTER_TIMEOUT_MS,
                'active PPPoE fetch'
            ),
            withDashboardTimeout(
                mikrotikApi.fetchActiveHotspotConnections(),
                [],
                DASHBOARD_ROUTER_TIMEOUT_MS,
                'active hotspot fetch'
            ),
            pool.query(`
                SELECT username
                FROM hotspot_vouchers
                WHERE status = 'active'
            `),
        ]);

        const cashSummary = await getCashSummary(pool, timezone);
        const [invoiceKpi] = invoiceKpiRows;
        const [customerKpi] = customerKpiRows;
        const [userKpi] = userKpiRows;
        const activeHotspotUsernames = new Set((activeHotspotConnections || []).map((row) => row?.user).filter(Boolean));
        const onlineVouchers = (activeVoucherRows || []).reduce((count, voucher) => {
            if (!voucher?.username) {
                return count;
            }
            if (!routerStatsEnabled) {
                return count + 1;
            }
            return count + (activeHotspotUsernames.has(voucher.username) ? 1 : 0);
        }, 0);

        res.json({
            serverTime: new Date().toISOString(),
            routerStatsEnabled: Boolean(routerStatsEnabled),
            routerStats: {
                pppoeOnline: Number((activePppoeConnections || []).length || 0),
                hotspotOnline: Number((activeHotspotConnections || []).length || 0),
                onlineVouchers: Number(onlineVouchers || 0),
            },
            totals: {
                totalCustomers: Number(customerKpi?.totalCustomers || 0),
                activeCustomers: Number(customerKpi?.activeCustomers || 0),
                pendingRegistrations: Number(customerKpi?.pendingRegistrations || 0),
                revenueThisMonth: Number(cashSummary.currentMonthIn || 0),
                revenueLastMonth: Number(cashSummary.previousMonthIn || 0),
                expenseThisMonth: Number(cashSummary.currentMonthOut || 0),
                cashBalance: Number(cashSummary.balance || 0),
                totalOverdue: {
                    count: Number(invoiceKpi?.overdueCount || 0),
                    amount: Number(invoiceKpi?.overdueAmount || 0),
                },
                totalUnpaid: {
                    count: Number(invoiceKpi?.unpaidCount || 0),
                    amount: Number(invoiceKpi?.unpaidAmount || 0),
                },
                resellerCount: Number(userKpi?.resellerCount || 0),
            },
            recentTransactions: recentTransactionRows.map((row) => ({
                ...row,
                date: dbDateToISO(row.date),
                created_at: dbDateToISO(row.created_at),
            })),
        });
    } catch (error) {
        console.error('[Admin Dashboard] Failed to build summary:', error);
        res.status(500).json({ message: error.message || 'Failed to load dashboard summary.' });
    }
});


// --- User Management ---
router.get('/users', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, username, role, balance, phone FROM users');
        res.json(users);
    } catch (e) {
        res.status(500).json({ message: 'Failed to fetch users.' });
    }
});

router.post('/users', async (req, res) => {
    const { username, password, role, phone } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const newUser = { 
            id: newId, 
            username, 
            password: hashedPassword,
            role, 
            phone: phone || null, 
            balance: role === 'reseller' ? 0 : null 
        };
        await pool.query('INSERT INTO users SET ?', newUser);
        res.status(201).json(newUser);
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: `Username "${username}" already exists.` });
        }
        console.error("Create User Error:", e);
        res.status(500).json({ message: 'Failed to create user.' });
    }
});

router.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username, password, role, phone } = req.body;
    try {
        const fieldsToUpdate = { username, role, phone: phone || null };
        if (password) {
            fieldsToUpdate.password = await bcrypt.hash(password, 10);
        }
        await pool.query('UPDATE users SET ? WHERE id = ?', [fieldsToUpdate, id]);
        res.json({ success: true });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: `Username "${username}" already exists.` });
        }
        console.error("Update User Error:", e);
        res.status(500).json({ message: 'Failed to update user.' });
    }
});

router.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [[user]] = await pool.query('SELECT username FROM users WHERE id = ?', [id]);
        if (user && user.username.toLowerCase() === 'admin') {
            return res.status(403).json({ message: 'Cannot delete the primary admin user.' });
        }
        await pool.query('DELETE FROM users WHERE id = ?', [id]);
        res.status(204).send();
    } catch (e) {
        console.error("Delete User Error:", e);
        res.status(500).json({ message: 'Failed to delete user.' });
    }
});

router.post('/users/:id/add-balance', async (req, res) => {
    const { id } = req.params;
    const { amount } = req.body;
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [[user]] = await connection.query('SELECT balance, phone, username FROM users WHERE id = ? AND role = "reseller" FOR UPDATE', [id]);
        if (!user) {
            throw new Error("Reseller user not found.");
        }

        const currentBalance = Number(user.balance) || 0;
        const newBalance = currentBalance + amount;
        
        const settings = await getSettings();

        const [updateResult] = await connection.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, id]);

        if (updateResult.affectedRows === 0) {
            throw new Error(`Database update failed for user ${id}. The user was found, but their balance was not updated.`);
        }

        await connection.query('INSERT INTO payments SET ?', {
            id: `PAY-TOPUP-${Date.now()}`,
            invoiceId: 'Balance Top Up',
            customerId: null,
            date: toMySQLDatetime(new Date(), settings.app.timezone),
            amount: amount,
            method: 'Admin Grant',
            sold_by_user_id: id
        });

        await connection.commit();

        try {
            // const settings = await getSettings(connection); // Already fetched above
            if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp?.resellerBalanceAdded && user.phone) {
                const message = replacePlaceholders(settings.whatsapp.resellerBalanceAdded, {
                    amountAdded: formatRupiah(amount),
                    newBalance: formatRupiah(newBalance)
                });
                const waResult = await whatsappService.sendMessage(user.phone, message);
                await connection.query('INSERT INTO whatsapp_logs SET ?', {
                    recipient_number: user.phone,
                    customer_id: null,
                    message_body: message,
                    status: waResult.success ? 'sent' : 'failed',
                    type: 'Reseller Balance Top Up',
                    error_message: waResult.error || null
                });
            }
        } catch (notificationError) {
            console.error("Post-commit notification failed, but balance was added successfully. Error:", notificationError);
        }
        
        res.json({ success: true, newBalance });

    } catch (dbError) {
        if (connection) await connection.rollback();
        console.error("Error in add-balance transaction:", dbError);
        res.status(500).json({ message: dbError.message || 'Failed to add balance due to a database error.' });
    } finally {
        if (connection) connection.release();
    }
});


// --- Settings ---
router.get('/settings', async (req, res) => {
    try {
        const settings = await getSettings();
        res.json(settings);
    } catch (e) {
        res.status(500).json({ message: 'Failed to get settings.' });
    }
});

router.put('/settings', async (req, res) => {
    try {
        const newSettings = req.body;
        await pool.query(
            'INSERT INTO settings (settings_key, settings_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE settings_value = ?', 
            ['main', JSON.stringify(newSettings), JSON.stringify(newSettings)]
        );

        try {
            await whatsappService.setStandby(Boolean(newSettings?.whatsapp?.standbyEnabled));
            whatsappService.applySettings(newSettings);
            await whatsappService.ensureInboundTransport(handleWhatsappMessage);
        } catch (waError) {
            console.error("Failed to apply WhatsApp standby setting:", waError);
        }

        // Setelah menyimpan, periksa dan perbarui aturan NAT
        try {
            await mikrotikApi.setupRemoteOntNatRule(newSettings.mikrotik);
        } catch (natError) {
            console.error("Failed to setup NAT rule after saving settings:", natError);
            // Jangan gagalkan seluruh permintaan, cukup kirim peringatan
            return res.json({ success: true, warning: `Settings saved, but failed to configure NAT rule: ${natError.message}` });
        }
        
        res.json({ success: true });
    } catch (e) {
        console.error("Save Settings Error:", e);
        res.status(500).json({ message: 'Failed to save settings.' });
    }
});

router.post('/settings/video-playlist', playlistUpload.single('playlistFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'File playlist belum dipilih.' });
        }

        if (!isValidPlaylistFilename(req.file.originalname)) {
            await fsPromises.unlink(req.file.path).catch(() => undefined);
            return res.status(400).json({ message: 'Format file harus .m3u, .m3u8, atau .txt.' });
        }

        const fileContent = await fsPromises.readFile(req.file.path, 'utf8');
        const playlistCheck = validatePlaylistContent(fileContent);
        if (!playlistCheck.valid) {
            await fsPromises.unlink(req.file.path).catch(() => undefined);
            return res.status(400).json({ message: 'Isi file tidak valid. Playlist harus memiliki baris #EXTINF dan URL stream.' });
        }

        const settings = await getSettings();
        const previousPlaylistUrl = String(settings.video?.playlistUrl || '').trim();

        if (previousPlaylistUrl.startsWith('/uploads/')) {
            const previousFilePath = path.join(UPLOAD_DIR, path.basename(previousPlaylistUrl));
            if (fs.existsSync(previousFilePath)) {
                await fsPromises.unlink(previousFilePath).catch(() => undefined);
            }
        }

        const playlistUrl = `/uploads/${req.file.filename}`;
        settings.video = {
            ...settings.video,
            enabled: true,
            playlistUrl,
            playlistText: '',
        };

        await pool.query('UPDATE settings SET settings_value = ? WHERE settings_key = "main"', [JSON.stringify(settings)]);

        res.json({ success: true, playlistUrl, channelCount: playlistCheck.extinfCount });
    } catch (error) {
        console.error('[Admin Playlist Upload] Failed:', error);
        if (req.file?.path) {
            await fsPromises.unlink(req.file.path).catch(() => undefined);
        }
        res.status(500).json({ message: error.message || 'Gagal upload playlist.' });
    }
});

router.get('/settings/video-playlist/debug', async (req, res) => {
    try {
        const rawUrl = String(req.query.url || '').trim();
        if (!rawUrl) {
            return res.status(400).json({ message: 'URL playlist tidak tersedia.' });
        }

        if (!/^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith('/uploads/')) {
            return res.status(400).json({ message: 'URL harus http(s) atau path /uploads/.' });
        }

        if (rawUrl.startsWith('/uploads/')) {
            const filePath = path.join(UPLOAD_DIR, path.basename(rawUrl));
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ message: 'File upload tidak ditemukan.' });
            }

            const body = await fsPromises.readFile(filePath, 'utf8');
            const playlistCheck = validatePlaylistContent(body);
            return res.json({
                ok: playlistCheck.valid,
                message: playlistCheck.valid ? 'Playlist upload valid.' : 'Playlist upload tidak valid.',
                status: 200,
                finalUrl: rawUrl,
                contentType: 'text/plain; charset=utf-8',
                channelCount: playlistCheck.extinfCount,
                preview: body.slice(0, 1000),
            });
        }

        const { response, body } = await debugPlaylistSource(rawUrl);
        const playlistCheck = validatePlaylistContent(body);
        return res.json({
            ok: response.ok && playlistCheck.valid,
            message: response.ok
                ? (playlistCheck.valid ? 'Playlist URL valid.' : 'Isi URL berhasil diambil tetapi bukan playlist yang valid.')
                : `Gagal mengambil playlist (${response.status})`,
            status: response.status,
            finalUrl: response.url,
            contentType: response.headers.get('content-type') || 'unknown',
            channelCount: playlistCheck.extinfCount,
            preview: body.slice(0, 1000),
        });
    } catch (error) {
        console.error('[Admin Playlist Debug] Failed:', error);
        res.status(500).json({ message: error.message || 'Gagal debug playlist.' });
    }
});

router.get('/settings/video-playlist/export', async (req, res) => {
    try {
        const rawUrl = String(req.query.url || '').trim();
        if (!rawUrl) {
            return res.status(400).json({ message: 'URL playlist tidak tersedia.' });
        }

        let body = '';
        let channelCount = 0;
        let finalUrl = rawUrl;

        if (rawUrl.startsWith('/uploads/')) {
            const filePath = path.join(UPLOAD_DIR, path.basename(rawUrl));
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ message: 'File upload tidak ditemukan.' });
            }
            body = await fsPromises.readFile(filePath, 'utf8');
        } else {
            const debugResult = await debugPlaylistSource(rawUrl);
            body = debugResult.body;
            finalUrl = debugResult.response.url || rawUrl;
        }

        const playlistCheck = validatePlaylistContent(body);
        channelCount = playlistCheck.extinfCount;

        const safeName = `playlist-${Date.now()}.m3u8`;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Playlist-Channel-Count', String(channelCount));
        res.setHeader('X-Playlist-Final-Url', finalUrl);
        return res.send(body);
    } catch (error) {
        console.error('[Admin Playlist Export] Failed:', error);
        res.status(500).json({ message: error.message || 'Gagal export playlist.' });
    }
});

router.delete('/settings/video-playlist', async (req, res) => {
    try {
        const settings = await getSettings();
        const currentPlaylistUrl = String(settings.video?.playlistUrl || '').trim();

        if (!currentPlaylistUrl) {
            return res.status(404).json({ message: 'Tidak ada file playlist aktif untuk dihapus.' });
        }

        if (currentPlaylistUrl.startsWith('/uploads/')) {
            const playlistFilePath = path.join(UPLOAD_DIR, path.basename(currentPlaylistUrl));
            if (fs.existsSync(playlistFilePath)) {
                await fsPromises.unlink(playlistFilePath).catch(() => undefined);
            }
        }

        settings.video = {
            ...settings.video,
            enabled: false,
            playlistUrl: '',
            playlistText: '',
        };

        await pool.query('UPDATE settings SET settings_value = ? WHERE settings_key = "main"', [JSON.stringify(settings)]);

        res.json({ success: true });
    } catch (error) {
        console.error('[Admin Playlist Delete] Failed:', error);
        res.status(500).json({ message: error.message || 'Gagal menghapus playlist.' });
    }
});

router.post('/settings/generate-apikey', async (req, res) => {
    try {
        const newApiKey = uuidv4();
        const settings = await getSettings();
        settings.app.apiKey = newApiKey;
        await pool.query('UPDATE settings SET settings_value = ? WHERE settings_key = "main"', [JSON.stringify(settings)]);
        res.json({ success: true, apiKey: newApiKey });
    } catch (e) {
        res.status(500).json({ message: 'Failed to generate API key.' });
    }
});

router.post('/email/test', async (req, res) => {
    const { to } = req.body || {};
    try {
        const settings = await getSettings();
        await sendTestEmail({ settings, to });
        res.json({ success: true, message: `Test email sent to ${to}.` });
    } catch (error) {
        console.error('[Email Test] Failed to send test email:', error);
        res.status(500).json({ message: error.message || 'Failed to send test email.' });
    }
});

router.get('/digiflazz/ping', async (req, res) => {
    try {
        const ping = getLastDigiflazzPing();
        res.json({ ping: ping || null });
    } catch (error) {
        console.error('[Admin Digiflazz Ping] Failed to read ping state:', error);
        res.status(500).json({ message: 'Failed to retrieve Digiflazz ping.' });
    }
});

router.post('/digiflazz/ping', async (req, res) => {
    try {
        const settings = await getSettings();
        const digiflazz = settings.digiflazz || {};
        const hookId = digiflazz.hookId || process.env.DIGIFLAZZ_WEBHOOK_ID;
        const username = (digiflazz.username || process.env.DIGIFLAZZ_USERNAME || '').trim();
        const apiKey = (digiflazz.apiKey || process.env.DIGIFLAZZ_API_KEY || '').trim();

        if (!hookId) {
            return res.status(400).json({ message: 'Digiflazz hook ID belum dikonfigurasi.' });
        }
        if (!username || !apiKey) {
            return res.status(400).json({ message: 'Kredensial Digiflazz belum lengkap.' });
        }

        const pingUrl = `https://api.digiflazz.com/v1/report/hooks/${hookId}/pings`;
        const response = await fetch(pingUrl, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
            },
        });
        const text = await response.text();
        let payload;
        try {
            payload = text ? JSON.parse(text) : {};
        } catch (err) {
            payload = {};
        }
        if (!response.ok) {
            throw new Error(payload.message || 'Gagal memicu ping ke Digiflazz.');
        }

        const ping = getLastDigiflazzPing();
        res.json({
            success: true,
            message: payload.message || 'Ping Digiflazz berhasil dikirim.',
            remote: payload,
            ping: ping || null,
        });
    } catch (error) {
        console.error('[Admin Digiflazz Ping] Failed to request ping:', error);
        res.status(500).json({ message: error.message || 'Gagal menjalankan ping Digiflazz.' });
    }
});


// --- Mikrotik Test ---
router.post('/mikrotik/test-connection', async (req, res) => {
    try {
        await mikrotikApi.testMikrotikConnection();
        res.json({ success: true, message: "Connection successful!" });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- OLT SSH Placeholder Endpoints ---
router.post('/olt/test', async (req, res) => {
    console.log('[OLT Test] Incoming test request');
    try {
        const settings = await getSettings();
        const devices = settings?.olt?.devices || [];
        console.log(`[OLT Test] Loaded ${devices.length} OLT device(s) from settings`);
        if (devices.length === 0) {
            return res.status(400).json({ success: false, message: 'Belum ada OLT yang disimpan.' });
        }

        const results = [];
        for (let idx = 0; idx < devices.length; idx += 1) {
            const d = devices[idx];
            console.log(`[OLT Test] Device #${idx + 1}`, {
                name: d.name,
                host: d.host,
                port: d.port,
                username: d.username,
                model: d.model,
                connectionType: d.connectionType || 'ssh',
            });
            const profile = getDeviceProfileByModel(d.model || '');
            console.log(`[OLT Test] Profile for model "${d.model}":`, profile ? profile.id : 'not found');
            if (isSnmpEnabledForDevice(d)) {
                try {
                    const info = await readSnmpSystemInfo(d);
                    results.push({
                        name: d.name || d.host,
                        source: 'snmp',
                        success: true,
                        product: info.sysDescr || null,
                    });
                } catch (snmpError) {
                    results.push({
                        name: d.name || d.host,
                        source: 'snmp',
                        success: false,
                        error: snmpError?.message || String(snmpError),
                    });
                }
            }
        }

        return res.json({
            success: true,
            message: `Config OLT terbaca (${devices.length} device). Lihat log backend untuk detail.`,
            devicesCount: devices.length,
            snmpResults: results,
        });
    } catch (err) {
        console.error('[OLT Test] Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// --- WhatsApp Routes ---
router.get('/whatsapp/status', (req, res) => res.json(whatsappService.getStatus()));
router.get('/whatsapp/qr', (req, res) => res.json(whatsappService.getQrCode()));
router.post('/whatsapp/connect', async (req, res) => {
    try {
        const settings = await getSettings();
        const requestedMode = String(req.body?.deliveryMode || settings?.whatsapp?.deliveryMode || 'baileys').toLowerCase();
        const normalizedMode = requestedMode === 'wa' ? 'fonnte' : requestedMode;

        if (normalizedMode !== 'baileys') {
            return res.status(400).json({ success: false, message: 'Baileys connection can only be requested when delivery mode is Baileys.' });
        }

        whatsappService.applySettings({
            ...settings,
            whatsapp: {
                ...settings.whatsapp,
                deliveryMode: 'baileys',
                standbyEnabled: false,
            },
        });

        const result = await whatsappService.requestBaileysConnection(handleWhatsappMessage);
        if (result?.mode !== 'baileys') {
            return res.status(500).json({ success: false, message: 'Failed to start Baileys connection.' });
        }

        res.json({ success: true, message: 'Baileys connection requested.' });
    } catch (e) {
        console.error('[WhatsApp] Failed to request Baileys connection:', e);
        res.status(500).json({ success: false, message: 'Failed to request Baileys connection.' });
    }
});
router.post('/whatsapp/logout', async (req, res) => {
    try {
        await whatsappService.logout();
        res.json({ success: true, message: "Logged out successfully." });
    } catch (e) {
        res.status(500).json({ message: 'Logout failed.' });
    }
});

const normalizeDigits = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('62')) return digits;
    if (digits.startsWith('0')) return `62${digits.slice(1)}`;
    if (digits.startsWith('8')) return `62${digits}`;
    return digits;
};

const messageBelongsToConversation = (message, conversation, ownPhoneNumber = '') => {
    const conversationId = String(conversation?.id || '').trim();
    const conversationPhone = normalizeDigits(conversation?.phoneNumber || conversation?.phone || '');
    const ownDigits = normalizeDigits(ownPhoneNumber);
    const messageConversationId = String(
        message?.conversationId ||
        message?.conversation_id ||
        message?.conversation?.id ||
        message?.thread_id ||
        message?.chat_id ||
        ''
    ).trim();

    if (conversationId && messageConversationId && messageConversationId === conversationId) {
        return true;
    }

    const candidateNumbers = [
        message?.from,
        message?.to,
        message?.contactPhone,
        message?.contact_phone,
        message?.senderPhone,
        message?.recipientPhone,
    ].map(normalizeDigits).filter(Boolean);

    if (conversationPhone && candidateNumbers.includes(conversationPhone)) {
        return true;
    }

    if (conversationPhone && ownDigits) {
        const counterpart = candidateNumbers.find((number) => number !== ownDigits);
        if (counterpart && counterpart === conversationPhone) {
            return true;
        }
    }

    return false;
};

router.get('/whatsapp/kirimdev/chat', async (req, res) => {
    try {
        const settings = await getSettings();
        whatsappService.applySettings(settings);

        const gateway = settings?.whatsapp?.customGateway || {};
        if (!String(gateway.apiKey || '').trim()) {
            return res.status(400).json({ message: 'Kirimdev API key is not configured.' });
        }

        const conversationId = String(req.query.conversationId || '').trim();
        const messageCursor = String(req.query.messageCursor || req.query.cursor || '').trim();
        const conversationLimit = Number(req.query.conversationLimit ?? 50) || 50;
        const messageLimit = Number(req.query.messageLimit ?? 100) || 100;

        const inbox = await whatsappService.listKirimdevConversations(gateway, {
            limit: conversationLimit,
        });
        const messagesFeed = await whatsappService.listKirimdevMessages(gateway, {
            limit: messageLimit,
            phoneNumberId: inbox.phoneNumberId,
            cursor: messageCursor || undefined,
        });

        const selectedConversation = conversationId
            ? inbox.conversations.find((conversation) => conversation.id === conversationId)
                || (await whatsappService.fetchKirimdevConversation(gateway, conversationId, { phoneNumberId: inbox.phoneNumberId })).conversation
            : inbox.conversations[0] || null;

        const selectedMessages = selectedConversation
            ? messagesFeed.messages.filter((message) => messageBelongsToConversation(message, selectedConversation, inbox.phoneNumberId))
            : [];

        selectedMessages.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
        inbox.conversations.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

        res.json({
            success: true,
            phoneNumberId: inbox.phoneNumberId,
            conversations: inbox.conversations,
            selectedConversation,
            messages: selectedMessages,
            meta: {
                conversations: inbox.meta,
                messages: messagesFeed.meta,
            },
        });
    } catch (error) {
        console.error('[Kirimdev Chat] Failed to load inbox:', error);
        res.status(500).json({ message: error.message || 'Failed to load Kirimdev chat inbox.' });
    }
});

router.post('/whatsapp/kirimdev/chat/reply', async (req, res) => {
    try {
        const { conversationId, phoneNumber, message } = req.body || {};
        if (!String(message || '').trim()) {
            return res.status(400).json({ message: 'Message is required.' });
        }

        const settings = await getSettings();
        whatsappService.applySettings(settings);

        const targetPhone = String(phoneNumber || '').trim();
        if (!targetPhone) {
            return res.status(400).json({ message: 'Phone number is required.' });
        }

        const result = await whatsappService.sendMessage(targetPhone, message);
        if (!result.success) {
            return res.status(500).json({ success: false, message: result.error || 'Failed to send message.' });
        }

        res.json({
            success: true,
            message: 'Reply sent successfully.',
            conversationId: conversationId || null,
            transport: result.transport || 'custom',
        });
    } catch (error) {
        console.error('[Kirimdev Chat] Failed to send reply:', error);
        res.status(500).json({ message: error.message || 'Failed to send reply.' });
    }
});

router.post('/whatsapp/test-message', async (req, res) => {
    const { phoneNumber, message } = req.body;
    try {
        const settings = await getSettings();
        whatsappService.applySettings(settings);
    } catch (settingsError) {
        console.warn('[WhatsApp Test] Failed to refresh settings before test send:', settingsError);
    }

    const normalizedRecipient = String(phoneNumber || '').trim();
    const testMessage = String(message || '').trim();
    const logId = await insertWhatsAppLog({
        recipient_number: normalizedRecipient,
        customer_id: null,
        message_body: testMessage,
        status: 'queued',
        type: 'Test Message',
        error_message: null,
        transport: null,
    });

    const result = await whatsappService.sendMessage(normalizedRecipient, testMessage);
    if (result.success) {
        await updateWhatsAppLogById(logId, {
            status: 'sent',
            error_message: null,
            transport: result.transport || null,
            provider_message_id: result.providerMessageId || null,
            sent_at: new Date(),
            updated_at: new Date(),
        });

        res.json({
            success: true,
            message: result.transport === 'custom'
                ? (result.messageKind === 'template'
                    ? 'Test message sent via Kirimdev template fallback.'
                    : 'Test message queued via Kirimdev.')
                : 'Test message sent via WhatsApp Web.',
            transport: result.transport || 'unknown',
            messageKind: result.messageKind || 'text',
            fallbackUsed: Boolean(result.fallbackUsed),
            recipient: normalizedRecipient,
            gatewayMessage: result.gatewayMessage || null,
            providerMessageId: result.providerMessageId || null,
            logId,
        });
    } else {
        await updateWhatsAppLogById(logId, {
            status: 'failed',
            error_message: result.error || 'Failed to send test message.',
            transport: result.transport || null,
            updated_at: new Date(),
        });

        res.status(500).json({ success: false, message: result.error });
    }
});

router.get('/whatsapp/logs', async (req, res) => {
    try {
        const [logs] = await pool.query('SELECT * FROM whatsapp_logs ORDER BY created_at DESC LIMIT 100');
        const formattedLogs = logs.map(log => ({
            ...log,
            created_at: dbDateToISO(log.created_at)
        }));
        res.json(formattedLogs);
    } catch (e) {
        res.status(500).json({ message: "Failed to fetch logs." });
    }
});

router.post('/whatsapp/broadcast', async (req, res) => {
    const { filter, message, delayMode, delayStartMs, delayIncrementMs, delayMaxMs, delayStepEvery, delayRandomJitterMs } = req.body;
    try {
        const settings = await getSettings();
        whatsappService.applySettings(settings);
        const tz = settings.app.timezone;
        const delayProfile = getBroadcastDelayProfile(settings, {
            delayMode,
            delayStartMs,
            delayIncrementMs,
            delayMaxMs,
            delayStepEvery,
            delayRandomJitterMs,
        });
        let query = 'SELECT c.phone, c.name, c.id, p.name as packageName FROM customers c LEFT JOIN packages p ON c.packageId = p.id WHERE c.phone IS NOT NULL AND c.phone != ""';
        const queryParams = [];

        if (['all', 'Active', 'Suspended', 'Inactive', 'Unregister'].includes(filter)) {
            if (filter !== 'all') {
                query += ` AND c.status = ?`;
                queryParams.push(filter);
            }
        } else {
            // Assume it's an ODP ID
            query += ` AND c.odpId = ?`;
            queryParams.push(filter);
        }

        const [customers] = await pool.query(query, queryParams);

        if (customers.length === 0) {
            return res.json({ success: true, message: `No customers found for the selected target. No messages sent.` });
        }

        let sentCount = 0;
        for (const [index, customer] of customers.entries()) {
            const personalizedMessage = replacePlaceholders(message, { 
                customerName: customer.name, 
                customerId: customer.id,
                packageName: customer.packageName || 'N/A'
            });
            const logId = await insertWhatsAppLog({
                recipient_number: customer.phone,
                customer_id: customer.id,
                message_body: personalizedMessage,
                status: 'queued',
                type: 'Broadcast Message',
                error_message: null,
                created_at: toMySQLDatetime(new Date(), tz),
            });

            const result = await sendOutboundWhatsAppMessage(settings, customer.phone, personalizedMessage);

            await updateWhatsAppLogById(logId, {
                status: result.success ? 'sent' : 'failed',
                error_message: result.error || null,
                transport: result.transport || null,
                provider_message_id: result.providerMessageId || null,
                sent_at: result.success ? new Date() : null,
                updated_at: new Date(),
            });

            if(result.success) sentCount++;
            if (index < customers.length - 1) {
                const waitMs = computeBroadcastDelay(index, delayProfile);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
        res.json({
            success: true,
            message: `Broadcast sent to ${sentCount} out of ${customers.length} targeted customers.`,
            delayProfile: {
                mode: delayProfile.mode,
                startMs: delayProfile.startMs,
                incrementMs: delayProfile.incrementMs,
                maxMs: delayProfile.maxMs,
                stepEvery: delayProfile.stepEvery,
                randomJitterMs: delayProfile.randomJitterMs,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/whatsapp/resend', async (req, res) => {
    const { logIds } = req.body;
    try {
        const settings = await getSettings();
        const tz = settings.app.timezone;
        const delayProfile = getBroadcastDelayProfile(settings);
        const [logs] = await pool.query('SELECT * FROM whatsapp_logs WHERE id IN (?)', [logIds]);
        for (let index = 0; index < logs.length; index++) {
            const log = logs[index];
            const resendLogId = await insertWhatsAppLog({
                recipient_number: log.recipient_number,
                customer_id: log.customer_id,
                message_body: log.message_body,
                status: 'queued',
                type: `Resend: ${log.type}`,
                error_message: null,
                created_at: toMySQLDatetime(new Date(), tz),
            });

            const result = await sendOutboundWhatsAppMessage(settings, log.recipient_number, log.message_body);

            await updateWhatsAppLogById(resendLogId, {
                status: result.success ? 'sent' : 'failed',
                error_message: result.error || null,
                transport: result.transport || null,
                provider_message_id: result.providerMessageId || null,
                sent_at: result.success ? new Date() : null,
                updated_at: new Date(),
            });

            if (index < logs.length - 1) {
                const waitMs = computeBroadcastDelay(index, delayProfile);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
        res.json({
            success: true,
            message: `Resent ${logs.length} message(s).`,
            delayProfile,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post('/whatsapp/logs/delete', async (req, res) => {
    const { logIds } = req.body;
    try {
        await pool.query('DELETE FROM whatsapp_logs WHERE id IN (?)', [logIds]);
        res.json({ success: true, message: `Deleted ${logIds.length} log(s).` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- Admin Notification Center ---
router.get('/notifications', async (req, res) => {
    try {
        // Ambil 20 notifikasi terbaru, dan hitung yang belum dibaca
        const [notifications] = await pool.query('SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 20');
        const [[{ unread_count }]] = await pool.query('SELECT COUNT(*) as unread_count FROM admin_notifications WHERE is_read = FALSE');
        res.json({ notifications, unread_count });
    } catch (e) {
        console.error("Error fetching admin notifications:", e);
        res.status(500).json({ message: 'Failed to fetch notifications.' });
    }
});

router.post('/notifications/mark-read', async (req, res) => {
    try {
        await pool.query('UPDATE admin_notifications SET is_read = TRUE WHERE is_read = FALSE');
        res.json({ success: true });
    } catch (e) {
        console.error("Error marking notifications as read:", e);
        res.status(500).json({ message: 'Failed to mark notifications as read.' });
    }
});

router.post('/notifications', async (req, res) => {
    const { type, message, key } = req.body;

    if (!type || !message) {
        return res.status(400).json({ message: 'Notification type and message are required.' });
    }

    try {
        const hasKeyColumn = await ensureAdminNotificationsKeyColumn();
        // De-duplication logic: check for a recent similar notification
        if (key && hasKeyColumn) {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const [[existing]] = await pool.query(
                'SELECT id FROM admin_notifications WHERE `key` = ? AND created_at > ?',
                [key, fiveMinutesAgo]
            );
            if (existing) {
                // A recent notification with the same key exists. Don't create a new one.
                return res.status(200).json({ success: true, message: 'A recent notification with this key already exists.' });
            }
        } else if (key && !hasKeyColumn) {
            console.warn("admin_notifications.key column missing; skipping de-dup check.");
        }

        const newNotification = {
            type,
            message,
            is_read: false,
        };
        if (key && hasKeyColumn) {
            newNotification.key = key;
        }
        await pool.query('INSERT INTO admin_notifications SET ?', newNotification);

        res.status(201).json({ success: true, message: 'Notification created.' });

    } catch (e) {
        console.error("Error creating admin notification:", e);
        res.status(500).json({ message: 'Failed to create notification.' });
    }
});


// --- Chatbot Status ---
router.get('/chatbot-status', async (req, res) => {
    try {
        const settings = await getSettings();
        const apiKey = String(settings.gemini?.apiKey || '').trim();
        const enabled = Boolean(settings.gemini?.enabled);

        res.json({
            configured: Boolean(apiKey),
            enabled,
            apiKeyPresent: Boolean(apiKey),
        });
    } catch (error) {
        console.error('[Admin Chatbot Status] Failed to read Gemini settings:', error);
        res.status(500).json({ configured: false, enabled: false });
    }
});

// --- Database Backup & Restore ---
router.get('/database/backup', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { DB_USER, DB_PASSWORD, DB_NAME, DB_HOST } = process.env;
    const requestedExt = typeof req.query.ext === 'string' ? req.query.ext.trim() : '';
    const cleanedExt = requestedExt.replace(/[^a-zA-Z0-9.]/g, '');
    const extension = cleanedExt ? (cleanedExt.startsWith('.') ? cleanedExt : `.${cleanedExt}`) : '.sql';
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `backup-${DB_NAME}-${date}${extension}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    const mysqldumpBin = resolveMysqlBinary('mysqldump', 'mariadb-dump');
    const dumpArgs = [
        `--host=${DB_HOST || 'localhost'}`,
        `--user=${DB_USER || 'root'}`,
        '--single-transaction',
        '--routines',
        '--events',
        '--triggers',
        '--hex-blob',
        `--result-file=${filePath}`,
        DB_NAME,
    ];

    if (DB_PASSWORD) {
        dumpArgs.splice(2, 0, `--password=${DB_PASSWORD}`);
    }

    let responded = false;
    const sendError = (statusCode, payload) => {
        if (responded || res.headersSent) {
            return;
        }
        responded = true;
        res.status(statusCode).json(payload);
    };

    const child = spawn(mysqldumpBin, dumpArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
        console.error('Backup spawn error:', error);
        if (error.code === 'ENOENT') {
            return sendError(500, {
                message: 'Database client binary not found. Install mysqldump or mariadb-dump in the runtime image.',
                error: error.message,
            });
        }

        return sendError(500, {
            message: 'Failed to create database backup.',
            error: error.message,
        });
    });

    child.on('close', (code, signal) => {
        if (responded || res.headersSent) {
            return;
        }
        if (code !== 0) {
            console.error(`Backup process exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
            return sendError(500, {
                message: 'Failed to create database backup.',
                error: stderr || `mysqldump exited with code ${code}`,
            });
        }

        responded = true;
        res.download(filePath, fileName, (err) => {
            if (err) {
                console.error('Download error:', err);
            }
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Failed to delete temp backup file:', unlinkErr);
            });
        });
    });
});

router.get('/database/restore/jobs/active', async (req, res) => {
    try {
        const job = await getActiveDatabaseRestoreJob();
        if (!job) {
            return res.json({ success: true, job: null });
        }

        return res.json({ success: true, job: formatDatabaseRestoreJob(job) });
    } catch (error) {
        console.error('[Database Restore] Error fetching active job:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch active database restore job.',
        });
    }
});

router.get('/database/restore/jobs/:jobId', async (req, res) => {
    try {
        const job = await getDatabaseRestoreJobById(req.params.jobId);
        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Database restore job not found.',
            });
        }

        return res.json({ success: true, job: formatDatabaseRestoreJob(job) });
    } catch (error) {
        console.error('[Database Restore] Error fetching job status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch database restore job status.',
        });
    }
});

router.post('/database/restore', upload.single('backup'), async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const backupFile = req.file;
    if (!backupFile) {
        return res.status(400).json({ message: 'No backup file uploaded.' });
    }

    try {
        const activeJob = await getActiveDatabaseRestoreJob();
        if (activeJob) {
            fs.unlink(backupFile.path, () => {});
            return res.status(409).json({
                success: false,
                message: 'Database restore job is already running.',
                job: formatDatabaseRestoreJob(activeJob),
            });
        }

        const job = await createDatabaseRestoreJob({
            backupPath: backupFile.path,
            originalFilename: backupFile.originalname,
        });

        setImmediate(() => {
            processDatabaseRestoreQueue().catch((error) => {
                console.error('[Database Restore] Error while starting queued job:', error);
            });
        });

        return res.status(202).json({
            success: true,
            started: true,
            message: 'Database restore job queued and will run in the background.',
            job: formatDatabaseRestoreJob(job),
        });
    } catch (error) {
        console.error('[Database Restore] Fatal error while enqueueing restore job:', error);
        fs.unlink(backupFile.path, () => {});
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to enqueue database restore job.',
        });
    }
});

router.post('/database/restore/jobs/:jobId/cancel', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    try {
        const job = await getDatabaseRestoreJobById(req.params.jobId);
        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Database restore job not found.',
            });
        }

        if (![DATABASE_RESTORE_JOB_STATUSES.QUEUED, DATABASE_RESTORE_JOB_STATUSES.RUNNING].includes(job.status)) {
            return res.status(409).json({
                success: false,
                message: `Restore job cannot be canceled from status '${job.status}'.`,
                job: formatDatabaseRestoreJob(job),
            });
        }

        await updateDatabaseRestoreJob(job.id, {
            status: DATABASE_RESTORE_JOB_STATUSES.CANCELED,
            message: 'Restore canceled by admin.',
            error_message: null,
            finished_at: new Date(),
            worker_pid: null,
            updated_at: new Date(),
        });

        const terminated = cancelDatabaseRestoreWorker(job.worker_pid);
        if (job.backup_path) {
            fs.unlink(job.backup_path, () => {});
        }

        return res.json({
            success: true,
            message: terminated
                ? 'Restore job canceled and worker terminated.'
                : 'Restore job canceled.',
            job: formatDatabaseRestoreJob(await getDatabaseRestoreJobById(job.id)),
        });
    } catch (error) {
        console.error('[Database Restore] Failed to cancel restore job:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to cancel database restore job.',
        });
    }
});

router.get('/app-update/status', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    try {
        const { response, data } = await callAppUpdateService('GET', '/status');
        const localBuildInfo = await resolveLocalAppBuildInfo();
        return res.status(200).json({
            ...data,
            success: response.ok,
            service_available: response.ok,
            build: data?.build || localBuildInfo,
        });
    } catch (error) {
        console.error('[App Update] Failed to fetch update status:', error);
        return res.status(200).json({
            success: false,
            service_available: false,
            message: error.message || 'Failed to fetch application update status.',
            job: null,
            build: await resolveLocalAppBuildInfo(),
        });
    }
});

router.post('/app-update', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    try {
        const { response, data } = await callAppUpdateService('POST', '/update');
        const localBuildInfo = await resolveLocalAppBuildInfo();
        return res.status(response.status).json({
            ...data,
            service_available: response.ok,
            build: data?.build || localBuildInfo,
        });
    } catch (error) {
        console.error('[App Update] Failed to start application update:', error);
        return res.status(503).json({
            success: false,
            service_available: false,
            message: error.message || 'Failed to start application update.',
            build: await resolveLocalAppBuildInfo(),
        });
    }
});


// --- Reports ---
router.get('/reports', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Start date and end date are required.' });
        }
        const fullEndDate = `${endDate} 23:59:59`;
        
        const [[kpiResult]] = await pool.query(`
            SELECT
                (SELECT SUM(amount) FROM payments WHERE date >= ? AND date <= ?) as totalRevenue,
                (SELECT COUNT(id) FROM customers WHERE activeDate >= ? AND activeDate <= ?) as newCustomers,
                (SELECT COUNT(id) FROM customers WHERE status = 'Active') as activeCustomers,
                (SELECT COUNT(id) FROM customers WHERE status = 'Inactive') as deactivatedCustomers,
                (SELECT COUNT(id) FROM invoices WHERE status IN ('Unpaid', 'Overdue')) as unpaidCount,
                (SELECT SUM(amount) FROM invoices WHERE status IN ('Unpaid', 'Overdue')) as unpaidAmount
        `, [startDate, fullEndDate, startDate, fullEndDate]);

        const [monthlyRevenue] = await pool.query(`
            SELECT DATE_FORMAT(date, '%Y-%m') as month, SUM(amount) as total 
            FROM payments 
            WHERE date >= ? AND date <= ?
            GROUP BY month ORDER BY month ASC
        `, [startDate, fullEndDate]);
        
        const [newCustomersByMonth] = await pool.query(`
            SELECT DATE_FORMAT(activeDate, '%Y-%m') as month, COUNT(id) as count 
            FROM customers 
            WHERE activeDate >= ? AND activeDate <= ?
            GROUP BY month ORDER BY month ASC
        `, [startDate, fullEndDate]);

        const [packagePopularity] = await pool.query(`
            SELECT p.name, COUNT(c.id) as customerCount 
            FROM packages p 
            JOIN customers c ON p.id = c.packageId 
            WHERE c.status = 'Active'
            GROUP BY p.name ORDER BY customerCount DESC
        `);

        const [resellerLeaderboard] = await pool.query(`
            SELECT 
                p.sold_by_user_id as resellerId,
                u.username as resellerName,
                COUNT(p.id) as vouchersSold,
                SUM(p.amount) as totalSales,
                SUM(p.amount - IFNULL(hp.price, 0)) as totalProfit
            FROM payments p
            JOIN users u ON p.sold_by_user_id = u.id
            LEFT JOIN hotspot_vouchers hv ON p.invoiceId = CONCAT('Voucher: ', hv.username)
            LEFT JOIN hotspot_profiles hp ON hv.profile = hp.name
            WHERE p.date >= ? AND date <= ? AND u.role = 'reseller' AND p.invoiceId LIKE 'Voucher:%'
            GROUP BY p.sold_by_user_id, u.username
            ORDER BY totalProfit DESC
        `, [startDate, fullEndDate]);

        res.json({
            kpi: {
                totalRevenue: kpiResult.totalRevenue || 0,
                newCustomers: kpiResult.newCustomers || 0,
                activeCustomers: kpiResult.activeCustomers || 0,
                deactivatedCustomers: kpiResult.deactivatedCustomers || 0,
                unpaidInvoices: {
                    count: kpiResult.unpaidCount || 0,
                    amount: kpiResult.unpaidAmount || 0,
                }
            },
            charts: {
                monthlyRevenue,
                newCustomersByMonth,
            },
            tables: {
                packagePopularity,
                resellerLeaderboard,
            }
        });
    } catch (e) {
        console.error("Report Generation Error:", e);
        res.status(500).json({ message: e.message || "Failed to generate reports." });
    }
});

// NEW: Endpoint for fetching detailed reseller sales
router.get('/reports/reseller-sales', async (req, res) => {
    const { resellerId, startDate, endDate } = req.query;
    if (!resellerId || !startDate || !endDate) {
        return res.status(400).json({ message: 'Reseller ID and date range are required.' });
    }
    const fullEndDate = `${endDate} 23:59:59`;

    try {
        const [salesDetails] = await pool.query(`
            SELECT 
                p.date as saleDate,
                p.amount as sellingPrice,
                hv.username,
                hv.profile,
                hp.price as basePrice,
                (p.amount - IFNULL(hp.price, 0)) as profit
            FROM payments p
            LEFT JOIN hotspot_vouchers hv ON p.invoiceId = CONCAT('Voucher: ', hv.username)
            LEFT JOIN hotspot_profiles hp ON hv.profile = hp.name
            WHERE p.sold_by_user_id = ?
              AND p.date >= ? AND p.date <= ?
              AND p.invoiceId LIKE 'Voucher:%'
            ORDER BY p.date DESC
        `, [resellerId, startDate, fullEndDate]);
        
        const formattedSalesDetails = salesDetails.map(sale => ({
            ...sale,
            saleDate: dbDateToISO(sale.saleDate)
        }));

        res.json(formattedSalesDetails);
    } catch (e) {
        console.error("Reseller Sales Detail Error:", e);
        res.status(500).json({ message: e.message || "Failed to fetch reseller sales details." });
    }
});

// NEW: Endpoint for deleting pending/failed top-up requests
router.post('/topup-requests/bulk-delete', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of top-up request IDs is required.' });
    }
    try {
        // Safety check: Only allow deletion of 'pending' or 'failed' requests.
        const [result] = await pool.query(
            "DELETE FROM topup_requests WHERE id IN (?) AND status IN ('pending', 'failed')", 
            [ids]
        );
        if (result.affectedRows === 0) {
            console.warn(`[Top-Up Delete] Request to delete ${ids.length} requests, but none were found in a deletable state (pending/failed).`);
        }
        res.json({ success: true, message: `${result.affectedRows} top-up request(s) deleted successfully.` });
    } catch (e) {
        console.error("Error during bulk top-up request deletion:", e);
        res.status(500).json({ message: 'An error occurred while deleting top-up requests.' });
    }
});

router.post('/debug/fix-ppob-table', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    
    let connection;
    const logs = [];

    try {
        connection = await pool.getConnection();
        logs.push("Successfully connected to the database.");

        const tableName = 'ppob_transactions';
        const newColumnName = 'customer_id';
        const oldColumnName = 'user_id';

        const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
        
        const hasCustomerId = columns.some(c => c.Field === newColumnName);
        const hasUserId = columns.some(c => c.Field === oldColumnName);

        logs.push(`Inspecting table '${tableName}': has '${newColumnName}' column: ${hasCustomerId}, has '${oldColumnName}' column: ${hasUserId}.`);

        if (hasUserId && !hasCustomerId) {
            logs.push(`Action: Renaming column '${oldColumnName}' to '${newColumnName}'.`);
            await connection.query(`ALTER TABLE \`${tableName}\` CHANGE COLUMN \`${oldColumnName}\` \`${newColumnName}\` VARCHAR(255) NOT NULL`);
            logs.push("Rename successful.");
        } else if (hasCustomerId) {
            logs.push("Action: Column 'customer_id' already exists. No rename needed.");
            // Optional: check if it's NOT NULL and fix it if needed
            const customerIdColumn = columns.find(c => c.Field === newColumnName);
            if (customerIdColumn.Null === 'YES') {
                logs.push(`Action: Column '${newColumnName}' is nullable. Changing to NOT NULL.`);
                await connection.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${newColumnName}\` VARCHAR(255) NOT NULL`);
                logs.push("Modification to NOT NULL successful.");
            }
        } else {
            logs.push("Warning: Neither 'customer_id' nor 'user_id' column found. Attempting to add 'customer_id'.");
            await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${newColumnName}\` VARCHAR(255) NOT NULL`);
            logs.push("Action: Added 'customer_id' column successfully.");
        }

        // Also check and drop the old foreign key if it exists
        const [[oldFk]] = await connection.query(
            `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = 'users'`,
            [tableName, hasUserId ? oldColumnName : newColumnName]
        );
        if(oldFk) {
             logs.push(`Found old foreign key '${oldFk.CONSTRAINT_NAME}' linking to 'users' table. Dropping it.`);
             await connection.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${oldFk.CONSTRAINT_NAME}\``);
             logs.push(`Old foreign key dropped.`);
        }


        res.json({ success: true, message: "Database check/fix complete. See logs for details.", logs });

    } catch (error) {
        logs.push(`ERROR: ${error.message}`);
        console.error("Error fixing PPOB table:", error);
        res.status(500).json({ success: false, message: 'An error occurred during the database fix.', logs });
    } finally {
        if (connection) connection.release();
    }
});

router.get('/debug/suspension-audit', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }

    try {
        const settings = await getSettings();
        const tz = settings.app.timezone || 'Asia/Jakarta';
        const today = typeof req.query.date === 'string' && req.query.date.trim()
            ? req.query.date.trim()
            : dateToYMD(new Date(), tz);
        const customerIdFilter = typeof req.query.customerId === 'string' && req.query.customerId.trim()
            ? req.query.customerId.trim()
            : null;

        const [flags] = await pool.query(
            `SELECT flag, date_value
             FROM system_flags
             WHERE flag = 'daily_suspension_check' AND date_value = ?`,
            [today]
        );

        const query = `
            SELECT
                i.id AS invoiceId,
                i.customerId,
                i.status AS invoiceStatus,
                i.amount,
                i.billingPeriodStart,
                i.billingPeriodEnd,
                i.dueDate,
                c.name AS customerName,
                c.status AS customerStatus,
                c.billing_type,
                c.pppoeUsername,
                c.previousPppoeProfile,
                p.name AS packageName
            FROM invoices i
            JOIN customers c ON c.id = i.customerId
            LEFT JOIN packages p ON p.id = c.packageId
            WHERE i.status = 'Overdue'
              AND (? IS NULL OR c.id = ?)
            ORDER BY c.id ASC, i.dueDate DESC
        `;

        const [rows] = await pool.query(query, [customerIdFilter, customerIdFilter]);
        const latestOverdueByCustomer = new Map();
        const currentMonthKey = today.slice(0, 7);

        for (const row of rows) {
            const dueDateObj = parseLocalDateString(row.dueDate);
            if (!dueDateObj) continue;
            if (dateToYMD(dueDateObj, tz).slice(0, 7) !== currentMonthKey) continue;

            const existingOverdue = latestOverdueByCustomer.get(row.customerId);
            if (!existingOverdue) {
                latestOverdueByCustomer.set(row.customerId, row);
                continue;
            }

            const existingOverdueDueDate = parseLocalDateString(existingOverdue.dueDate);
            if (!existingOverdueDueDate || dueDateObj > existingOverdueDueDate) {
                latestOverdueByCustomer.set(row.customerId, row);
            }
        }

        const results = Array.from(latestOverdueByCustomer.values()).map((row) => {
            if (!row) return null;

            const dueDateObj = parseLocalDateString(row.dueDate);
            const suspendDays = settings.billing.suspensionDays || 0;
            const suspendDate = dueDateObj ? new Date(dueDateObj) : null;
            if (suspendDate) {
                suspendDate.setDate(suspendDate.getDate() + suspendDays);
            }

            const suspendDateStr = suspendDate ? dateToYMD(suspendDate, tz) : null;
            const eligibleToday = Boolean(suspendDateStr && today >= suspendDateStr);

            let auditStatus = 'not_due_yet';
            let reason = 'Suspend date has not been reached yet.';

            if (eligibleToday && row.customerStatus === 'Suspended') {
                auditStatus = 'already_suspended';
                reason = 'Customer status is already Suspended.';
            } else if (eligibleToday && row.invoiceStatus === 'Overdue') {
                auditStatus = row.customerStatus === 'Active' ? 'eligible_but_active' : 'eligible_pending_review';
                reason = row.customerStatus === 'Active'
                    ? 'Customer is still Active even though the current-month overdue invoice is already past suspension date.'
                    : `Customer status is ${row.customerStatus} while invoice is still ${row.invoiceStatus}.`;
            } else if (row.invoiceStatus !== 'Overdue') {
                auditStatus = 'invoice_not_actionable';
                reason = `Invoice status is ${row.invoiceStatus}.`;
            }

            return {
                customerId: row.customerId,
                customerName: row.customerName,
                customerStatus: row.customerStatus,
                pppoeUsername: row.pppoeUsername,
                packageName: row.packageName,
                billingType: row.billing_type || 'postpaid',
                invoiceId: row.invoiceId,
                invoiceStatus: row.invoiceStatus,
                dueDate: row.dueDate,
                suspendDate: suspendDateStr,
                suspensionProfileName: settings.billing.suspensionProfileName || '',
                previousPppoeProfile: row.previousPppoeProfile,
                eligibleToday,
                auditStatus,
                reason,
            };
        }).filter(Boolean);

        const summary = {
            date: today,
            timezone: tz,
            suspensionDays: settings.billing.suspensionDays || 0,
            fixedBillDueDays: settings.billing.fixedBillDueDays || 0,
            suspensionProfileName: settings.billing.suspensionProfileName || '',
            dailySuspensionFlagExists: flags.length > 0,
            totalCustomersChecked: results.length,
            eligibleToday: results.filter(item => item.eligibleToday).length,
            eligibleButActive: results.filter(item => item.auditStatus === 'eligible_but_active').length,
            alreadySuspended: results.filter(item => item.auditStatus === 'already_suspended').length,
        };

        res.json({ summary, results });
    } catch (error) {
        console.error('Suspension audit failed:', error);
        res.status(500).json({ message: 'Failed to run suspension audit.', error: error.message });
    }
});


export default router;
