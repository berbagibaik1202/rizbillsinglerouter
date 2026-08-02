

import express from "express";
import { randomUUID } from "crypto";
import pool from "../db.js";
import { getSettings, toMySQLDatetime, dbDateToISO } from "../utils.js";
import { parseDeviceDetails } from "../parsers/acsdeviceparser.js";
import { getCustomerDeviceDetails, updateCustomerWlan } from "../services.js";
import { sanitizeAcs } from "../utils/sanitizeAcs.js";
import levenshtein from "js-levenshtein"; 

const router = express.Router();
const ACS_API_TIMEOUT = 30000; // Timeout 30 detik untuk permintaan ACS
const ACS_SYNC_YIELD_EVERY = 5;
const ACS_SYNC_BATCH_DELAY_MS = 25;
const ACS_SYNC_DEVICE_PROJECTION = "_id,_lastInform,summary,_deviceId";

let activeSyncJob = null;

const nowIso = () => new Date().toISOString();
const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const formatSyncJob = (job) => {
    if (!job) return null;
    return {
        ...job,
    };
};

const isSyncJobActive = (job) => !!job && ['queued', 'running'].includes(job.status);

const getActiveSyncJob = () => (isSyncJobActive(activeSyncJob) ? activeSyncJob : null);

const createSyncJob = () => ({
    id: randomUUID(),
    status: 'queued',
    processed_count: 0,
    total_count: 0,
    progress_percent: 0,
    message: 'ACS sync job queued.',
    error_message: null,
    started_at: null,
    finished_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    cancel_requested: false,
});

const updateSyncJob = (job, patch = {}) => {
    if (!job) return null;
    Object.assign(job, patch);
    job.updated_at = nowIso();
    return job;
};

const setSyncJobProgress = (job, progress, message, extraPatch = {}) => {
    if (!job) return null;
    job.progress_percent = Math.max(0, Math.min(100, Number(progress || 0)));
    if (message !== undefined) {
        job.message = String(message || '').trim() || job.message;
    }
    Object.assign(job, extraPatch);
    job.updated_at = nowIso();
    return job;
};

const syncJobResponse = (job) => formatSyncJob(job);

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

const fetchAllAcsDevices = async (acsSettings, projection = null) => {
    const headers = {};
    if (acsSettings.username && acsSettings.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    const allDevices = [];
    const seenSerialNumbers = new Set();
    let skip = 0;
    const limit = 100;
    let hasMore = true;
    let pageCount = 0;
    const MAX_PAGES = 50; 

    console.log(`[ACS Helper] Starting paginated fetch for all devices with projection: ${projection || 'none'}`);

    while (hasMore && pageCount < MAX_PAGES) {
        pageCount++;
        let url = `${apiUrl}/devices/?limit=${limit}&skip=${skip}`;
        if (projection) {
            url += `&projection=${encodeURIComponent(projection)}`;
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ACS_API_TIMEOUT);

        try {
            const response = await fetch(url, { headers, signal: controller.signal });

            if (!response.ok) {
                throw new Error(`ACS API responded with status ${response.status} while fetching page.`);
            }

            const devicesOnPage = await response.json();
            if (!Array.isArray(devicesOnPage)) {
                throw new Error("Received unexpected data format from ACS server during pagination.");
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
                allDevices.push(...newDevicesOnPage);
                if (devicesOnPage.length < limit) {
                    hasMore = false;
                } else {
                    skip += limit;
                }
            }
        } finally {
            clearTimeout(timeoutId);
        }

        if (hasMore) {
            await delay(0);
        }
    }
    
    return allDevices;
};

const getDeviceSummaryLabel = (device) => {
    const summary = device?.summary && typeof device.summary === 'object' ? device.summary : {};
    const deviceId = device?._deviceId && typeof device._deviceId === 'object' ? device._deviceId : {};

    return summary.modelName
        || summary.productClass
        || summary.name
        || deviceId.ProductClass
        || deviceId._ProductClass
        || deviceId.ModelName
        || 'N/A';
};

const getCachedAcsDevices = async (includeWifi5 = true) => {
    const ssid5Result = includeWifi5
        ? ", d.ssid5, d.ssid5Connected"
        : "";

    const [cachedDevices, syncTimeRows] = await Promise.all([
        pool.query(`
            SELECT 
                d.serialNumber as id, d.serialNumber, d.productClass, d.ipAddress,
                d.pppoeUsername, d.rxPower, d.lastInform, d.isOnline, d.ssid1, d.ssid1Connected${ssid5Result},
                c.id as customerId, c.name as customerName
            FROM acs_devices d
            LEFT JOIN customers c ON d.serialNumber = c.acsSerialNumber
        `),
        pool.query("SELECT MAX(last_sync_at) as lastSyncTime FROM acs_devices"),
    ]);

    return {
        devices: cachedDevices[0].map((d) => ({
            ...d,
            isOnline: d.isOnline === 1,
            lastInform: dbDateToISO(d.lastInform),
        })),
        lastSyncTime: dbDateToISO(syncTimeRows[0][0]?.lastSyncTime || null),
    };
};

const triggerBackgroundSummon = async (acsData, acsSettings, job = null) => {
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

    const BATCH_SIZE = 5;
    let triggeredCount = 0;

    for (let i = 0; i < acsData.length; i += BATCH_SIZE) {
        if (job?.cancel_requested) {
            break;
        }

        const chunk = acsData.slice(i, i + BATCH_SIZE);
        await Promise.all(chunk.map(async (device) => {
            if (!device?._id || job?.cancel_requested) return;
            try {
                const taskUrl = `${apiUrl}/devices/${encodeURIComponent(device._id)}/tasks?connection_request`;
                await fetch(taskUrl, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskPayload)
                });
                triggeredCount++;
            } catch (e) { 
                console.warn(`[ACS Background] Failed to summon ${device._id}:`, e.message);
            }
        }));

        if (job) {
            const summonProgress = acsData.length > 0
                ? 70 + Math.round((Math.min(i + BATCH_SIZE, acsData.length) / acsData.length) * 30)
                : 100;
            setSyncJobProgress(job, Math.min(99, summonProgress), `Refreshing devices in background (${Math.min(i + BATCH_SIZE, acsData.length)}/${acsData.length})...`, {
                processed_count: Math.min(i + BATCH_SIZE, acsData.length),
            });
        }

        await delay(500);
        await delay(0);
    }
    console.log(`[ACS Background] Finished summoning. Sent commands to ${triggeredCount} devices.`);
};

const runAcsSyncJob = async (job, acsSettings) => {
    try {
        if (!acsSettings?.apiUrl) {
            throw new Error("ACS API URL is not configured.");
        }

        updateSyncJob(job, {
            status: 'running',
            started_at: nowIso(),
            message: 'Fetching devices from ACS server...',
            error_message: null,
            progress_percent: 1,
        });

        const projection = ACS_SYNC_DEVICE_PROJECTION;
        const acsData = await fetchAllAcsDevices(acsSettings, projection);

        if (job.cancel_requested) {
            updateSyncJob(job, {
                status: 'cancelled',
                finished_at: nowIso(),
                message: 'ACS sync job cancelled.',
                progress_percent: 0,
            });
            return;
        }

        const totalCount = acsData.length;
        let updatedCount = 0;
        const liveSerialNumbers = new Set();
        const cachedSnapshot = await pool.query("SELECT serialNumber, productClass, ipAddress, pppoeUsername, rxPower, lastInform, isOnline, ssid1, ssid5, ssid1Connected, ssid5Connected FROM acs_devices");
        const cachedMap = new Map(cachedSnapshot[0].map((row) => [row.serialNumber, row]));

        updateSyncJob(job, {
            total_count: totalCount,
            processed_count: 0,
            message: totalCount > 0 ? `Fetched ${totalCount} ACS devices. Updating local cache...` : 'No ACS devices found.',
            progress_percent: totalCount > 0 ? 5 : 100,
        });

        for (let index = 0; index < acsData.length; index++) {
            if (job.cancel_requested) {
                updateSyncJob(job, {
                    status: 'cancelled',
                    finished_at: nowIso(),
                    message: 'ACS sync job cancelled.',
                });
                return;
            }

            const device = acsData[index];
            try {
                if (!device?._id) {
                    continue;
                }

                liveSerialNumbers.add(device._id);
                const cached = cachedMap.get(device._id) || null;

                const lastInform = device._lastInform ? new Date(device._lastInform) : null;
                const isOnline = lastInform && (Date.now() - lastInform.getTime() < 10 * 60 * 1000);

                const deviceToCache = {
                    serialNumber: device._id,
                    productClass: getDeviceSummaryLabel(device) || cached?.productClass || 'N/A',
                    ipAddress: cached?.ipAddress || null,
                    pppoeUsername: cached?.pppoeUsername || null,
                    rxPower: cached?.rxPower || 'N/A',
                    lastInform: lastInform ? toMySQLDatetime(lastInform) : null,
                    isOnline: isOnline ? 1 : 0,
                    ssid1: cached?.ssid1 || null,
                    ssid5: cached?.ssid5 || null,
                    ssid1Connected: cached?.ssid1Connected || 0,
                    ssid5Connected: cached?.ssid5Connected || 0,
                };

                const values = [
                    deviceToCache.serialNumber,
                    deviceToCache.productClass,
                    deviceToCache.ipAddress,
                    deviceToCache.pppoeUsername,
                    deviceToCache.rxPower,
                    deviceToCache.lastInform,
                    deviceToCache.isOnline,
                    deviceToCache.ssid1,
                    deviceToCache.ssid5,
                    deviceToCache.ssid1Connected,
                    deviceToCache.ssid5Connected,
                ];

                const [result] = await pool.query(`
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
                `, values);

                if (result.affectedRows > 0) updatedCount++;
            } catch (loopErr) {
                console.error(`[ACS Sync] Failed processing device ${device?._id}:`, loopErr);
            }

            const processedCount = index + 1;
            const progressPercent = totalCount > 0
                ? Math.min(70, Math.round((processedCount / totalCount) * 70))
                : 70;
            updateSyncJob(job, {
                processed_count: processedCount,
                progress_percent: progressPercent,
                message: `Updating local cache (${processedCount}/${totalCount})...`,
            });

            if (processedCount % ACS_SYNC_YIELD_EVERY === 0) {
                await delay(ACS_SYNC_BATCH_DELAY_MS);
            }
        }

        updateSyncJob(job, {
            message: 'Cleaning up stale cache entries...',
            progress_percent: Math.max(job.progress_percent, 72),
        });

        const [cachedDevices] = await pool.query("SELECT serialNumber FROM acs_devices");
        const cachedSerialNumbers = cachedDevices.map(d => d.serialNumber);
        const numbersToDelete = cachedSerialNumbers.filter(sn => !liveSerialNumbers.has(sn));

        if (numbersToDelete.length > 0) {
            await pool.query('DELETE FROM acs_devices WHERE serialNumber IN (?)', [numbersToDelete]);
        }

        if (job.cancel_requested) {
            updateSyncJob(job, {
                status: 'cancelled',
                finished_at: nowIso(),
                message: 'ACS sync job cancelled.',
                progress_percent: 0,
            });
            return;
        }

        updateSyncJob(job, {
            status: 'completed',
            finished_at: nowIso(),
            message: `Database synced with ${updatedCount} devices.`,
            progress_percent: 100,
            processed_count: totalCount,
        });
    } catch (error) {
        console.error('[ACS Sync] Fatal error during sync job:', error);
        updateSyncJob(job, {
            status: 'failed',
            finished_at: nowIso(),
            error_message: error.message || 'ACS sync failed.',
            message: error.message || 'ACS sync failed.',
            progress_percent: job.progress_percent || 0,
        });
    } finally {
        if (activeSyncJob?.id === job.id) {
            if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
                activeSyncJob = job;
            }
        }
    }
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
            
            const lastInformRaw = device._lastInform ? new Date(device._lastInform) : null;
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
            const finalLastInform = lastInformRaw ? dbDateToISO(lastInformRaw) : (cached.lastInform ? dbDateToISO(cached.lastInform) : null);

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
                `, [d.serialNumber, d.productClass, d.ipAddress, d.pppoeUsername, d.rxPower, d.lastInform ? toMySQLDatetime(new Date(d.lastInform)) : null, d.isOnline ? 1 : 0, d.ssid1, d.ssid5, d.ssid1Connected, d.ssid5Connected]);
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

const sendCachedAcsDevices = async (res, includeWifi5 = true) => {
    try {
        const data = await getCachedAcsDevices(includeWifi5);
        return res.json(data);
    } catch (error) {
        console.error('[ACS Cached] Error fetching from database cache:', error);
        return res.status(500).json({ message: 'Failed to retrieve cached device data.' });
    }
};

// GET devices from local DB CACHE
router.get("/devices/cached", async (req, res) => {
    console.log('[ACS Cached] Fetching cached device list from database...');
    return sendCachedAcsDevices(res, true);
});

router.get("/devices/cached/fast", async (req, res) => {
    console.log('[ACS Cached Fast] Fetching lightweight cached device list from database...');
    return sendCachedAcsDevices(res, false);
});


// POST to trigger a sync job from ACS server to local DB
router.post("/sync", async (req, res) => {
    console.log('[ACS Sync] Queueing sync job...');
    const settings = await getSettings();
    const acsSettings = settings.acs;

    try {
        if (!acsSettings?.apiUrl) {
            return res.status(409).json({ message: "ACS API URL is not configured.", job: null });
        }

        const currentJob = getActiveSyncJob();
        if (currentJob) {
            return res.status(409).json({
                success: false,
                message: 'Ada job ACS yang masih aktif. Tunggu sampai selesai sebelum menjalankan sync baru.',
                job: syncJobResponse(currentJob),
            });
        }

        const job = createSyncJob();
        activeSyncJob = job;

        void runAcsSyncJob(job, acsSettings);

        return res.status(202).json({
            success: true,
            message: 'ACS sync job queued.',
            job: syncJobResponse(job),
        });
    } catch (error) {
        console.error('[ACS Sync] Failed to queue sync job:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to queue ACS sync job.',
            job: null,
        });
    }
});

router.get("/sync/jobs/active", async (req, res) => {
    const job = getActiveSyncJob();
    return res.json({
        success: true,
        job: job ? syncJobResponse(job) : null,
    });
});

router.get("/sync/jobs/:jobId", async (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    const job = activeSyncJob?.id === jobId ? activeSyncJob : null;

    if (!job) {
        return res.status(404).json({
            success: false,
            message: 'ACS sync job not found.',
            job: null,
        });
    }

    return res.json({
        success: true,
        job: syncJobResponse(job),
    });
});

router.post("/sync/jobs/:jobId/cancel", async (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    const job = activeSyncJob?.id === jobId ? activeSyncJob : null;

    if (!job) {
        return res.status(404).json({
            success: false,
            message: 'ACS sync job not found.',
            job: null,
        });
    }

    if (!isSyncJobActive(job)) {
        return res.json({
            success: true,
            message: 'ACS sync job is already finished.',
            job: syncJobResponse(job),
        });
    }

    job.cancel_requested = true;
    updateSyncJob(job, {
        message: 'ACS sync cancellation requested.',
    });

    if (job.status === 'queued') {
        updateSyncJob(job, {
            status: 'cancelled',
            finished_at: nowIso(),
            progress_percent: 0,
            message: 'ACS sync job cancelled.',
        });
    }

    return res.json({
        success: true,
        message: 'ACS sync job cancellation requested.',
        job: syncJobResponse(job),
    });
});


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
        return res.json(parsed);

    } catch (err) {
        console.error("ACS ERROR:", err);
        handleAcsFetchError(err, res, `getting details for ${rawId}`, acsSettings.apiUrl);
    }
});
export default router;
