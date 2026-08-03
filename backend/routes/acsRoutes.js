

import express from "express";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { randomUUID } from "crypto";
import pool from "../db.js";
import { getSettings, toMySQLDatetime, dbDateToISO } from "../utils.js";
import { parseDeviceDetails } from "../parsers/acsdeviceparser.js";
import { getCustomerDeviceDetails, updateCustomerWlan } from "../services.js";
import { sanitizeAcs } from "../utils/sanitizeAcs.js";
import levenshtein from "js-levenshtein"; 

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ACS_SYNC_WORKER_PATH = path.join(__dirname, '../jobs/acsSyncWorker.js');
const ACS_API_TIMEOUT = 30000; // Timeout default 30 detik untuk request ACS biasa
const ACS_SYNC_LIST_TIMEOUT = 60000; // Sync penuh boleh lebih lama daripada request biasa
const ACS_LIST_PAGE_RETRIES = 2;
const ACS_LIST_RETRY_DELAY_MS = 1500;
const ACS_SYNC_JOB_POLL_INTERVAL_MS = 5000;
const ACS_LIVE_REFRESH_STATUS_RETENTION_MS = Number(process.env.ACS_LIVE_REFRESH_STATUS_RETENTION_MS || 30000);
const ACS_SYNC_MINIMAL_PROJECTION = "_id,_lastInform,summary,Device.DeviceInfo.ModelName,Device.DeviceInfo.ProductClass,InternetGatewayDevice.DeviceInfo.ModelName,InternetGatewayDevice.DeviceInfo.ProductClass";
const ACS_SYNC_PAGE_LIMIT = Number(process.env.ACS_SYNC_PAGE_LIMIT || 25);
const ACS_SYNC_PAGE_PAUSE_MS = Number(process.env.ACS_SYNC_PAGE_PAUSE_MS || 50);
const ACS_SYNC_PROGRESS_UPDATE_EVERY_PAGES = Math.max(1, Number(process.env.ACS_SYNC_PROGRESS_UPDATE_EVERY_PAGES || 5));
const ACS_SYNC_JOB_STATUSES = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
};
const ACS_SYNC_CANCELLED_MESSAGE = 'ACS sync job cancelled by user.';

const parseAcsLastInform = (value) => {
    if (value == null) return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    }

    if (typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const mysqlLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
    if (mysqlLike) {
        const [, year, month, day, hour, minute, second] = mysqlLike;
        const parsed = new Date(Number(year), Number(month) - 1, Number(day));
        parsed.setHours(Number(hour), Number(minute), Number(second), 0);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const fallback = new Date(raw.includes(' ') ? raw.replace(' ', 'T') : raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
};

let acsSyncSchedulerStarted = false;
let acsSyncWorkerRunning = false;
let acsLiveRefreshState = null;
let acsLiveRefreshCleanupTimer = null;
const isLightweightRuntime = process.env.CPANEL_LIGHTWEIGHT === 'true'
    || process.env.DISABLE_BACKGROUND_SERVICES === 'true'
    || process.env.DISABLE_ACS_BACKGROUND_REFRESH === 'true';

router.use((req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = (data) => {
        try {
            const cleaned = sanitizeAcs(data);
            return originalJson(cleaned);
        } catch (e) {
            console.error("[ACS Sanitizer Error]", e);
            return originalJson(data);
        }
    };

    next();
});

router.param("id", (req, res, next, id) => {
    try {
        // Express decodes once; keep both encoded and decoded variants alive via helper logic.
        const sanitizedId = id.trim()
            .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\0]/g, "") // Remove zero-width characters
            .replace(/\s+/g, " ") // Normalize whitespace
            .normalize("NFC");
        req.deviceId = sanitizedId;
        next();
    } catch (e) {
        console.error("[DeviceID Param Error]", e);
        return res.status(400).json({ error: "Invalid device ID format" });
    }
});


/* ============================================================
   HELPER FUNCTIONS
============================================================ */

// Pastikan handleAcsFetchError selalu mengembalikan JSON
const handleAcsFetchError = (error, res, action, apiUrl) => {
    console.error(`ACS Error while ${action}:`, error);
    
    let statusCode = 500;
    let message = error.message || `Failed to complete ${action}`;

    // Classify errors
    if (error.name === 'AbortError') {
        statusCode = 408;
        message = `Request timeout while ${action}. ACS server may be unreachable.`;
    } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        statusCode = 503;
        message = `ACS server unreachable at ${apiUrl}. Please check configuration.`;
    } else if (error.message.includes('401') || error.message.includes('403')) {
        statusCode = 401;
        message = `ACS authentication failed. Please check credentials.`;
    }

    // **PASTIKAN SELALU RETURN JSON**
    res.status(statusCode).json({
        success: false,
        error: message,
        message: message // tambahkan field message untuk konsistensi
    });
};

const formatAcsSyncJob = (job) => {
    if (!job) return null;
    return {
        ...job,
        progress_percent: Number(job.progress_percent || 0),
        created_at: job.created_at ? dbDateToISO(job.created_at) : null,
        updated_at: job.updated_at ? dbDateToISO(job.updated_at) : null,
        started_at: job.started_at ? dbDateToISO(job.started_at) : null,
        finished_at: job.finished_at ? dbDateToISO(job.finished_at) : null,
    };
};

const formatAcsLiveRefreshState = (state = acsLiveRefreshState) => {
    if (!state) return null;
    return {
        id: state.id || null,
        active: Boolean(state.active),
        processed_count: Number(state.processed_count || 0),
        message: state.message || null,
        error_message: state.error_message || null,
        started_at: state.started_at ? dbDateToISO(state.started_at) : null,
        finished_at: state.finished_at ? dbDateToISO(state.finished_at) : null,
        updated_at: state.updated_at ? dbDateToISO(state.updated_at) : null,
    };
};

const formatAcsCachedDeviceRow = (device) => ({
    ...device,
    isOnline: device.isOnline === 1,
    lastInform: dbDateToISO(device.lastInform),
});

const fetchAcsCachedDeviceRows = async ({ includeCustomerJoin = true, serialNumbers = null } = {}) => {
    const customerJoin = includeCustomerJoin
        ? "LEFT JOIN customers c ON c.acsSerialNumber = d.serialNumber"
        : "";
    const selectColumns = [
        "d.serialNumber as id",
        "d.serialNumber",
        "d.productClass",
        "d.ipAddress",
        "d.pppoeUsername",
        "d.rxPower",
        "d.lastInform",
        "d.isOnline",
        "d.ssid1",
        "d.ssid5",
        "d.ssid1Connected",
        "d.ssid5Connected",
        includeCustomerJoin
            ? "c.id as customerId"
            : "NULL as customerId",
        includeCustomerJoin
            ? "c.name as customerName"
            : "NULL as customerName",
    ];
    const whereClause = Array.isArray(serialNumbers) && serialNumbers.length > 0
        ? `WHERE d.serialNumber IN (${serialNumbers.map(() => '?').join(', ')})`
        : '';
    const queryParams = Array.isArray(serialNumbers) && serialNumbers.length > 0 ? serialNumbers : [];

    const [rows] = await pool.query(`
        SELECT ${selectColumns.join(", ")}
        FROM acs_devices d
        ${customerJoin}
        ${whereClause}
        ORDER BY d.lastInform DESC
    `, queryParams);

    return Array.isArray(rows) ? rows : [];
};

const fetchAcsCachedLastSyncTime = async () => {
    const [rows] = await pool.query("SELECT MAX(last_sync_at) as lastSyncTime FROM acs_devices");
    return Array.isArray(rows) && rows.length > 0 ? rows[0]?.lastSyncTime || null : null;
};

const getAcsCachedDevicesResponse = async ({ fast = false } = {}) => {
    let rows = [];
    let lastSyncTime = null;

    try {
        rows = await fetchAcsCachedDeviceRows({ includeCustomerJoin: true });
    } catch (error) {
        console.warn(`[ACS Cached${fast ? " Fast" : ""}] Customer join failed, retrying without customer metadata:`, error);
        try {
            rows = await fetchAcsCachedDeviceRows({ includeCustomerJoin: false });
        } catch (fallbackError) {
            console.error(`[ACS Cached${fast ? " Fast" : ""}] Cache query failed, returning empty list:`, fallbackError);
            rows = [];
        }
    }

    try {
        lastSyncTime = await fetchAcsCachedLastSyncTime();
    } catch (error) {
        console.warn(`[ACS Cached${fast ? " Fast" : ""}] Failed to read last sync timestamp:`, error);
    }

    return {
        devices: rows.map(formatAcsCachedDeviceRow),
        lastSyncTime: dbDateToISO(lastSyncTime),
    };
};

const scheduleAcsLiveRefreshCleanup = () => {
    if (acsLiveRefreshCleanupTimer) {
        clearTimeout(acsLiveRefreshCleanupTimer);
        acsLiveRefreshCleanupTimer = null;
    }

    if (!acsLiveRefreshState || acsLiveRefreshState.active) {
        return;
    }

    acsLiveRefreshCleanupTimer = setTimeout(() => {
        acsLiveRefreshState = null;
        acsLiveRefreshCleanupTimer = null;
    }, ACS_LIVE_REFRESH_STATUS_RETENTION_MS);

    if (typeof acsLiveRefreshCleanupTimer.unref === 'function') {
        acsLiveRefreshCleanupTimer.unref();
    }
};

const setAcsLiveRefreshState = (fields = {}) => {
    const nextState = {
        id: fields.id ?? acsLiveRefreshState?.id ?? randomUUID(),
        active: typeof fields.active === 'boolean' ? fields.active : Boolean(acsLiveRefreshState?.active),
        processed_count: fields.processed_count !== undefined
            ? Number(fields.processed_count || 0)
            : Number(acsLiveRefreshState?.processed_count || 0),
        message: fields.message !== undefined ? fields.message : (acsLiveRefreshState?.message ?? null),
        error_message: fields.error_message !== undefined ? fields.error_message : (acsLiveRefreshState?.error_message ?? null),
        started_at: fields.started_at !== undefined ? fields.started_at : (acsLiveRefreshState?.started_at ?? null),
        finished_at: fields.finished_at !== undefined ? fields.finished_at : (acsLiveRefreshState?.finished_at ?? null),
        updated_at: fields.updated_at || new Date(),
    };

    acsLiveRefreshState = nextState;
    scheduleAcsLiveRefreshCleanup();
    return nextState;
};

const clearAcsLiveRefreshState = () => {
    if (acsLiveRefreshCleanupTimer) {
        clearTimeout(acsLiveRefreshCleanupTimer);
        acsLiveRefreshCleanupTimer = null;
    }
    acsLiveRefreshState = null;
};

const getActiveAcsWork = async () => {
    const [syncJob] = await Promise.all([
        getActiveAcsSyncJob(),
    ]);

    return {
        syncJob,
        liveRefresh: acsLiveRefreshState?.active ? acsLiveRefreshState : null,
    };
};

const getActiveAcsWorkSnapshot = async () => {
    const { syncJob, liveRefresh } = await getActiveAcsWork();
    return {
        syncJob: syncJob ? formatAcsSyncJob(syncJob) : null,
        liveRefresh: liveRefresh ? formatAcsLiveRefreshState(liveRefresh) : null,
    };
};

const buildActiveAcsWorkConflict = async (message = 'Another ACS job is already active. Please wait until it finishes.') => {
    const snapshot = await getActiveAcsWorkSnapshot();
    if (!snapshot.syncJob && !snapshot.liveRefresh?.active) {
        return null;
    }

    return {
        status: 409,
        body: {
            success: false,
            message,
            job: snapshot.syncJob,
            liveRefresh: snapshot.liveRefresh,
        },
    };
};

const getAcsSyncJobById = async (jobId) => {
    const [rows] = await pool.query(
        `SELECT * FROM acs_sync_jobs WHERE id = ? LIMIT 1`,
        [jobId]
    );
    return rows.length > 0 ? rows[0] : null;
};

const getActiveAcsSyncJob = async () => {
    const [rows] = await pool.query(
        `SELECT * FROM acs_sync_jobs
         WHERE status IN (?, ?)
         ORDER BY created_at DESC
         LIMIT 1`,
        [ACS_SYNC_JOB_STATUSES.QUEUED, ACS_SYNC_JOB_STATUSES.RUNNING]
    );
    return rows.length > 0 ? rows[0] : null;
};

const getNextQueuedAcsSyncJob = async () => {
    const [rows] = await pool.query(
        `SELECT * FROM acs_sync_jobs
         WHERE status = ?
         ORDER BY created_at ASC
         LIMIT 1`,
        [ACS_SYNC_JOB_STATUSES.QUEUED]
    );
    return rows.length > 0 ? rows[0] : null;
};

const createAcsSyncJob = async () => {
    const id = randomUUID();
    await pool.query(
        `INSERT INTO acs_sync_jobs (id, status, processed_count, progress_percent, message)
         VALUES (?, ?, 0, 0, ?)`,
        [id, ACS_SYNC_JOB_STATUSES.QUEUED, 'Queued for processing']
    );
    return getAcsSyncJobById(id);
};

const updateAcsSyncJob = async (jobId, fields = {}) => {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;

    const assignments = keys.map((key) => `\`${key}\` = ?`).join(', ');
    const values = keys.map((key) => fields[key]);
    values.push(jobId);

    await pool.query(
        `UPDATE acs_sync_jobs SET ${assignments} WHERE id = ?`,
        values
    );
};

const finalizeAcsSyncJob = async (jobId, status, fields = {}) => {
    await updateAcsSyncJob(jobId, {
        status,
        progress_percent: status === ACS_SYNC_JOB_STATUSES.COMPLETED ? 100 : Number(fields.progress_percent || 0),
        finished_at: fields.finished_at || new Date(),
        updated_at: new Date(),
        ...fields,
    });
};

const isAcsSyncJobCancelled = async (jobId) => {
    const job = await getAcsSyncJobById(jobId);
    return job?.status === ACS_SYNC_JOB_STATUSES.CANCELLED;
};

const cancelAcsSyncJob = async (jobId) => {
    const [result] = await pool.query(
        `UPDATE acs_sync_jobs
         SET status = ?, message = ?, error_message = NULL, finished_at = COALESCE(finished_at, NOW()), updated_at = NOW()
         WHERE id = ? AND status IN (?, ?)`,
        [ACS_SYNC_JOB_STATUSES.CANCELLED, ACS_SYNC_CANCELLED_MESSAGE, jobId, ACS_SYNC_JOB_STATUSES.QUEUED, ACS_SYNC_JOB_STATUSES.RUNNING]
    );

    return result.affectedRows > 0;
};

const claimAcsSyncJob = async (jobId) => {
    const [result] = await pool.query(
        `UPDATE acs_sync_jobs
         SET status = ?, started_at = COALESCE(started_at, NOW()), message = ?, updated_at = NOW()
         WHERE id = ? AND status = ?`,
        [ACS_SYNC_JOB_STATUSES.RUNNING, 'ACS sync worker starting...', jobId, ACS_SYNC_JOB_STATUSES.QUEUED]
    );

    return result.affectedRows > 0;
};

const launchAcsSyncWorker = (jobId) => {
    const child = spawn(process.execPath, [ACS_SYNC_WORKER_PATH, jobId], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });

    child.unref();
    return child;
};

const processAcsSyncQueue = async () => {
    if (acsSyncWorkerRunning) return;

    const nextJob = await getNextQueuedAcsSyncJob();
    if (!nextJob) {
        return;
    }

    acsSyncWorkerRunning = true;
    try {
        const claimed = await claimAcsSyncJob(nextJob.id);
        if (!claimed) {
            return;
        }

        launchAcsSyncWorker(nextJob.id);
    } catch (error) {
        console.error('[ACS Job] Failed to launch sync worker:', error);
        await finalizeAcsSyncJob(nextJob.id, ACS_SYNC_JOB_STATUSES.FAILED, {
            error_message: error.message || 'Failed to launch ACS sync worker.',
            message: error.message || 'Failed to launch ACS sync worker.',
        });
    } finally {
        acsSyncWorkerRunning = false;
    }
};

export const startAcsSyncJobScheduler = () => {
    if (isLightweightRuntime) {
        console.warn('[ACS Job] ACS sync scheduler disabled by runtime flag.');
        return;
    }

    if (acsSyncSchedulerStarted) return;
    acsSyncSchedulerStarted = true;

    pool.query(
        `UPDATE acs_sync_jobs
         SET status = ?, message = ?, updated_at = NOW()
         WHERE status = ?`,
        [ACS_SYNC_JOB_STATUSES.QUEUED, 'Recovered after service restart', ACS_SYNC_JOB_STATUSES.RUNNING]
    ).catch((error) => {
        console.error('[ACS Job] Failed to recover running jobs on startup:', error);
    });

    const tick = () => {
        processAcsSyncQueue().catch((error) => {
            console.error('[ACS Job] Scheduler tick failed:', error);
        });
    };

    tick();
    setInterval(tick, ACS_SYNC_JOB_POLL_INTERVAL_MS);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJsonWithTimeout = async (url, { headers = {}, timeoutMs, label, shouldStop = null }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let stopPollId = null;

    if (typeof shouldStop === 'function') {
        stopPollId = setInterval(() => {
            Promise.resolve(shouldStop())
                .then((shouldAbort) => {
                    if (shouldAbort) {
                        controller.abort();
                    }
                })
                .catch(() => {});
        }, 500);
    }

    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) {
            const responseError = new Error(`ACS API responded with status ${response.status} while ${label}.`);
            responseError.status = response.status;
            throw responseError;
        }

        return await response.json();
    } catch (error) {
        if (controller.signal.aborted && typeof shouldStop === 'function') {
            const cancelledError = new Error(ACS_SYNC_CANCELLED_MESSAGE);
            cancelledError.name = 'AbortError';
            cancelledError.code = 'ACS_SYNC_CANCELLED';
            throw cancelledError;
        }

        if (error.name === 'AbortError') {
            const timeoutError = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
            timeoutError.name = 'AbortError';
            throw timeoutError;
        }

        throw error;
    } finally {
        clearTimeout(timeoutId);
        if (stopPollId) clearInterval(stopPollId);
    }
};

const isRetryableAcsPageError = (error) => {
    const status = error?.status;
    const message = String(error?.message || "");

    return (
        (error?.code !== 'ACS_SYNC_CANCELLED' && error?.name === 'AbortError') ||
        status === 429 ||
        (typeof status === 'number' && status >= 500) ||
        /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(message)
    );
};

const unwrapAcsScalar = (value, depth = 0) => {
    if (value === null || value === undefined || depth > 4) return value;

    if (Array.isArray(value)) {
        return value.length > 0 ? unwrapAcsScalar(value[0], depth + 1) : undefined;
    }

    if (typeof value === 'object') {
        if (value._value !== undefined) return unwrapAcsScalar(value._value, depth + 1);
        if (value.value !== undefined) return unwrapAcsScalar(value.value, depth + 1);
        if (value.$value !== undefined) return unwrapAcsScalar(value.$value, depth + 1);
    }

    return value;
};

const pickAcsScalar = (...values) => {
    for (const candidate of values) {
        const value = unwrapAcsScalar(candidate);
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed && trimmed !== 'N/A') return trimmed;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
    }
    return null;
};

const resolveAcsDeviceModel = (device, parsed = null) => {
    return pickAcsScalar(
        parsed?.general?.model,
        device?.summary?.modelName,
        device?.summary?.productClass,
        device?.summary?.model,
        device?.DeviceID?.ModelName,
        device?.DeviceID?.ProductClass,
        device?._deviceId?.ModelName,
        device?._deviceId?.ProductClass,
        device?._deviceId?._ProductClass,
        device?.Device?.DeviceInfo?.ModelName,
        device?.Device?.DeviceInfo?.ProductClass,
        device?.InternetGatewayDevice?.DeviceInfo?.ModelName,
        device?.InternetGatewayDevice?.DeviceInfo?.ProductClass,
        device?.DeviceInfo?.ModelName,
        device?.DeviceInfo?.ProductClass,
        device?.DeviceID?.ManufacturerOUI
    ) || 'N/A';
};

const buildAcsDeviceCacheRow = (device) => {
    if (!device?._id) return null;

    const parsed = parseDeviceDetails(device, false);
    const lastInform = parseAcsLastInform(device._lastInform);
    const isOnline = lastInform && (Date.now() - lastInform.getTime() < 10 * 60 * 1000);

    const wlan1 = parsed.wlan.find(w => w.ssidPath && (w.ssidPath.includes('.WLANConfiguration.1.') || w.ssidPath.includes('.SSID.1.')));
    const wlan5 = parsed.wlan.find(w => w.ssidPath && (w.ssidPath.includes('.WLANConfiguration.5.') || w.ssidPath.includes('.SSID.5.')));

    const validWan = parsed.wan.find(w => w.ip && w.ip !== '0.0.0.0' && w.ip !== 'N/A') || parsed.wan[0];
    const validPppoe = parsed.wan.find(w => w.username && w.username !== 'N/A') || parsed.wan[0];
    const validRx = parsed.wan.find(w => w.rxPower !== 'N/A') || parsed.wan[0];

    return {
        serialNumber: device._id,
        productClass: resolveAcsDeviceModel(device, parsed),
        ipAddress: validWan?.ip || null,
        pppoeUsername: validPppoe?.username || null,
        rxPower: validRx?.rxPower ? String(validRx.rxPower) : 'N/A',
        lastInform: lastInform ? toMySQLDatetime(lastInform) : null,
        isOnline: isOnline ? 1 : 0,
        ssid1: wlan1?.ssid || null,
        ssid5: wlan5?.ssid || null,
        ssid1Connected: wlan1?.associatedDevices?.length || 0,
        ssid5Connected: wlan5?.associatedDevices?.length || 0,
    };
};

const buildMinimalAcsDeviceCacheRow = (device) => {
    if (!device?._id) return null;

    const lastInform = parseAcsLastInform(device._lastInform);
    const isOnline = lastInform && (Date.now() - lastInform.getTime() < 10 * 60 * 1000);
    const productClass = resolveAcsDeviceModel(device);

    return {
        serialNumber: device._id,
        productClass,
        lastInform: lastInform ? toMySQLDatetime(lastInform) : null,
        isOnline: isOnline ? 1 : 0,
    };
};

const upsertAcsDevicesBatch = async (devices, { minimal = false } = {}) => {
    const rows = [];
    const serialNumbers = [];

    for (const device of devices) {
        try {
            const row = minimal ? buildMinimalAcsDeviceCacheRow(device) : buildAcsDeviceCacheRow(device);
            if (!row) continue;

            serialNumbers.push(row.serialNumber);
            if (minimal) {
                rows.push([
                    row.serialNumber,
                    row.productClass,
                    row.lastInform,
                    row.isOnline,
                ]);
            } else {
                rows.push([
                    row.serialNumber,
                    row.productClass,
                    row.ipAddress,
                    row.pppoeUsername,
                    row.rxPower,
                    row.lastInform,
                    row.isOnline,
                    row.ssid1,
                    row.ssid5,
                    row.ssid1Connected,
                    row.ssid5Connected,
                ]);
            }
        } catch (err) {
            console.error(`[ACS Sync] Failed parsing device ${device?._id}:`, err);
        }
    }

    if (rows.length === 0) {
        return { processedCount: 0, serialNumbers: [] };
    }

    const placeholders = minimal
        ? rows.map(() => "(?, ?, ?, ?)").join(", ")
        : rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = rows.flat();

    if (minimal) {
        await pool.query(`
            INSERT INTO acs_devices (serialNumber, productClass, lastInform, isOnline)
            VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE
                productClass = VALUES(productClass),
                lastInform = VALUES(lastInform),
                isOnline = VALUES(isOnline)
        `, values);
    } else {
        await pool.query(`
            INSERT INTO acs_devices (serialNumber, productClass, ipAddress, pppoeUsername, rxPower, lastInform, isOnline, ssid1, ssid5, ssid1Connected, ssid5Connected)
            VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE
                productClass = VALUES(productClass),
                ipAddress = VALUES(ipAddress),
                pppoeUsername = VALUES(pppoeUsername),
                rxPower = VALUES(rxPower),
                lastInform = VALUES(lastInform),
                isOnline = VALUES(isOnline),
                ssid1 = VALUES(ssid1),
                ssid5 = VALUES(ssid5),
                ssid1Connected = VALUES(ssid1Connected),
                ssid5Connected = VALUES(ssid5Connected)
        `, values);
    }

    return { processedCount: rows.length, serialNumbers };
};

const upsertAcsDeviceRow = async (row) => {
    if (!row?.serialNumber) {
        return false;
    }

    await pool.query(`
        INSERT INTO acs_devices (serialNumber, productClass, ipAddress, pppoeUsername, rxPower, lastInform, isOnline, ssid1, ssid5, ssid1Connected, ssid5Connected)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            productClass = VALUES(productClass),
            ipAddress = VALUES(ipAddress),
            pppoeUsername = VALUES(pppoeUsername),
            rxPower = VALUES(rxPower),
            lastInform = VALUES(lastInform),
            isOnline = VALUES(isOnline),
            ssid1 = VALUES(ssid1),
            ssid5 = VALUES(ssid5),
            ssid1Connected = VALUES(ssid1Connected),
            ssid5Connected = VALUES(ssid5Connected)
    `, [
        row.serialNumber,
        row.productClass ?? null,
        row.ipAddress ?? null,
        row.pppoeUsername ?? null,
        row.rxPower ?? 'N/A',
        row.lastInform ?? null,
        row.isOnline ? 1 : 0,
        row.ssid1 ?? null,
        row.ssid5 ?? null,
        row.ssid1Connected ?? 0,
        row.ssid5Connected ?? 0,
    ]);

    return true;
};

const estimateAcsSyncProgress = ({ processedCount, pageCount, pageSize }) => {
    const base = Math.max(100, pageSize * 10);
    const estimated = Math.round((processedCount / (processedCount + base)) * 100);
    if (!Number.isFinite(estimated)) {
        return Math.min(99, pageCount * 10);
    }

    return Math.max(1, Math.min(99, estimated));
};

const fetchAllAcsDevices = async (acsSettings, projection = null, options = {}) => {
    const headers = {};
    if (acsSettings.username && acsSettings.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    const timeoutMs = options.timeoutMs ?? ACS_API_TIMEOUT;
    const maxRetries = options.maxRetries ?? ACS_LIST_PAGE_RETRIES;
    const limit = options.limit ?? ACS_SYNC_PAGE_LIMIT;
    const pagePauseMs = options.pagePauseMs ?? 0;
    const collectAll = options.collectAll !== false;
    const onPage = typeof options.onPage === 'function' ? options.onPage : null;
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : null;
    const allDevices = [];
    const seenSerialNumbers = new Set();
    let skip = 0;
    let hasMore = true;
    let pageCount = 0;
    const MAX_PAGES = 50; 

    console.log(`[ACS Helper] Starting paginated fetch for all devices with projection: ${projection || 'none'}`);

    while (hasMore && pageCount < MAX_PAGES) {
        if (shouldStop && await shouldStop()) {
            throw new Error(ACS_SYNC_CANCELLED_MESSAGE);
        }

        pageCount++;
        let url = `${apiUrl}/devices/?limit=${limit}&skip=${skip}`;
        if (projection) {
            url += `&projection=${encodeURIComponent(projection)}`;
        }

        let devicesOnPage = null;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            if (shouldStop && await shouldStop()) {
                throw new Error(ACS_SYNC_CANCELLED_MESSAGE);
            }

            try {
                console.log(`[ACS Helper] Fetching page skip=${skip}, limit=${limit}, attempt=${attempt}/${maxRetries + 1}`);
                devicesOnPage = await fetchJsonWithTimeout(url, {
                    headers,
                    timeoutMs,
                    label: `fetching page skip=${skip}`,
                    shouldStop,
                });

                if (!Array.isArray(devicesOnPage)) {
                    throw new Error("Received unexpected data format from ACS server during pagination.");
                }

                lastError = null;
                break;
            } catch (error) {
                lastError = error;

                const shouldRetry = attempt <= maxRetries && isRetryableAcsPageError(error);
                if (shouldRetry) {
                    console.warn(`[ACS Helper] Error on page skip=${skip} (attempt ${attempt}/${maxRetries + 1}): ${error.message}. Retrying in ${ACS_LIST_RETRY_DELAY_MS}ms...`);
                    await sleep(ACS_LIST_RETRY_DELAY_MS);
                    continue;
                }

                throw error;
            }
        }

        if (lastError) {
            throw lastError;
        }

        if (devicesOnPage.length === 0) {
            hasMore = false;
            continue;
        }

        let isDuplicatePage = true;
        const newDevicesOnPage = [];

        for (const device of devicesOnPage) {
            if (device?._id && !seenSerialNumbers.has(device._id)) {
                isDuplicatePage = false;
                seenSerialNumbers.add(device._id);
                newDevicesOnPage.push(device);
            }
        }

        if (isDuplicatePage && devicesOnPage.length > 0) {
            console.warn(`[ACS Helper] Detected a duplicate page from ACS server at skip=${skip}. Terminating fetch loop.`);
            hasMore = false;
        } else {
            if (onPage) {
                if (shouldStop && await shouldStop()) {
                    throw new Error(ACS_SYNC_CANCELLED_MESSAGE);
                }
                await onPage(newDevicesOnPage, { skip, limit, pageCount });
            }
            if (collectAll) {
                allDevices.push(...newDevicesOnPage);
            }
            if (devicesOnPage.length < limit) {
                hasMore = false;
            } else {
                skip += limit;
            }

            if (pagePauseMs > 0) {
                await sleep(pagePauseMs);
            } else {
                await sleep(0);
            }
        }
    }
    
    return allDevices;
};

const buildDeviceIdCandidates = (rawId) => {
    if (!rawId) return [];
    const candidates = new Set();
    const trimmed = rawId.trim();
    const normalized = trimmed.replace(/\s+/g, " ");
    const safeDecodeURIComponent = (value) => {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    };

    [rawId, trimmed, normalized].forEach((value) => {
        if (value) candidates.add(value);
    });

    const decoded = safeDecodeURIComponent(normalized);
    if (decoded && decoded !== normalized) {
        candidates.add(decoded);
    }

    if (normalized.includes(" ")) {
        candidates.add(normalized.replace(/ /g, "%20"));
    }
    if (normalized.includes("%20")) {
        candidates.add(normalized.replace(/%20/g, " "));
    }

    return Array.from(candidates);
};

const postAcsTaskWithFallback = async ({ apiUrl, headers, deviceId, payload, timeoutMs }) => {
    const candidates = buildDeviceIdCandidates(deviceId);
    if (!candidates.includes(deviceId)) {
        candidates.unshift(deviceId);
    }
    let lastError = null;

    for (const candidate of candidates) {
        const taskUrl = `${apiUrl}/devices/${encodeURIComponent(candidate)}/tasks?connection_request`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(taskUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            if (response.ok) {
                return response;
            }
            const errorText = await response.text().catch(() => '');
            lastError = new Error(`ACS API responded with status ${response.status} for candidate "${candidate}": ${errorText}`);
        } catch (err) {
            if (err?.name === 'AbortError') {
                lastError = new Error(`ACS API timeout for candidate "${candidate}"`);
            } else {
                lastError = err;
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }

    throw lastError || new Error('ACS API request failed');
};

const resolveRealDevice = async (rawId, acsSettings) => {
    if (!acsSettings?.apiUrl) return null;

    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    const headers = {};
    if (acsSettings.username && acsSettings.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    const searchId = async (id) => {
        try {
            const q = encodeURIComponent(JSON.stringify({ _id: id }));
            const response = await fetch(`${apiUrl}/devices?query=${q}&limit=1`, { headers });
            if (response.ok) {
                const arr = await response.json();
                if (Array.isArray(arr) && arr.length > 0) {
                    console.log(`[ACS Resolve] Found device with exact ID: ${id}`);
                    return arr[0]._id;
                }
            }
        } catch (e) {
            console.warn(`[ACS Resolve] Error searching for ID ${id}:`, e);
        }
        return null;
    };

    // 1. Try exact ID candidates (raw, normalized, encoded space variants)
    const baseCandidates = buildDeviceIdCandidates(rawId);
    for (const candidate of baseCandidates) {
        const foundId = await searchId(candidate);
        if (foundId) return foundId;
    }

    // 2. Try variations based on normalized whitespace
    const normalized = rawId.trim().replace(/\s+/g, " ");

    const hyphenated = normalized.replace(/\s+/g, "-");
    let foundId = await searchId(hyphenated);
    if (foundId) return foundId;

    const underscored = normalized.replace(/\s+/g, "_");
    foundId = await searchId(underscored);
    if (foundId) return foundId;
    
    const nonspaced = normalized.replace(/\s+/g, "");
    if (nonspaced !== normalized) {
        foundId = await searchId(nonspaced);
        if (foundId) return foundId;
    }

    // 3. If still not found, try a more flexible regex search
    try {
        const regexPattern = normalized.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
        const q = encodeURIComponent(JSON.stringify({ _id: { $regex: regexPattern, $options: 'i' } }));
        const response = await fetch(`${apiUrl}/devices?query=${q}&limit=1`, { headers });
        if (response.ok) {
            const arr = await response.json();
            if (Array.isArray(arr) && arr.length > 0) {
                console.log(`[ACS Resolve] Found device with regex: ${regexPattern}`);
                return arr[0]._id;
            }
        }
    } catch (e) {
        console.error("[ACS Resolve] Regex search error:", e);
    }
    
    console.warn(`[ACS Resolve] Failed to resolve device ID for: ${rawId}`);
    return null;
};

const getCachedDeviceByCandidates = async (candidates) => {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }
    const placeholders = candidates.map(() => '?').join(',');
    const [rows] = await pool.query(
        `SELECT * FROM acs_devices WHERE serialNumber IN (${placeholders}) LIMIT 1`,
        candidates
    );
    return rows.length > 0 ? rows[0] : null;
};

const buildCachedDeviceDetails = (cached) => {
    const wlanEntries = [];
    if (cached?.ssid1) {
        wlanEntries.push({
            name: 'WLAN 2.4G',
            ssid: cached.ssid1,
            key: '',
            enabled: null,
            status: cached.isOnline ? 'Up' : 'Down',
            security: 'N/A',
            ssidPath: '',
            keyPath: '',
            band: '2.4',
            associatedDevices: [],
        });
    }
    if (cached?.ssid5) {
        wlanEntries.push({
            name: 'WLAN 5G',
            ssid: cached.ssid5,
            key: '',
            enabled: null,
            status: cached.isOnline ? 'Up' : 'Down',
            security: 'N/A',
            ssidPath: '',
            keyPath: '',
            band: '5',
            associatedDevices: [],
        });
    }

    return {
        general: {
            firmware: null,
            uptime: null,
            model: cached?.productClass || 'Unknown',
            hardwareVersion: null,
        },
        wan: [
            {
                type: 'WAN',
                status: cached?.isOnline ? 'Online' : 'Offline',
                username: cached?.pppoeUsername || 'N/A',
                usernamePath: null,
                passwordPath: null,
                ip: cached?.ipAddress || 'N/A',
                dns: null,
                rxPower: cached?.rxPower || 'N/A',
            },
        ],
        wlan: wlanEntries,
        lan: {
            ip: null,
            subnet: null,
            connectedHosts: [],
        },
        raw: {
            cached: true,
            device: cached,
        },
    };
};

/* ============================================================
   MAIN ROUTES
============================================================ */

// GET devices LIVE from ACS Server (With Database Fallback)
router.get("/devices", async (req, res) => {
  console.log('[ACS Live] Fetching live device list from ACS server with DB fallback...');
  const settings = await getSettings();
  const acsSettings = settings.acs;
  try {
    if (!acsSettings?.apiUrl) {
        return res.json({ devices: [] });
    }
    
    // 1. Fetch cached data from DB for fallback
    const [cachedRows] = await pool.query("SELECT * FROM acs_devices");
    const cacheMap = new Map(cachedRows.map(row => [row.serialNumber, row]));

    // 2. Fetch Live Data
    // Added _deviceId to projection to help with model detection
    const projection = "_id,_deviceId,_lastInform,summary,InternetGatewayDevice.LANDevice,InternetGatewayDevice.WANDevice,InternetGatewayDevice.DeviceInfo,Device.WiFi,Device.Hosts,Device.DeviceInfo,Device.PPP,Device.IP,Device.Optical";
    const acsData = await fetchAllAcsDevices(acsSettings, projection);

    const [customers] = await pool.query("SELECT id, name, acsSerialNumber FROM customers WHERE acsSerialNumber IS NOT NULL");
    const customerMap = new Map(customers.map(c => [c.acsSerialNumber, c]));

    const merged = acsData.map(device => {
        const cached = cacheMap.get(device?._id) || {};

        try {
            if (!device?._id) return null;
            
            // Parse live data
            const parsed = parseDeviceDetails(device, false); 
            const customer = customerMap.get(device._id);
            
            const lastInformRaw = parseAcsLastInform(device._lastInform);
            const isOnline = lastInformRaw && (Date.now() - lastInformRaw.getTime() < 10 * 60 * 1000);
            
            // WLAN Logic (Try live, fallback to cache)
            const wlan1 = parsed.wlan.find(w => w.ssidPath && (w.ssidPath.includes('.WLANConfiguration.1.') || w.ssidPath.includes('.SSID.1.') || w.ssidPath.includes('WiFi.Radio.1.')));
            const wlan5 = parsed.wlan.find(w => w.ssidPath && (w.ssidPath.includes('.WLANConfiguration.5.') || w.ssidPath.includes('.SSID.5.') || w.ssidPath.includes('WiFi.Radio.2.')));
            
            // Strict fallback: use cache if live is missing or empty string
            const ssid1Val = (wlan1 && wlan1.ssid) ? wlan1.ssid : (cached.ssid1 || null);
            const ssid5Val = (wlan5 && wlan5.ssid) ? wlan5.ssid : (cached.ssid5 || null);

            // WAN/IP Logic (Try live, fallback to cache)
            const validWan = parsed.wan.find(w => w.ip && w.ip !== '0.0.0.0' && w.ip !== 'N/A') || parsed.wan[0];
            const validPppoe = parsed.wan.find(w => w.username && w.username !== 'N/A') || parsed.wan[0];
            const validRx = parsed.wan.find(w => w.rxPower !== 'N/A') || parsed.wan[0];

            let ipAddress = validWan?.ip;
            if (!ipAddress || ipAddress === '0.0.0.0' || ipAddress === 'N/A') {
                ipAddress = cached.ipAddress && cached.ipAddress !== '0.0.0.0' ? cached.ipAddress : (ipAddress || 'N/A');
            }

            let pppoeUsername = validPppoe?.username;
            if (!pppoeUsername || pppoeUsername === 'N/A') {
                pppoeUsername = cached.pppoeUsername || 'N/A';
            }

            let rxPower = validRx?.rxPower;
            if (!rxPower || rxPower === 'N/A') {
                rxPower = cached.rxPower || 'N/A';
            }
            
            let model = parsed.general.model;
            if (!model || model === 'N/A') {
                model = cached.productClass || 'N/A';
            }
            
            // Check if lastInform is very old or missing in live data (unlikely but possible)
            const finalLastInform = lastInformRaw
                ? dbDateToISO(lastInformRaw)
                : (cached.lastInform ? dbDateToISO(cached.lastInform) : null);

            return {
                id: device._id, serialNumber: device._id,
                productClass: model, 
                ipAddress: ipAddress,
                pppoeUsername: pppoeUsername,
                rxPower: rxPower,
                lastInform: finalLastInform, 
                isOnline: isOnline,
                ssid1: ssid1Val,
                ssid5: ssid5Val,
                ssid1Connected: wlan1?.associatedDevices?.length || cached.ssid1Connected || 0,
                ssid5Connected: wlan5?.associatedDevices?.length || cached.ssid5Connected || 0,
                customerId: customer?.id || null, 
                customerName: customer?.name || null,
            };
        } catch (err) {
            console.error(`[ACS List] Error parsing device ${device?._id}:`, err);
            // If live parsing fails completely, return full cached object if available
            if (cached.serialNumber) {
                const customer = customerMap.get(cached.serialNumber);
                 return {
                    id: cached.serialNumber,
                    serialNumber: cached.serialNumber,
                    productClass: cached.productClass || 'N/A',
                    ipAddress: cached.ipAddress || 'N/A',
                    pppoeUsername: cached.pppoeUsername || 'N/A',
                    rxPower: cached.rxPower || 'N/A',
                    lastInform: dbDateToISO(cached.lastInform),
                    isOnline: cached.isOnline === 1,
                    ssid1: cached.ssid1,
                    ssid5: cached.ssid5,
                    ssid1Connected: cached.ssid1Connected || 0,
                    ssid5Connected: cached.ssid5Connected || 0,
                    customerId: customer?.id || null,
                    customerName: customer?.name || null
                };
            }
            return null;
        }
    }).filter(Boolean);

    // Update cache in background to save the fresh successful reads
    (async () => {
        try {
            for (const d of merged) {
                const lastInformForDb = parseAcsLastInform(d.lastInform);
                await pool.query(`
                    INSERT INTO acs_devices (serialNumber, productClass, ipAddress, pppoeUsername, rxPower, lastInform, isOnline, ssid1, ssid5, ssid1Connected, ssid5Connected) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
                    ON DUPLICATE KEY UPDATE 
                    productClass = VALUES(productClass), 
                    ipAddress = VALUES(ipAddress), 
                    pppoeUsername = VALUES(pppoeUsername), 
                    rxPower = VALUES(rxPower), 
                    lastInform = VALUES(lastInform), 
                    isOnline = VALUES(isOnline),
                    ssid1 = VALUES(ssid1),
                    ssid5 = VALUES(ssid5),
                    ssid1Connected = VALUES(ssid1Connected),
                    ssid5Connected = VALUES(ssid5Connected)
                `, [d.serialNumber, d.productClass, d.ipAddress, d.pppoeUsername, d.rxPower, lastInformForDb ? toMySQLDatetime(lastInformForDb) : null, d.isOnline ? 1 : 0, d.ssid1, d.ssid5, d.ssid1Connected, d.ssid5Connected]);
            }
        } catch (bgErr) {
            console.error("[ACS Live] Background cache update failed:", bgErr);
        }
    })();

    res.json({ devices: merged });

  } catch (error) {
    handleAcsFetchError(error, res, 'fetching live devices', acsSettings.apiUrl);
  }
});

// GET devices from local DB CACHE
router.get("/devices/cached", async (req, res) => {
    console.log('[ACS Cached] Fetching cached device list from database...');
    try {
        const response = await getAcsCachedDevicesResponse({ fast: false });
        res.json(response);
    } catch (error) {
        console.error('[ACS Cached] Error fetching from database cache:', error);
        res.json({ devices: [], lastSyncTime: null, warning: 'Failed to retrieve cached device data.' });
    }
});

router.get("/devices/cached/fast", async (req, res) => {
    console.log('[ACS Cached Fast] Fetching lightweight cached device list from database...');
    try {
        const activeWork = await buildActiveAcsWorkConflict('Another ACS job is already active. Please wait until it finishes.');
        if (activeWork) {
            return res.status(activeWork.status).json(activeWork.body);
        }
        const response = await getAcsCachedDevicesResponse({ fast: true });
        res.json(response);
    } catch (error) {
        console.error('[ACS Cached Fast] Error fetching lightweight cache:', error);
        res.json({ devices: [], lastSyncTime: null, warning: 'Failed to retrieve cached device data.' });
    }
});

router.get("/devices/cached/rows", async (req, res) => {
    console.log('[ACS Cached Rows] Fetching selected cached device rows from database...');
    try {
        const idsParam = String(req.query.ids || '').trim();
        const serialNumbers = idsParam
            ? [...new Set(idsParam.split(',').map((id) => decodeURIComponent(id).trim()).filter(Boolean))]
            : [];

        if (serialNumbers.length === 0) {
            return res.json({ devices: [], lastSyncTime: null });
        }

        const [devices, lastSyncTime] = await Promise.all([
            fetchAcsCachedDeviceRows({ includeCustomerJoin: true, serialNumbers }),
            fetchAcsCachedLastSyncTime(),
        ]);

        return res.json({
            devices: devices.map(formatAcsCachedDeviceRow),
            lastSyncTime: dbDateToISO(lastSyncTime),
        });
    } catch (error) {
        console.error('[ACS Cached Rows] Error fetching selected cache rows:', error);
        return res.status(500).json({
            message: 'Failed to retrieve selected cached device rows.',
            devices: [],
            lastSyncTime: null,
        });
    }
});


router.get("/sync/jobs/active", async (req, res) => {
    try {
        const job = await getActiveAcsSyncJob();
        return res.json({
            success: true,
            job: job ? formatAcsSyncJob(job) : null,
            liveRefresh: formatAcsLiveRefreshState(),
        });
    } catch (error) {
        console.error('[ACS Sync] Error fetching active job:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch active ACS sync job.',
        });
    }
});

router.get("/sync/jobs/:jobId", async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await getAcsSyncJobById(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'ACS sync job not found.',
            });
        }

        return res.json({ success: true, job: formatAcsSyncJob(job) });
    } catch (error) {
        console.error('[ACS Sync] Error fetching job status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch ACS sync job status.',
        });
    }
});

router.post("/sync/jobs/:jobId/cancel", async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await getAcsSyncJobById(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'ACS sync job not found.',
            });
        }

        if (job.status === ACS_SYNC_JOB_STATUSES.CANCELLED) {
            return res.json({
                success: true,
                message: ACS_SYNC_CANCELLED_MESSAGE,
                job: formatAcsSyncJob(job),
            });
        }

        if (![ACS_SYNC_JOB_STATUSES.QUEUED, ACS_SYNC_JOB_STATUSES.RUNNING].includes(job.status)) {
            return res.status(409).json({
                success: false,
                message: `ACS sync job cannot be cancelled because it is already ${job.status}.`,
                job: formatAcsSyncJob(job),
            });
        }

        const cancelled = await cancelAcsSyncJob(jobId);
        if (!cancelled) {
            const latestJob = await getAcsSyncJobById(jobId);
            return res.status(409).json({
                success: false,
                message: 'ACS sync job could not be cancelled.',
                job: formatAcsSyncJob(latestJob),
            });
        }

        const updatedJob = await getAcsSyncJobById(jobId);
        return res.json({
            success: true,
            message: ACS_SYNC_CANCELLED_MESSAGE,
            job: formatAcsSyncJob(updatedJob),
        });
    } catch (error) {
        console.error('[ACS Sync] Error cancelling job:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to cancel ACS sync job.',
        });
    }
});

// POST to enqueue a sync job from ACS server to local DB
router.post("/sync", async (req, res) => {
    console.log('[ACS Sync] Enqueue sync job request...');
    try {
        const settings = await getSettings();
        const acsSettings = settings.acs;

        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ success: false, message: "ACS API URL is not configured." });
        }

        const activeWork = await buildActiveAcsWorkConflict('Another ACS job is already active. Please wait until it finishes.');
        if (activeWork) {
            return res.status(activeWork.status).json(activeWork.body);
        }

        const job = await createAcsSyncJob();

        setImmediate(() => {
            processAcsSyncQueue().catch((err) => {
                console.error('[ACS Sync] Error while starting queued job:', err);
            });
        });

        return res.status(202).json({
            success: true,
            started: true,
            message: 'ACS sync job queued and will run in the background.',
            job: formatAcsSyncJob(job),
        });
    } catch (error) {
        console.error('[ACS Sync] Fatal error while enqueueing sync job:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to enqueue ACS sync job.',
        });
    }
});

export const runAcsSyncJob = async (jobId) => {
    const job = await getAcsSyncJobById(jobId);
    if (!job) {
        return;
    }

    if (job.status === ACS_SYNC_JOB_STATUSES.CANCELLED) {
        return;
    }

    if (![ACS_SYNC_JOB_STATUSES.QUEUED, ACS_SYNC_JOB_STATUSES.RUNNING].includes(job.status)) {
        return;
    }

    const settings = await getSettings();
    const acsSettings = settings.acs;
    if (!acsSettings?.apiUrl) {
        await finalizeAcsSyncJob(jobId, ACS_SYNC_JOB_STATUSES.FAILED, {
            error_message: 'ACS API URL is not configured.',
            message: 'ACS API URL is not configured.',
        });
        return;
    }

    await updateAcsSyncJob(jobId, {
        status: ACS_SYNC_JOB_STATUSES.RUNNING,
        started_at: job.started_at || new Date(),
        processed_count: Number(job.processed_count || 0),
        error_message: null,
        message: 'Fetching device pages from ACS server...',
        updated_at: new Date(),
    });

    if (await isAcsSyncJobCancelled(jobId)) {
        await finalizeAcsSyncJob(jobId, ACS_SYNC_JOB_STATUSES.CANCELLED, {
            processed_count: Number(job.processed_count || 0),
            progress_percent: Number(job.progress_percent || 0),
            message: ACS_SYNC_CANCELLED_MESSAGE,
        });
        return;
    }

    const projection = ACS_SYNC_MINIMAL_PROJECTION;
    const liveSerialNumbers = new Set();
    let processedCount = Number(job.processed_count || 0);
    let currentProgressPercent = Number(job.progress_percent || 0);

    try {
    await fetchAllAcsDevices(acsSettings, projection, {
            timeoutMs: ACS_SYNC_LIST_TIMEOUT,
            maxRetries: ACS_LIST_PAGE_RETRIES,
            limit: ACS_SYNC_PAGE_LIMIT,
            pagePauseMs: ACS_SYNC_PAGE_PAUSE_MS,
            collectAll: false,
            shouldStop: () => isAcsSyncJobCancelled(jobId),
            onPage: async (devicesOnPage, { skip, pageCount }) => {
                if (await isAcsSyncJobCancelled(jobId)) {
                    throw new Error(ACS_SYNC_CANCELLED_MESSAGE);
                }

                if (!Array.isArray(devicesOnPage) || devicesOnPage.length === 0) {
                    return;
                }

                const { processedCount: pageProcessed, serialNumbers } = await upsertAcsDevicesBatch(devicesOnPage, { minimal: true });
                processedCount += pageProcessed;
                serialNumbers.forEach((sn) => liveSerialNumbers.add(sn));
                const progressPercent = estimateAcsSyncProgress({
                    processedCount,
                    pageCount,
                    pageSize: devicesOnPage.length,
                });
                currentProgressPercent = progressPercent;

                if (pageCount % ACS_SYNC_PROGRESS_UPDATE_EVERY_PAGES === 0 || progressPercent >= 99) {
                    await updateAcsSyncJob(jobId, {
                        processed_count: processedCount,
                        progress_percent: progressPercent,
                        message: `Processed ${processedCount} device(s).`,
                        updated_at: new Date(),
                    });
                }

                if (await isAcsSyncJobCancelled(jobId)) {
                    throw new Error(ACS_SYNC_CANCELLED_MESSAGE);
                }
            },
        });

        if (await isAcsSyncJobCancelled(jobId)) {
            await finalizeAcsSyncJob(jobId, ACS_SYNC_JOB_STATUSES.CANCELLED, {
                processed_count: processedCount,
                progress_percent: currentProgressPercent,
                message: ACS_SYNC_CANCELLED_MESSAGE,
            });
            return;
        }

        await updateAcsSyncJob(jobId, {
            message: 'Cleaning up stale ACS cache entries...',
            updated_at: new Date(),
        });

        if (await isAcsSyncJobCancelled(jobId)) {
            await finalizeAcsSyncJob(jobId, ACS_SYNC_JOB_STATUSES.CANCELLED, {
                processed_count: processedCount,
                progress_percent: currentProgressPercent,
                message: ACS_SYNC_CANCELLED_MESSAGE,
            });
            return;
        }

        const [cachedDevices] = await pool.query("SELECT serialNumber FROM acs_devices");
        const cachedSerialNumbers = cachedDevices.map((d) => d.serialNumber);
        const numbersToDelete = cachedSerialNumbers.filter((sn) => !liveSerialNumbers.has(sn));

        if (numbersToDelete.length > 0) {
            await pool.query('DELETE FROM acs_devices WHERE serialNumber IN (?)', [numbersToDelete]);
        }

        if (await isAcsSyncJobCancelled(jobId)) {
            await finalizeAcsSyncJob(jobId, ACS_SYNC_JOB_STATUSES.CANCELLED, {
                processed_count: processedCount,
                progress_percent: currentProgressPercent,
                message: ACS_SYNC_CANCELLED_MESSAGE,
            });
            return;
        }

        await finalizeAcsSyncJob(jobId, ACS_SYNC_JOB_STATUSES.COMPLETED, {
            processed_count: processedCount,
            progress_percent: 100,
            message: isLightweightRuntime
                ? `Database synced with ${processedCount} device(s). Minimal sync mode is active.`
                : `Database synced with ${processedCount} device(s) using minimal payload.`,
        });
    } catch (error) {
        if (error.message === ACS_SYNC_CANCELLED_MESSAGE) {
            await finalizeAcsSyncJob(jobId, ACS_SYNC_JOB_STATUSES.CANCELLED, {
                processed_count: processedCount,
                progress_percent: currentProgressPercent,
                message: ACS_SYNC_CANCELLED_MESSAGE,
            });
            return;
        }

        console.error(`[ACS Job] Sync job ${jobId} failed:`, error);
        await finalizeAcsSyncJob(jobId, ACS_SYNC_JOB_STATUSES.FAILED, {
            error_message: error.message || 'Unknown ACS sync job error',
            message: error.message || 'ACS sync job failed.',
            progress_percent: currentProgressPercent,
        });
    }
};

const triggerBackgroundSummon = async (deviceIds, acsSettings, jobId = null) => {
    const headers = {};
    if (acsSettings.username && acsSettings.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }
    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    
    const taskPayload = { 
        name: "getParameterValues", 
        parameterNames: [
            "InternetGatewayDevice.DeviceInfo.SerialNumber",
            "Device.DeviceInfo.SerialNumber",
            "InternetGatewayDevice.LANDevice.*.WLANConfiguration",
             "InternetGatewayDevice.LANInterfaces.WLANConfiguration",
            "VirtualParameters.pppIP",
            "VirtualParameters.pppUsername",
            "VirtualParameters.uptimeDevice",
            "VirtualParameters.temp",
            "VirtualParameters.MacAddress",
            "VirtualParameters.PonMode",
            "VirtualParameters.redaman",
            "VirtualParameters.WebSuperUser",
            "VirtualParameters.PasswordSuperUser",
            "VirtualParameters.softwareVersion",
            "VirtualParameters.userconnected",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID",
            "InternetGatewayDevice.ManagementServer.URL",
            "InternetGatewayDevice.ManagementServer.Username",
            "InternetGatewayDevice.ManagementServer.Password"
        ] 
    };

    const parsePositiveInt = (value, fallback) => {
        const parsed = Number.parseInt(String(value ?? '').trim(), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };

    const BATCH_SIZE = parsePositiveInt(process.env.ACS_BACKGROUND_SUMMON_BATCH_SIZE, 10);
    const BATCH_DELAY_MS = parsePositiveInt(process.env.ACS_BACKGROUND_SUMMON_DELAY_MS, 100);
    const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.ACS_BACKGROUND_SUMMON_REQUEST_TIMEOUT_MS, 12000);
    let triggeredCount = 0;
    const ids = Array.isArray(deviceIds) ? deviceIds.filter(Boolean) : [];

    console.log(
        `[ACS Background] Starting summon for ${ids.length} device(s) with batchSize=${BATCH_SIZE}, delay=${BATCH_DELAY_MS}ms, timeout=${REQUEST_TIMEOUT_MS}ms.`
    );

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        if (jobId && await isAcsSyncJobCancelled(jobId)) {
            throw new Error(ACS_SYNC_CANCELLED_MESSAGE);
        }

        const chunk = ids.slice(i, i + BATCH_SIZE);
        await Promise.all(chunk.map(async (deviceId) => {
            if (jobId && await isAcsSyncJobCancelled(jobId)) {
                throw new Error(ACS_SYNC_CANCELLED_MESSAGE);
            }

            if (!deviceId) return;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            try {
                const taskUrl = `${apiUrl}/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`;
                await fetch(taskUrl, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskPayload),
                    signal: controller.signal
                });
                triggeredCount++;
            } catch (e) { 
                console.warn(`[ACS Background] Failed to summon ${deviceId}:`, e.message);
            } finally {
                clearTimeout(timeoutId);
            }
        }));

        if (jobId && await isAcsSyncJobCancelled(jobId)) {
            throw new Error(ACS_SYNC_CANCELLED_MESSAGE);
        }

        if (i + BATCH_SIZE < ids.length && BATCH_DELAY_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
    }
    console.log(`[ACS Background] Finished summoning. Sent commands to ${triggeredCount} devices.`);
};


router.post("/devices/:id(*)/summon", async (req, res) => {
    const rawId = req.deviceId;
    const { parameters } = req.body;
    const settings = await getSettings();
    const acsSettings = settings.acs;
    try {
        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ message: "ACS API URL is not configured." });
        }

        const realId = await resolveRealDevice(rawId, acsSettings);
        const targetId = realId || rawId;

        const headers = { 'Content-Type': 'application/json' };
        if (acsSettings.username && acsSettings.password) {
            headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
        }

        const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
        
        const defaultParameters = [
            "InternetGatewayDevice.DeviceInfo.SerialNumber",
            "Device.DeviceInfo.SerialNumber",
            "InternetGatewayDevice.LANDevice.*.WLANConfiguration",
             "InternetGatewayDevice.LANInterfaces.WLANConfiguration",
            "VirtualParameters.pppIP",
            "VirtualParameters.pppUsername",
            "VirtualParameters.uptimeDevice",
            "VirtualParameters.temp",
            "VirtualParameters.MacAddress",
            "VirtualParameters.PonMode",
            "VirtualParameters.redaman",
            "VirtualParameters.WebSuperUser",
            "VirtualParameters.PasswordSuperUser",
            "VirtualParameters.softwareVersion",
            "VirtualParameters.userconnected",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID",
            "InternetGatewayDevice.ManagementServer.URL",
            "InternetGatewayDevice.ManagementServer.Username",
            "InternetGatewayDevice.ManagementServer.Password"
        ];

        const parameterNames = (Array.isArray(parameters) && parameters.length > 0)
            ? parameters
            : defaultParameters;

        const taskPayload = {
            name: "getParameterValues",
            parameterNames: parameterNames
        };

        console.log(`[ACS Summon] Target: ${targetId}. Sending task with parameters:`, parameterNames);

        await postAcsTaskWithFallback({
            apiUrl,
            headers,
            deviceId: targetId,
            payload: taskPayload,
            timeoutMs: ACS_API_TIMEOUT,
        });

        res.json({ success: true, message: `Summon command sent to device ${targetId}. It should update shortly.` });
    } catch (error) {
        handleAcsFetchError(error, res, `summoning device ${rawId}`, acsSettings.apiUrl);
    }
});

router.get("/customer-device/details", async (req, res) => {
    const { customerId, refresh } = req.query;
    
    if (!customerId) {
        return res.status(400).json({ message: "Customer ID is required." });
    }

    const settings = await getSettings();
    const acsSettings = settings.acs;

    try {
        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ message: "ACS API URL is not configured." });
        }

        // Cari device berdasarkan customerId
        const [[customer]] = await pool.query(
            "SELECT acsSerialNumber FROM customers WHERE id = ?", 
            [customerId]
        );
        
        if (!customer || !customer.acsSerialNumber) {
            return res.status(404).json({ 
                message: "No linked ACS device found for this customer." 
            });
        }

        const serialNumber = customer.acsSerialNumber;
        const forceRefresh = refresh === 'true';

        // Jika force refresh, kirim task getParameterValues terlebih dahulu
        if (forceRefresh) {
            try {
                const realId = await resolveRealDevice(serialNumber, acsSettings);
                const targetId = realId || serialNumber;

                const headers = { 'Content-Type': 'application/json' };
                if (acsSettings.username && acsSettings.password) {
                    headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
                }

                const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
                const taskUrl = `${apiUrl}/devices/${encodeURIComponent(targetId)}/tasks?connection_request`;
                
                const taskPayload = {
                    name: "getParameterValues",
                    parameterNames: [
                        "InternetGatewayDevice.DeviceInfo.SerialNumber",
                        "Device.DeviceInfo.SerialNumber",
                        "InternetGatewayDevice.DeviceInfo.HardwareVersion",
                        "Device.DeviceInfo.HardwareVersion",
                        "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
                        "Device.DeviceInfo.SoftwareVersion"
                    ]
                };

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // Timeout pendek untuk trigger

                try {
                    await fetch(taskUrl, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(taskPayload),
                        signal: controller.signal,
                    });
                    // Tidak menunggu response lengkap, langsung ambil details
                } catch (taskError) {
                    console.log(`Refresh trigger mungkin timeout, melanjutkan get details...`);
                } finally {
                    clearTimeout(timeoutId);
                }
            } catch (refreshError) {
                console.error(`Error triggering refresh:`, refreshError);
                // Lanjutkan untuk get details meskipun refresh gagal
            }
        }

        // Get device details (baik yang cached atau fresh)
        const realId = await resolveRealDevice(serialNumber, acsSettings);
        
        if (!realId) {
            return res.status(404).json({
                message: `Device not found in ACS for customer ID: ${customerId}.`,
            });
        }

        const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
        const headers = {};
        if (acsSettings.username && acsSettings.password) {
            headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
        }

        const q = encodeURIComponent(JSON.stringify({ _id: realId }));
        const url = `${apiUrl}/devices?query=${q}`;

        const response = await fetch(url, { headers });

        if (!response.ok) {
            throw new Error(`ACS API responded with status ${response.status}`);
        }

        const arr = await response.json();
        if (!Array.isArray(arr) || arr.length === 0) {
            return res.status(404).json({ 
                message: `Device ${realId} found in index but details fetch returned empty.` 
            });
        }
        
        const device = arr[0];
        const parsed = parseDeviceDetails(device);
        
        res.json({ 
            success: true, 
            data: parsed,
            refreshTriggered: forceRefresh
        });

    } catch (error) {
        handleAcsFetchError(error, res, `getting device details for customer ${customerId}`, acsSettings?.apiUrl);
    }
});


router.post("/devices/:id(*)/set-parameters", async (req, res) => {
    const rawId = req.deviceId;
    const { parameters } = req.body;
    const settings = await getSettings();
    const acsSettings = settings.acs;

    if (!Array.isArray(parameters) || parameters.length === 0) {
        return res.status(400).json({ message: "An array of parameters is required." });
    }

    try {
        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ message: "ACS API URL is not configured." });
        }

        const realId = await resolveRealDevice(rawId, acsSettings);
        const targetId = realId || rawId;

        const headers = { 'Content-Type': 'application/json' };
        if (acsSettings.username && acsSettings.password) {
            headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
        }

        const parameterValues = parameters.map(p => [p.path, p.value, "xsd:string"]);
        const taskPayload = { name: "setParameterValues", parameterValues };
        const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");

        await postAcsTaskWithFallback({
            apiUrl,
            headers,
            deviceId: targetId,
            payload: taskPayload,
            timeoutMs: ACS_API_TIMEOUT,
        });

        res.json({ success: true, message: `Task to update ${parameters.length} parameter(s) has been queued for device ${targetId}.` });
    } catch (error) {
        handleAcsFetchError(error, res, `setting parameters for device ${rawId}`, acsSettings.apiUrl);
    }
});

router.post("/devices/:id(*)/reboot", async (req, res) => {
    const rawId = req.deviceId;
    const settings = await getSettings();
    const acsSettings = settings.acs;

    try {
        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ message: "ACS API URL is not configured." });
        }

        const realId = await resolveRealDevice(rawId, acsSettings);
        const targetId = realId || rawId;

        const headers = { 'Content-Type': 'application/json' };
        if (acsSettings.username && acsSettings.password) {
            headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
        }

        const taskPayload = { name: "reboot" };
        const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");

        await postAcsTaskWithFallback({
            apiUrl,
            headers,
            deviceId: targetId,
            payload: taskPayload,
            timeoutMs: ACS_API_TIMEOUT,
        });

        res.json({ success: true, message: `Reboot task has been queued for device ${targetId}.` });
    } catch (error) {
        handleAcsFetchError(error, res, `rebooting device ${rawId}`, acsSettings.apiUrl);
    }
});

router.get("/customer-device", async (req, res) => {
    const { customerId } = req.query;
    const settings = await getSettings();
    const acsSettings = settings.acs;
    try {
        const details = await getCustomerDeviceDetails(customerId);
        res.json(details);
    } catch (error) {
        handleAcsFetchError(error, res, `fetching customer device for ${customerId}`, acsSettings.apiUrl);
    }
});

router.post("/customer-device/refresh", async (req, res) => {
    const { customerId, parameters } = req.body;
    
    console.log('🔍 Refresh request received for customer:', customerId);
    
    if (!customerId) {
        return res.status(400).json({ 
            success: false,
            message: "Customer ID is required." 
        });
    }

    const settings = await getSettings();
    const acsSettings = settings.acs;

    try {
        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ 
                success: false,
                message: "ACS API URL is not configured." 
            });
        }

        // Cari device berdasarkan customerId
        const [[customer]] = await pool.query(
            "SELECT acsSerialNumber FROM customers WHERE id = ?", 
            [customerId]
        );
        
        if (!customer || !customer.acsSerialNumber) {
            return res.status(404).json({ 
                success: false,
                message: "No linked ACS device found for this customer." 
            });
        }

        const serialNumber = customer.acsSerialNumber;
        console.log('📱 Found device serial:', serialNumber);
        
        const realId = await resolveRealDevice(serialNumber, acsSettings);
        const targetId = realId || serialNumber;
        console.log('🎯 Target device ID:', targetId);

        const headers = { 'Content-Type': 'application/json' };
        if (acsSettings.username && acsSettings.password) {
            headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
        }

        const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
        const taskUrl = `${apiUrl}/devices/${encodeURIComponent(targetId)}/tasks?connection_request`;
        
        const defaultParameters = [
            "InternetGatewayDevice.DeviceInfo.SerialNumber",
            "Device.DeviceInfo.SerialNumber",
            "InternetGatewayDevice.DeviceInfo.HardwareVersion",
            "Device.DeviceInfo.HardwareVersion",
            "InternetGatewayDevice.DeviceInfo.SoftwareVersion", 
            "Device.DeviceInfo.SoftwareVersion"
        ];

        const taskPayload = {
            name: "getParameterValues",
            parameterNames: parameters || defaultParameters
        };

        console.log('🚀 Sending task to ACS:', taskUrl);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ACS_API_TIMEOUT);

        try {
            const response = await fetch(taskUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(taskPayload),
                signal: controller.signal,
            });

            console.log('📡 ACS API response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ ACS API error:', errorText);
                throw new Error(`ACS API responded with status ${response.status}: ${errorText}`);
            }

            // Try to parse ACS response, but don't fail if it's empty
            let acsResponse = {};
            try {
                acsResponse = await response.json();
                console.log('✅ ACS API success response received');
            } catch (parseError) {
                console.log('⚠️ ACS response is not JSON, but request was successful');
            }

            console.log('✅ Refresh successful for device:', targetId);
            
            res.json({ 
                success: true, 
                message: `Refresh command sent to device ${targetId}. It should update shortly.`,
                data: { 
                    deviceId: targetId, 
                    customerId,
                    acsResponse 
                }
            });

        } catch (fetchError) {
            console.error('❌ Fetch error in refresh:', fetchError);
            throw fetchError;
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (error) {
        console.error('❌ General error in refresh endpoint:', error);
        // **GUARANTEE JSON RESPONSE** even in error cases
        handleAcsFetchError(error, res, `refreshing device for customer ${customerId}`, acsSettings?.apiUrl);
    }
});

router.post("/customer-device/summon", async (req, res) => {
    const { customerId } = req.body;
    if (!customerId) {
        return res.status(400).json({ message: "Customer ID is required." });
    }
    const settings = await getSettings();
    const acsSettings = settings.acs;

    try {
        const [[customer]] = await pool.query("SELECT acsSerialNumber FROM customers WHERE id = ?", [customerId]);
        if (!customer || !customer.acsSerialNumber) {
            return res.status(404).json({ message: "No linked ACS device found for this customer to summon." });
        }
        const serialNumber = customer.acsSerialNumber;

        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ message: "ACS API URL is not configured." });
        }

        const realId = await resolveRealDevice(serialNumber, acsSettings);
        const targetId = realId || serialNumber;

        const headers = { 'Content-Type': 'application/json' };
        if (acsSettings.username && acsSettings.password) {
            headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
        }

        const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
        const taskUrl = `${apiUrl}/devices/${encodeURIComponent(targetId)}/tasks?connection_request`;
        
        const taskPayload = {
            name: "getParameterValues",
            parameterNames: [
                "InternetGatewayDevice.DeviceInfo.SerialNumber",
                "Device.DeviceInfo.SerialNumber"
            ]
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ACS_API_TIMEOUT);

        try {
            const response = await fetch(taskUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(taskPayload),
                signal: controller.signal,
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`ACS API responded with status ${response.status}: ${errorText}`);
            }

            res.json({ success: true, message: `Data retrieval command sent to device ${targetId}.` });

        } finally {
            clearTimeout(timeoutId);
        }
    } catch (error) {
        handleAcsFetchError(error, res, `summoning device for customer ${customerId}`, acsSettings.apiUrl);
    }
});

router.post("/customer-device/update-wlan", async (req, res) => {
    const { customerId, ssid, key } = req.body;
    const settings = await getSettings();
    const acsSettings = settings.acs;
    
    if (!customerId || (!ssid && !key)) {
        return res.status(400).json({ message: "Customer ID and either an SSID or a key are required." });
    }

    try {
        await updateCustomerWlan(customerId, { ssid, key });
        res.json({ success: true, message: `Task to update WLAN settings has been queued.` });
    } catch (error) {
        handleAcsFetchError(error, res, `updating WLAN for customer ${customerId}`, acsSettings.apiUrl);
    }
});

router.post("/customer-device/reboot", async (req, res) => {
    const { customerId } = req.body;
    if (!customerId) {
        return res.status(400).json({ message: "Customer ID is required." });
    }
    const settings = await getSettings();
    const acsSettings = settings.acs;

    try {
        const [[customer]] = await pool.query("SELECT acsSerialNumber FROM customers WHERE id = ?", [customerId]);
        if (!customer || !customer.acsSerialNumber) {
            return res.status(404).json({ message: "No linked ACS device found for this customer." });
        }
        const serialNumber = customer.acsSerialNumber;

        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ message: "ACS API URL is not configured." });
        }

        const realId = await resolveRealDevice(serialNumber, acsSettings);
        const targetId = realId || serialNumber;

        const headers = { 'Content-Type': 'application/json' };
        if (acsSettings.username && acsSettings.password) {
            headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
        }

        const taskPayload = { name: "reboot" };
        const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
        const taskUrl = `${apiUrl}/devices/${encodeURIComponent(targetId)}/tasks?connection_request`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ACS_API_TIMEOUT);

        try {
            const response = await fetch(taskUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(taskPayload),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`ACS API responded with status ${response.status}: ${errorText}`);
            }

            res.json({ success: true, message: `Reboot task has been queued for your device. It will restart shortly.` });
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (error) {
        handleAcsFetchError(error, res, `rebooting device for customer ${customerId}`, acsSettings.apiUrl);
    }
});

router.post("/devices/bulk-delete", async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "An array of device IDs (serial numbers) is required." });
    }
    const settings = await getSettings();
    const acsSettings = settings.acs;

    try {
        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ message: "ACS API URL is not configured." });
        }

        const headers = {};
        if (acsSettings.username && acsSettings.password) {
            headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
        }
        const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");

        const deletePromises = ids.map(id => {
            const deleteUrl = `${apiUrl}/devices/${encodeURIComponent(id)}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), ACS_API_TIMEOUT);
            return fetch(deleteUrl, { method: 'DELETE', headers, signal: controller.signal })
                .finally(() => clearTimeout(timeoutId));
        });
        
        const results = await Promise.allSettled(deletePromises);

        let successCount = 0;
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.ok) {
                successCount++;
            }
        });

        await pool.query('UPDATE customers SET acsSerialNumber = NULL WHERE acsSerialNumber IN (?)', [ids]);
        
        res.json({
            success: true,
            message: `Successfully deleted ${successCount} of ${ids.length} devices from the ACS server.`
        });

    } catch (error) {
        handleAcsFetchError(error, res, 'bulk deleting devices', acsSettings.apiUrl);
    }
});

// Tambahkan di acsRoutes.js
router.post("/customer-device/debug-refresh", async (req, res) => {
    const { customerId } = req.body;
    
    console.log('🐛 [DEBUG REFRESH] Starting for customer:', customerId);
    
    try {
        const settings = await getSettings();
        const acsSettings = settings.acs;

        if (!acsSettings?.apiUrl) {
            return res.json({ success: false, error: "ACS API URL not configured" });
        }

        // 1. Cari customer
        const [[customer]] = await pool.query(
            "SELECT acsSerialNumber FROM customers WHERE id = ?", 
            [customerId]
        );
        
        if (!customer?.acsSerialNumber) {
            return res.json({ success: false, error: "No device linked" });
        }

        const serialNumber = customer.acsSerialNumber;
        console.log('🐛 [DEBUG] Serial number:', serialNumber);
        
        // 2. Resolve device ID
        const realId = await resolveRealDevice(serialNumber, acsSettings);
        const targetId = realId || serialNumber;
        console.log('🐛 [DEBUG] Target device:', targetId);

        // 3. Prepare headers
        const headers = {};
        if (acsSettings.username && acsSettings.password) {
            headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
        }

        const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");

        // 4. Cek data SEBELUM refresh
        console.log('🐛 [DEBUG] Checking data BEFORE refresh...');
        const beforeQ = encodeURIComponent(JSON.stringify({ _id: targetId }));
        const beforeUrl = `${apiUrl}/devices?query=${beforeQ}`;
        const beforeResponse = await fetch(beforeUrl, { headers });
        const beforeDevices = await beforeResponse.json();
        const beforeDevice = beforeDevices[0];
        
        console.log('🐛 [DEBUG] Data BEFORE refresh:', {
            lastInform: beforeDevice?._lastInform,
            parametersCount: beforeDevice?.Parameters ? Object.keys(beforeDevice.Parameters).length : 0
        });

        // 5. Kirim refresh task
        console.log('🐛 [DEBUG] Sending refresh task...');
        const taskUrl = `${apiUrl}/devices/${encodeURIComponent(targetId)}/tasks?connection_request`;
        
        const { parameters } = req.body;
        const defaultParameters = [
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", 
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.*.MACAddress",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.*.IPAddress",
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.*.SignalStrength",
            "InternetGatewayDevice.DeviceInfo.SerialNumber",
            "Device.DeviceInfo.SerialNumber"
        ];
        
        const parameterNames = (Array.isArray(parameters) && parameters.length > 0)
            ? parameters
            : defaultParameters;

        const taskPayload = {
            name: "getParameterValues",
            parameterNames: parameterNames
        };

        const taskResponse = await fetch(taskUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(taskPayload),
        });

        console.log('🐛 [DEBUG] Task response status:', taskResponse.status);
        
        if (!taskResponse.ok) {
            const errorText = await taskResponse.text();
            throw new Error(`Task failed: ${errorText}`);
        }

        const taskResult = await taskResponse.json();
        console.log('🐛 [DEBUG] Task result:', taskResult);

        // 6. Tunggu dan cek data SETELAH refresh
        console.log('🐛 [DEBUG] Waiting 15 seconds for device to report...');
        await new Promise(resolve => setTimeout(resolve, 15000));

        console.log('🐛 [DEBUG] Checking data AFTER refresh...');
        const afterQ = encodeURIComponent(JSON.stringify({ _id: targetId }));
        const afterUrl = `${apiUrl}/devices?query=${afterQ}`;
        const afterResponse = await fetch(afterUrl, { headers });
        const afterDevices = await afterResponse.json();
        const afterDevice = afterDevices[0];

        console.log('🐛 [DEBUG] Data AFTER refresh:', {
            lastInform: afterDevice?._lastInform,
            parametersCount: afterDevice?.Parameters ? Object.keys(afterDevice.Parameters).length : 0,
            hasNewData: beforeDevice?._lastInform !== afterDevice?._lastInform
        });

        res.json({
            success: true,
            debug: {
                deviceId: targetId,
                taskSent: true,
                taskStatus: taskResponse.status,
                before: {
                    lastInform: beforeDevice?._lastInform,
                    parametersCount: beforeDevice?.Parameters ? Object.keys(beforeDevice.Parameters).length : 0
                },
                after: {
                    lastInform: afterDevice?._lastInform,
                    parametersCount: afterDevice?.Parameters ? Object.keys(afterDevice.Parameters).length : 0
                },
                dataUpdated: beforeDevice?._lastInform !== afterDevice?._lastInform
            }
        });

    } catch (error) {
        console.error('🐛 [DEBUG REFRESH] Error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Di file API backend (misal: /api/acs.js atau routes/acs.js)
router.get("/devices/:id(*)/details", async (req, res) => {
    const rawId = req.deviceId;
    const shouldRefreshCache = ['true', '1', 'yes'].includes(String(req.query.refreshCache || '').toLowerCase());
    const settings = await getSettings();
    const acsSettings = settings.acs;

    if (!acsSettings?.apiUrl) {
        return res.status(409).json({ message: "ACS API URL is not configured." });
    }

    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    const headers = {};

    if (acsSettings.username && acsSettings.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    try {
        const realId = await resolveRealDevice(rawId, acsSettings);
        
        if (!realId) {
            const cached = await getCachedDeviceByCandidates(buildDeviceIdCandidates(rawId));
            if (cached) {
                return res.json(buildCachedDeviceDetails(cached));
            }
            return res.status(404).json({
                message: `Device not found in ACS for ID: ${rawId}.`,
            });
        }

        const q = encodeURIComponent(JSON.stringify({ _id: realId }));
        const url = `${apiUrl}/devices?query=${q}`;

        const response = await fetch(url, { headers });

        if (!response.ok) {
             throw new Error(`ACS API responded with status ${response.status}`);
        }

        const arr = await response.json();
        if (!Array.isArray(arr) || arr.length === 0) {
            const cached = await getCachedDeviceByCandidates(buildDeviceIdCandidates(rawId));
            if (cached) {
                return res.json(buildCachedDeviceDetails(cached));
            }
            return res.status(404).json({ message: `Device ${realId} found in index but details fetch returned empty.` });
        }
        
        const device = arr[0];
        const parsed = parseDeviceDetails(device);
        if (shouldRefreshCache) {
            const cacheRow = buildAcsDeviceCacheRow(device);
            if (cacheRow) {
                await upsertAcsDeviceRow(cacheRow);
                return res.json({
                    ...parsed,
                    cacheRow: {
                        id: cacheRow.serialNumber,
                        serialNumber: cacheRow.serialNumber,
                        productClass: cacheRow.productClass || 'N/A',
                        ipAddress: cacheRow.ipAddress || 'N/A',
                        pppoeUsername: cacheRow.pppoeUsername || 'N/A',
                        rxPower: cacheRow.rxPower || 'N/A',
                        lastInform: dbDateToISO(cacheRow.lastInform),
                        isOnline: cacheRow.isOnline === 1,
                        ssid1: cacheRow.ssid1 || null,
                        ssid5: cacheRow.ssid5 || null,
                        ssid1Connected: cacheRow.ssid1Connected || 0,
                        ssid5Connected: cacheRow.ssid5Connected || 0,
                    },
                });
            }
        }

        return res.json(parsed);

    } catch (err) {
        console.error("ACS ERROR:", err);
        handleAcsFetchError(err, res, `getting details for ${rawId}`, acsSettings.apiUrl);
    }
});
export default router;
