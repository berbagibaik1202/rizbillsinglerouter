import express from 'express';
import pool from '../db.js';
import { getSettings, formatRupiah, replacePlaceholders, dbDateToISO, toMySQLDatetime, randomDelay, dateToYMD, parseLocalDateString } from '../utils.js';
import mikrotikApi from '../mikrotik-api.js';
import whatsappService from '../whatsappService.js';
import { sendTestEmail } from '../emailService.js';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import { exec, spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDeviceProfileByModel } from '../utils/deviceProfiles.js';
import { getLastDigiflazzPing } from '../services/digiflazzWebhookState.js';
import { isSnmpEnabledForDevice, readSnmpSystemInfo } from '../utils/oltSnmp.js';
import { resolveNamespacedStorageDir } from '../storagePaths.js';

const { promises: fsPromises } = fs;

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = resolveNamespacedStorageDir({
    exactDirEnv: 'UPLOAD_DIR',
    baseDirEnv: 'UPLOAD_BASE_DIR',
    defaultBaseDir: '/opt/uploads',
});
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
let activeDatabaseRestoreJob = null;

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

const resolveMysqlBinary = (binaryName) => {
    const isWindows = process.platform === 'win32';
    const resolvedName = isWindows && !binaryName.toLowerCase().endsWith('.exe')
        ? `${binaryName}.exe`
        : binaryName;

    const candidatePaths = isWindows
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
        ];

    for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    const locator = isWindows ? 'where' : 'which';
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

    return resolvedName;
};

const splitSqlStatements = (sqlContent) => {
    const statements = [];
    let delimiter = ';';
    let buffer = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let escapeNext = false;

    const pushStatement = () => {
        const trimmed = buffer.trim();
        if (trimmed) statements.push(trimmed);
        buffer = '';
    };

    const lines = sqlContent
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/^--.*$/gm, '')
        .replace(/^#.*$/gm, '')
        .replace(/\/\*!\d+\s*([\s\S]*?)\*\//g, '$1')
        .replace(/\/\*(?!\!)[\s\S]*?\*\//g, '');

    for (const rawLine of lines.split('\n')) {
        const delimiterMatch = rawLine.trim().match(/^DELIMITER\s+(.+)$/i);
        if (delimiterMatch) {
            if (buffer.trim()) pushStatement();
            delimiter = delimiterMatch[1];
            continue;
        }

        buffer += `${rawLine}\n`;

        for (let i = 0; i < buffer.length; i++) {
            const char = buffer[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (!inDoubleQuote && !inBacktick && char === '\'') {
                inSingleQuote = !inSingleQuote;
                continue;
            }

            if (!inSingleQuote && !inBacktick && char === '"') {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (!inSingleQuote && !inDoubleQuote && char === '`') {
                inBacktick = !inBacktick;
            }
        }

        const trimmedBuffer = buffer.trimEnd();
        if (!inSingleQuote && !inDoubleQuote && !inBacktick && trimmedBuffer.endsWith(delimiter)) {
            buffer = trimmedBuffer.slice(0, -delimiter.length);
            pushStatement();
        }
    }

    if (buffer.trim()) pushStatement();
    return statements;
};

const normalizeSqlDumpContent = (sqlContent) => {
    return sqlContent
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/^\s*\\-\\-\s?/gm, '-- ')
        .replace(/^\s*\\#/gm, '#');
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

const nowIso = () => new Date().toISOString();

const isDatabaseRestoreJobActive = (job) => !!job && ['queued', 'running'].includes(job.status);

const getDatabaseRestoreJobResponse = (job) => {
    if (!job) return null;
    const { child_process: _childProcess, ...safeJob } = job;
    return safeJob;
};

const getActiveDatabaseRestoreJob = () => (isDatabaseRestoreJobActive(activeDatabaseRestoreJob) ? activeDatabaseRestoreJob : null);

const getDatabaseRestoreJobById = (jobId) => {
    const job = activeDatabaseRestoreJob;
    if (!job || job.id !== jobId) return null;
    return job;
};

const createDatabaseRestoreJob = (backupFile) => ({
    id: uuidv4(),
    status: 'queued',
    processed_count: 0,
    total_statements: 0,
    progress_percent: 0,
    message: 'Database restore job queued.',
    error_message: null,
    backup_path: backupFile?.path || null,
    original_filename: backupFile?.originalname || null,
    started_at: null,
    finished_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    cancel_requested: false,
    child_process: null,
});

const updateDatabaseRestoreJob = (job, patch = {}) => {
    if (!job) return null;
    Object.assign(job, patch);
    job.updated_at = nowIso();
    return job;
};

const setDatabaseRestoreProgress = (job, progress, message, extraPatch = {}) => {
    if (!job) return null;
    job.progress_percent = Math.max(0, Math.min(100, Number(progress || 0)));
    if (message !== undefined) {
        job.message = String(message || '').trim() || job.message;
    }
    Object.assign(job, extraPatch);
    job.updated_at = nowIso();
    return job;
};

const cleanupRestoreFiles = async (files = []) => {
    await Promise.all(files.map(async (filePath) => {
        if (!filePath) return;
        try {
            await fsPromises.unlink(filePath);
        } catch {}
    }));
};

const APP_UPDATE_SERVICE_URL = String(process.env.APP_UPDATE_SERVICE_URL || 'http://app-updater:3140').replace(/\/+$/, '');
const APP_UPDATE_SERVICE_TOKEN = String(process.env.APP_UPDATE_TOKEN || process.env.APP_UPDATE_SERVICE_TOKEN || '').trim();
const APP_UPDATE_REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.APP_UPDATE_REQUEST_TIMEOUT_MS || 15000));
const APP_ROOT_DIR = path.resolve(__dirname, '..', '..');

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
        await whatsappService.connectToWhatsApp();
        res.json({ success: true, message: "WhatsApp connection started." });
    } catch (e) {
        console.error('[WhatsApp Connect] Error:', e);
        res.status(500).json({ success: false, message: e?.message || 'Failed to start WhatsApp connection.' });
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

router.post('/whatsapp/test-message', async (req, res) => {
    const { phoneNumber, message } = req.body;
    const result = await whatsappService.sendMessage(phoneNumber, message);
    if (result.success) {
        res.json({ success: true, message: "Test message sent!" });
    } else {
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
    if (whatsappService.getStatus().status !== 'connected') {
        return res.status(400).json({ success: false, message: 'WhatsApp is not connected.' });
    }
    try {
        const settings = await getSettings();
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
            const result = await whatsappService.sendMessage(customer.phone, personalizedMessage);
            
            await pool.query('INSERT INTO whatsapp_logs SET ?', {
                recipient_number: customer.phone,
                customer_id: customer.id,
                message_body: personalizedMessage,
                status: result.success ? 'sent' : 'failed',
                type: 'Broadcast Message',
                error_message: result.error || null,
                created_at: toMySQLDatetime(new Date(), tz),
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
            const result = await whatsappService.sendMessage(log.recipient_number, log.message_body);
            
            await pool.query('INSERT INTO whatsapp_logs SET ?', {
                recipient_number: log.recipient_number,
                customer_id: log.customer_id,
                message_body: log.message_body,
                status: result.success ? 'sent' : 'failed',
                type: `Resend: ${log.type}`,
                error_message: result.error || null,
                created_at: toMySQLDatetime(new Date(), tz),
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
router.get('/chatbot-status', (req, res) => {
    const apiKey = process.env.API_KEY;
    res.json({ configured: !!apiKey });
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

    const mysqldumpBin = resolveMysqlBinary('mysqldump');
    const command = `"${mysqldumpBin}" --host=${DB_HOST || 'localhost'} --user=${DB_USER} ${DB_PASSWORD ? `--password=${DB_PASSWORD}`: ''} ${DB_NAME} > "${filePath}"`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Backup exec error: ${error}`);
            return res.status(500).json({ message: 'Failed to create database backup.', error: stderr });
        }
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

router.post('/database/restore', upload.single('backup'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const backupFile = req.file;
    if (!backupFile) {
        return res.status(400).json({ message: 'No backup file uploaded.' });
    }

    if (getActiveDatabaseRestoreJob()) {
        return res.status(409).json({
            success: false,
            message: 'A database restore job is already running.',
            job: getDatabaseRestoreJobResponse(getActiveDatabaseRestoreJob()),
        });
    }

    const job = createDatabaseRestoreJob(backupFile);
    activeDatabaseRestoreJob = job;

    const runRestore = async () => {
        const { DB_USER, DB_PASSWORD, DB_NAME, DB_HOST } = process.env;

        const cleanupJobFiles = async () => {
            await cleanupRestoreFiles([backupFile.path]);
        };

        const shouldFallbackToSqlFile = (error) => {
            if (!error) return false;
            if (error.code === 'ENOENT') return true;
            const message = String(error.message || '');
            return /not recognized as an internal or external command/i.test(message)
                || /not found/.test(message)
                || /Unknown command '\\-'/i.test(message);
        };

        const restoreViaSqlFile = async () => {
            if (!DB_NAME) throw new Error('DB_NAME is not configured.');
            const connection = await mysql.createConnection({
                host: DB_HOST || 'localhost',
                user: DB_USER || 'root',
                password: DB_PASSWORD || '',
                database: DB_NAME,
                multipleStatements: true,
            });

            try {
                await connection.query('SET FOREIGN_KEY_CHECKS=0;');
                const sqlContent = normalizeSqlDumpContent(await fsPromises.readFile(backupFile.path, 'utf8'));
                const statements = splitSqlStatements(sqlContent);
                updateDatabaseRestoreJob(job, {
                    total_statements: statements.length,
                    processed_count: 0,
                    progress_percent: statements.length > 0 ? 10 : 100,
                    message: statements.length > 0 ? `Applying ${statements.length} SQL statement(s) via fallback...` : 'No SQL statements found in backup.',
                });

                for (let index = 0; index < statements.length; index += 1) {
                    if (job.cancel_requested) {
                        throw new Error('Database restore job canceled.');
                    }
                    const statement = statements[index];
                    if (!statement) continue;
                    await connection.query(statement);
                    const processedCount = index + 1;
                    const progressPercent = statements.length > 0
                        ? Math.min(99, Math.round((processedCount / statements.length) * 95))
                        : 100;
                    updateDatabaseRestoreJob(job, {
                        processed_count: processedCount,
                        progress_percent: progressPercent,
                        message: `Restoring database (${processedCount}/${statements.length})...`,
                    });
                }

                await connection.query('SET FOREIGN_KEY_CHECKS=1;');
            } finally {
                await connection.end();
            }
        };

        updateDatabaseRestoreJob(job, {
            status: 'running',
            started_at: nowIso(),
            message: 'Reading database backup...',
            error_message: null,
            progress_percent: 1,
        });

        try {
            if (!DB_NAME) {
                throw new Error('DB_NAME is not configured.');
            }

            const rawSqlContent = await fsPromises.readFile(backupFile.path, 'utf8');
            const normalizedSqlContent = normalizeSqlDumpContent(rawSqlContent);
            const statements = splitSqlStatements(normalizedSqlContent);

            updateDatabaseRestoreJob(job, {
                total_statements: statements.length,
                message: statements.length > 0 ? `Prepared ${statements.length} SQL statement(s).` : 'No SQL statements found in backup.',
                progress_percent: statements.length > 0 ? 5 : 100,
            });

            if (job.cancel_requested) {
                updateDatabaseRestoreJob(job, {
                    status: 'canceled',
                    finished_at: nowIso(),
                    message: 'Database restore job canceled.',
                    progress_percent: 0,
                });
                await cleanupJobFiles();
                return;
            }

            const mysqlBin = resolveMysqlBinary('mysql');
            const commandArgs = [
                '--binary-mode=1',
                '--default-character-set=utf8mb4',
                `--host=${DB_HOST || 'localhost'}`,
                `--user=${DB_USER || 'root'}`,
            ];
            if (DB_PASSWORD) {
                commandArgs.push(`--password=${DB_PASSWORD}`);
            }
            commandArgs.push(DB_NAME);

            let cliRestoreResult;
            try {
                cliRestoreResult = await new Promise((resolve, reject) => {
                    const child = spawn(mysqlBin, commandArgs, {
                        stdio: ['pipe', 'pipe', 'pipe'],
                    });

                    updateDatabaseRestoreJob(job, {
                        child_process: child,
                        message: 'Applying SQL backup via MySQL CLI...',
                        progress_percent: Math.max(job.progress_percent, 10),
                    });

                    let stderr = '';
                    child.stderr.on('data', (chunk) => {
                        stderr += chunk.toString();
                    });

                    child.on('error', reject);
                    child.on('close', (code, signal) => {
                        resolve({ code, signal, stderr });
                    });

                    child.stdin.on('error', () => {});
                    child.stdin.write(normalizedSqlContent);
                    child.stdin.end();
                });
            } finally {
                updateDatabaseRestoreJob(job, {
                    child_process: null,
                });
            }

            if (job.cancel_requested) {
                updateDatabaseRestoreJob(job, {
                    status: 'canceled',
                    finished_at: nowIso(),
                    message: 'Database restore job canceled.',
                    progress_percent: 0,
                });
                await cleanupJobFiles();
                return;
            }

            if (cliRestoreResult && cliRestoreResult.code !== 0) {
                const error = new Error(cliRestoreResult.stderr || `mysql exited with code ${cliRestoreResult.code}`);
                console.error(`Restore exec error: ${error.message}`);

                if (shouldFallbackToSqlFile(error)) {
                    updateDatabaseRestoreJob(job, {
                        message: 'MySQL CLI unavailable. Falling back to SQL connector restore...',
                        progress_percent: Math.max(job.progress_percent, 20),
                    });

                    try {
                        await restoreViaSqlFile();
                        updateDatabaseRestoreJob(job, {
                            status: 'completed',
                            finished_at: nowIso(),
                            message: 'Database restored successfully using the MySQL connector fallback. The application may need to be restarted.',
                            progress_percent: 100,
                        });
                        return;
                    } catch (fallbackError) {
                        console.error('Fallback restore failed:', fallbackError);
                        throw fallbackError;
                    }
                }

                throw error;
            }

            updateDatabaseRestoreJob(job, {
                status: 'completed',
                finished_at: nowIso(),
                message: 'Database restored successfully! The application may need to be restarted.',
                progress_percent: 100,
                processed_count: statements.length,
            });
        } catch (error) {
            if (job.cancel_requested) {
                updateDatabaseRestoreJob(job, {
                    status: 'canceled',
                    finished_at: nowIso(),
                    message: 'Database restore job canceled.',
                    progress_percent: 0,
                });
            } else if (shouldFallbackToSqlFile(error)) {
                try {
                    updateDatabaseRestoreJob(job, {
                        message: 'MySQL CLI unavailable. Falling back to SQL connector restore...',
                        progress_percent: Math.max(job.progress_percent, 20),
                    });
                    await restoreViaSqlFile();
                    updateDatabaseRestoreJob(job, {
                        status: 'completed',
                        finished_at: nowIso(),
                        message: 'Database restored successfully using the MySQL connector fallback. The application may need to be restarted.',
                        progress_percent: 100,
                    });
                } catch (fallbackError) {
                    console.error('Fallback restore failed:', fallbackError);
                    updateDatabaseRestoreJob(job, {
                        status: 'failed',
                        finished_at: nowIso(),
                        error_message: fallbackError.message || 'Failed to restore database.',
                        message: fallbackError.message || 'Failed to restore database.',
                    });
                }
            } else {
                console.error('Restore preparation failed:', error);
                updateDatabaseRestoreJob(job, {
                    status: 'failed',
                    finished_at: nowIso(),
                    error_message: error.message || 'Failed to restore database.',
                    message: error.message || 'Failed to restore database.',
                });
            }
        } finally {
            await cleanupJobFiles();
        }
    };

    void runRestore();

    return res.status(202).json({
        success: true,
        message: 'Database restore job queued.',
        job: getDatabaseRestoreJobResponse(job),
    });
});

router.get('/database/restore/jobs/active', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    return res.json({
        success: true,
        job: getDatabaseRestoreJobResponse(getActiveDatabaseRestoreJob()),
    });
});

router.get('/database/restore/jobs/:jobId', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const jobId = String(req.params.jobId || '').trim();
    const job = getDatabaseRestoreJobById(jobId);
    if (!job) {
        return res.status(404).json({
            success: false,
            message: 'Database restore job not found.',
            job: null,
        });
    }
    return res.json({
        success: true,
        job: getDatabaseRestoreJobResponse(job),
    });
});

router.post('/database/restore/jobs/:jobId/cancel', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const jobId = String(req.params.jobId || '').trim();
    const job = getDatabaseRestoreJobById(jobId);

    if (!job) {
        return res.status(404).json({
            success: false,
            message: 'Database restore job not found.',
            job: null,
        });
    }

    if (!isDatabaseRestoreJobActive(job)) {
        return res.json({
            success: true,
            message: 'Database restore job is already finished.',
            job: getDatabaseRestoreJobResponse(job),
        });
    }

    job.cancel_requested = true;
    updateDatabaseRestoreJob(job, {
        message: 'Database restore cancellation requested.',
    });

    if (job.child_process) {
        try {
            job.child_process.kill();
        } catch {}
    }

    if (job.status === 'queued') {
        updateDatabaseRestoreJob(job, {
            status: 'canceled',
            finished_at: nowIso(),
            progress_percent: 0,
            message: 'Database restore job canceled.',
        });
    }

    return res.json({
        success: true,
        message: 'Database restore job cancellation requested.',
        job: getDatabaseRestoreJobResponse(job),
    });
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

router.get('/app-update/check', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    try {
        const { response, data } = await callAppUpdateService('GET', '/check');
        const localBuildInfo = await resolveLocalAppBuildInfo();
        return res.status(200).json({
            ...data,
            success: response.ok && data?.success !== false,
            service_available: response.ok,
            build: data?.build || localBuildInfo,
        });
    } catch (error) {
        console.error('[App Update] Failed to check for application updates:', error);
        return res.status(200).json({
            success: false,
            service_available: false,
            message: error.message || 'Failed to check application updates.',
            update_available: false,
            build: await resolveLocalAppBuildInfo(),
            current: await resolveLocalAppBuildInfo(),
            latest: null,
            current_head: null,
            latest_head: null,
            ahead_by: null,
            behind_by: null,
            changelog: [],
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


export default router;
