
import pool from './db.js';
import mikrotikApi from './mikrotik-api.js';
import { getSettings, replacePlaceholders, formatBillingPeriod, toMySQLDatetime, dateToYMD, parseLocalDateString } from './utils.js';
import whatsappService from './whatsappService.js';
import { parseDeviceDetails } from './parsers/acsdeviceparser.js';
import { getDeviceProfileByModel } from './utils/deviceProfiles.js';


const ACS_API_TIMEOUT = 30000; // 30 detik

/* ============================================================
   ACS HELPER FUNCTIONS
============================================================ */
const flattenObject = (obj, prefix = "", res = {}) => {
  if (!obj || typeof obj !== "object") return res;
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      flattenObject(obj[key], newKey, res);
    } else {
      res[newKey] = obj[key];
    }
  }
  return res;
};
const unwrapAcsValue = (val, depth = 0) => {
  if (val === null || val === undefined || depth > 5) return val;
  if (Array.isArray(val)) return val.length ? unwrapAcsValue(val[0], depth + 1) : undefined;
  if (typeof val === "object") {
    if (val._value !== undefined) return unwrapAcsValue(val._value, depth + 1);
    if (val.value !== undefined) return unwrapAcsValue(val.value, depth + 1);
  }
  return val;
};
const createUnifiedParametersObject = (device) => {
  let combined = {};
  Object.assign(combined, device);
  if (device.summary && typeof device.summary === "object") Object.assign(combined, device.summary);
  if (device.parameters && typeof device.parameters === "object") Object.assign(combined, device.parameters);
  return flattenObject(combined);
};
const getValueByPaths = (flatObj, paths, validator = () => true) => {
  for (const path of paths) {
    if (path.includes("*")) {
      const regex = new RegExp('^' + path.replace(/\./g, '\\.').replace(/\*/g, '\\d+') + '(\\._value)?$');
      for (const key in flatObj) {
        if (regex.test(key)) {
          const val = unwrapAcsValue(flatObj[key]);
          if (val !== undefined && val !== null && String(val).trim() && validator(val)) return val;
        }
      }
    } else {
      const val = unwrapAcsValue(flatObj[path] ?? flatObj[`${path}._value`]);
      if (val !== undefined && val !== null && String(val).trim() && validator(val)) return val;
    }
  }
  return undefined;
};
const findFuzzyValue = (flatObj, searchTerms, excludeTerms = [], validator) => {
  for (const key in flatObj) {
    const lower = key.toLowerCase();
    if (searchTerms.some(t => lower.includes(t)) && !excludeTerms.some(t => lower.includes(t))) {
      const val = unwrapAcsValue(flatObj[key]);
      if (val !== undefined && val !== null && String(val).trim() && validator(val)) return val;
    }
  }
  return undefined;
};
const formatRxPower = (rawValue) => {
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") return "N/A";
  let str = String(rawValue).trim().replace(",", ".").replace(/[a-zA-Z\s]/g, "");
  let val = parseFloat(str);
  if (isNaN(val) || val === 0) return "N/A";

  let finalDbm;
  if (val < -1 && val > -50) finalDbm = val;
  else if (Math.abs(val) >= 100) {
    let scaled = Math.abs(val);
    while (scaled > 100) scaled /= 10;
    finalDbm = -scaled;
  } else if (val > 0 && val < 100) {
    const mW = val > 1 ? val / 1000 : val;
    if (mW <= 0) return "N/A";
    finalDbm = 10 * Math.log10(mW);
  } else return "N/A";

  if (finalDbm <= -1 && finalDbm >= -45) return `${finalDbm.toFixed(2)} dBm`;
  return "N/A";
};
const isValidUsername = (v) => typeof v === "string" && v.length > 2;
const isValidIp = (v) => typeof v === "string" && v.includes(".");
const isValidRx = (v) => !isNaN(parseFloat(String(v).replace(",", ".")));
const isValidProductClass = (v) => typeof v === "string" && v.length > 1;
const DEFAULT_ACS_PPPOE_USERNAME_PATHS = [
    "VirtualParameters.pppUsername",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
    "Device.PPP.Interface.1.Username"
];
const DEFAULT_ACS_PPPOE_PASSWORD_PATHS = [
    "VirtualParameters.pppPassword",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password",
    "Device.PPP.Interface.1.Password"
];

const parseAcsPathCandidates = (value, fallback = []) => {
    if (Array.isArray(value)) {
        const cleaned = value.map((item) => String(item || "").trim()).filter(Boolean);
        return cleaned.length > 0 ? cleaned : fallback;
    }
    if (typeof value === "string" && value.trim()) {
        const parts = value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        return parts.length > 0 ? parts : fallback;
    }
    return fallback;
};

const normalizePppoeUsername = (value) => {
    const normalized = String(value || '').trim();
    return normalized || null;
};

const normalizeCustomerId = (value) => {
    const normalized = String(value || '').trim();
    return normalized || null;
};

const syncPppoeCacheComment = async (username, comment) => {
    const normalizedUsername = normalizePppoeUsername(username);
    if (!normalizedUsername) return;
    await pool.query('UPDATE pppoe_users SET comment = ? WHERE name = ?', [comment || '', normalizedUsername]);
};

const syncPppoeCacheProfile = async (username, profile) => {
    const normalizedUsername = normalizePppoeUsername(username);
    if (!normalizedUsername || !profile) return;
    await pool.query('UPDATE pppoe_users SET profile = ? WHERE name = ?', [profile, normalizedUsername]);
};

const resolveLinkedPppoeForCustomer = async (customer, preloadedRouterUsers = null) => {
    const customerId = normalizeCustomerId(customer?.id);
    const configuredUsername = normalizePppoeUsername(customer?.pppoeUsername);
    const routerUsers = preloadedRouterUsers || await mikrotikApi.fetchPppoeUsers();

    let pppoeUser = null;
    if (configuredUsername) {
        pppoeUser = routerUsers.find((u) => normalizePppoeUsername(u.name) === configuredUsername) || null;
    }
    if (!pppoeUser && customerId) {
        pppoeUser = routerUsers.find((u) => normalizeCustomerId(u.comment) === customerId) || null;
    }

    if (!pppoeUser) {
        return { username: configuredUsername, pppoeUser: null, routerUsers };
    }

    const resolvedUsername = normalizePppoeUsername(pppoeUser.name);
    const resolvedComment = normalizeCustomerId(pppoeUser.comment);
    if (customerId && resolvedUsername && resolvedUsername !== configuredUsername) {
        await pool.query('UPDATE customers SET pppoeUsername = ? WHERE id = ?', [resolvedUsername, customerId]);
    }

    if (customerId && resolvedUsername && resolvedComment !== customerId) {
        await mikrotikApi.updatePppoeUserCommentByName(resolvedUsername, customerId);
        await syncPppoeCacheComment(resolvedUsername, customerId);
        pppoeUser = { ...pppoeUser, comment: customerId };
    }

    return { username: resolvedUsername, pppoeUser, routerUsers };
};

export const suspendCustomer = async (customerId, invoice = null) => {
    const settings = await getSettings();
    const suspensionProfile = String(settings.billing.suspensionProfileName || '').trim();
    if (!suspensionProfile) {
        return;
    }

    const [[customer]] = await pool.query('SELECT c.*, p.name as packageName FROM customers c LEFT JOIN packages p ON c.packageId = p.id WHERE c.id = ?', [customerId]);
    const customerStatus = String(customer?.status || '').trim();
    if (!customer) {
        return;
    }
    if (customerStatus === 'Suspended') {
        return;
    }
    
    let connection;
    try {
        const { username: linkedPppoeUsername, pppoeUser } = await resolveLinkedPppoeForCustomer(customer);

        if (!linkedPppoeUsername || !pppoeUser) {
            await pool.query('UPDATE customers SET status = ? WHERE id = ?', ['Suspended', customerId]);
            return;
        }

        const currentProfile = String(pppoeUser.profile || '').trim();

        if (currentProfile === suspensionProfile) {
            await pool.query('UPDATE customers SET status = ? WHERE id = ?', ['Suspended', customerId]);
            return;
        }

        if (currentProfile !== suspensionProfile) {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // 1. Save current profile and update status in DB
            await connection.query('UPDATE customers SET status = ?, previousPppoeProfile = ? WHERE id = ?', ['Suspended', currentProfile, customerId]);
            
            // 2. Change profile on router
            await mikrotikApi.updatePppoeUser(pppoeUser.id, { profile: suspensionProfile });
            await syncPppoeCacheProfile(linkedPppoeUsername, suspensionProfile);
            
            // 3. Kick user to apply changes immediately
            await mikrotikApi.reconnectPppoeUser(linkedPppoeUsername);
            
            // If all successful, commit transaction
            await connection.commit();

            // 4. Send notification (outside transaction)
            if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp.accountSuspended && customer.phone) {
                const billingPeriod = invoice ? formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd) : 'N/A';
                const message = replacePlaceholders(settings.whatsapp.accountSuspended, {
                    customerName: customer.name,
                    customerId: customer.id,
                    packageName: customer.packageName || 'N/A',
                    billingPeriod,
                });
                const waResult = await whatsappService.sendMessage(customer.phone, message);
                 await pool.query('INSERT INTO whatsapp_logs SET ?', {
                    recipient_number: customer.phone,
                    customer_id: customer.id,
                    message_body: message,
                    status: waResult.success ? 'sent' : 'failed',
                    type: 'Account Suspended',
                    error_message: waResult.error || null,
                });
            }
        }
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        // Re-throw the error so the cron job knows something went wrong.
        throw error;
    } finally {
        if (connection) connection.release();
    }
};

export const restoreCustomerProfile = async (customerId, invoice = null) => {
    // Gabungkan query untuk mendapatkan pelanggan dan profil paket default mereka dalam satu panggilan
    const [[customer]] = await pool.query(
        `SELECT c.*, p.name as packageName, p.pppoeProfile as packageProfile 
         FROM customers c 
         LEFT JOIN packages p ON c.packageId = p.id 
         WHERE c.id = ?`, 
        [customerId]
    );

    if (!customer) {
        console.log(`[Service] Skipping profile restoration for customer ${customerId}: Customer not found.`);
        return;
    }

    if (customer.status !== 'Suspended') {
        console.log(`[Service] Skipping profile restoration for customer ${customerId}: Not suspended or no PPPoE user linked.`);
        return;
    }

    try {
        const settings = await getSettings();
        const tz = settings.app.timezone || 'Asia/Jakarta';
        const currentMonthKey = dateToYMD(new Date(), tz).slice(0, 7);
        const outstandingParams = [customerId];
        let outstandingSql = `
            SELECT id, status, dueDate
            FROM invoices
            WHERE customerId = ?
              AND status = 'Overdue'
        `;

        // If restoration is triggered by a specific invoice payment, exclude that invoice
        // because its status may already be updated to Paid in the current flow.
        if (invoice?.id) {
            outstandingSql += ' AND id <> ?';
            outstandingParams.push(invoice.id);
        }

        outstandingSql += ' ORDER BY dueDate DESC LIMIT 1';

        const [outstandingInvoices] = await pool.query(outstandingSql, outstandingParams);
        const outstandingInvoice = outstandingInvoices.find((candidate) => {
            const dueDateObj = parseLocalDateString(candidate?.dueDate);
            if (!dueDateObj) return false;
            return dateToYMD(dueDateObj, tz).slice(0, 7) === currentMonthKey;
        });

        if (outstandingInvoice) {
            console.log(
                `[Service] Skipping profile restoration for customer ${customerId}: Current-month overdue invoice ${outstandingInvoice.id} is still ${outstandingInvoice.status}.`
            );
            return;
        }

        const { username: normalizedUsername, pppoeUser } = await resolveLinkedPppoeForCustomer(customer);

        if (!normalizedUsername || !pppoeUser) {
            console.warn(`[Service] Could not find PPPoE user '${normalizedUsername}' on router for customer ${customerId}. Cannot restore profile on router. Activating in DB only.`);
            await pool.query('UPDATE customers SET status = ?, previousPppoeProfile = NULL WHERE id = ?', ['Active', customerId]);
            // (Logika notifikasi bisa ditambahkan di sini jika diperlukan)
            return;
        }

        let targetProfile = String(customer.previousPppoeProfile || '').trim();

        // Logika fallback: jika profil sebelumnya tidak ada, gunakan profil default dari paket
        if (!targetProfile) {
            console.warn(`[Service] 'previousPppoeProfile' not found for customer ${customerId}. Attempting fallback to package default profile.`);
            if (customer.packageProfile) {
                targetProfile = String(customer.packageProfile || '').trim();
                console.log(`[Service] Fallback successful. Using profile '${targetProfile}' from package '${customer.packageName}'.`);
            }
        }
        
        // Jika masih tidak ada profil target, keluar untuk mencegah status yang tidak konsisten
        if (!targetProfile) {
            console.error(`[Service] CRITICAL: Cannot restore customer ${customerId}. No 'previousPppoeProfile' found and no default profile is set on their package ('${customer.packageName}'). The customer will remain suspended.`);
            return; 
        }

        // --- Lakukan pembaruan Router dan DB ---
        console.log(`[Service] Restoring customer ${customerId} (PPPoE: ${normalizedUsername}) to profile ${targetProfile}`);
        
        // 1. Ubah profil di router TERLEBIH DAHULU. Jika ini gagal, kita tidak menyentuh DB.
        await mikrotikApi.updatePppoeUser(pppoeUser.id, { profile: targetProfile });
        await syncPppoeCacheProfile(normalizedUsername, targetProfile);
        
        // 2. Putuskan koneksi pengguna untuk menerapkan perubahan segera.
        await mikrotikApi.reconnectPppoeUser(normalizedUsername);

        // 3. Perbarui DB: Atur status menjadi Aktif dan hapus profil sebelumnya yang tersimpan. Ini hanya berjalan jika pembaruan router berhasil.
        await pool.query('UPDATE customers SET status = ?, previousPppoeProfile = NULL WHERE id = ?', ['Active', customerId]);
        
        // 4. Kirim notifikasi re-aktivasi
        if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp.accountReactivated && customer.phone) {
            const billingPeriod = invoice ? formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd) : 'N/A';
             const message = replacePlaceholders(settings.whatsapp.accountReactivated, {
                customerName: customer.name,
                customerId: customer.id,
                packageName: customer.packageName || 'N/A',
                billingPeriod,
            });
            const waResult = await whatsappService.sendMessage(customer.phone, message);
             await pool.query('INSERT INTO whatsapp_logs SET ?', {
                recipient_number: customer.phone,
                customer_id: customer.id,
                message_body: message,
                status: waResult.success ? 'sent' : 'failed',
                type: 'Account Reactivated',
                error_message: waResult.error || null,
            });
        }

    } catch (error) {
        console.error(`[Service] Failed to restore customer ${customerId}:`, error);
        // Jangan ubah status DB jika ada error dengan router untuk menjaga konsistensi.
    }
};

export const rebootCustomerDevice = async (customerId) => {
    if (!customerId) {
        throw new Error("Customer ID is required.");
    }

    const [[customer]] = await pool.query("SELECT acsSerialNumber FROM customers WHERE id = ?", [customerId]);
    if (!customer || !customer.acsSerialNumber) {
        throw new Error("No linked ACS device found for this customer.");
    }
    const serialNumber = customer.acsSerialNumber;

    const settings = await getSettings();
    const acsSettings = settings.acs;
    if (!acsSettings?.apiUrl) {
        throw new Error("ACS API URL is not configured.");
    }

    const headers = { 'Content-Type': 'application/json' };
    if (acsSettings.username && acsSettings.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    const taskPayload = { name: "reboot" };
    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    const taskUrl = `${apiUrl}/devices/${encodeURIComponent(serialNumber)}/tasks?connection_request`;

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

        return { success: true, message: `Reboot task has been queued for your device. It will restart shortly.` };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Request to the device management server timed out.');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
};

export const pushCustomerPppoeToAcs = async ({ customerId, pppoeUsername, pppoePassword }) => {
    const normalizedCustomerId = String(customerId || "").trim();
    if (!normalizedCustomerId) {
        return { success: false, skipped: true, reason: "missing_customer_id" };
    }

    const [[customer]] = await pool.query("SELECT acsSerialNumber FROM customers WHERE id = ?", [normalizedCustomerId]);
    const serialNumber = String(customer?.acsSerialNumber || "").trim();
    if (!serialNumber) {
        return { success: true, skipped: true, reason: "no_device_id" };
    }

    const settings = await getSettings();
    const acsSettings = settings?.acs || {};
    const apiUrl = String(acsSettings.apiUrl || "").trim().replace(/\/$/, "");
    if (!apiUrl) {
        return { success: true, skipped: true, reason: "acs_not_configured", serialNumber };
    }

    const username = String(pppoeUsername || "").trim();
    const password = String(pppoePassword || "");
    if (!username || !password) {
        return { success: false, skipped: true, reason: "missing_pppoe_credentials", serialNumber };
    }

    const usernamePaths = parseAcsPathCandidates(acsSettings.pppoeUsernamePaths || acsSettings.pppoeUsernamePath, DEFAULT_ACS_PPPOE_USERNAME_PATHS);
    const passwordPaths = parseAcsPathCandidates(acsSettings.pppoePasswordPaths || acsSettings.pppoePasswordPath, DEFAULT_ACS_PPPOE_PASSWORD_PATHS);

    const parameterValues = [
        ...usernamePaths.map((path) => [path, username, "xsd:string"]),
        ...passwordPaths.map((path) => [path, password, "xsd:string"]),
    ];
    if (parameterValues.length === 0) {
        return { success: true, skipped: true, reason: "no_parameter_paths", serialNumber };
    }

    const headers = { "Content-Type": "application/json" };
    if (acsSettings.username && acsSettings.password) {
        headers.Authorization = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    const taskUrl = `${apiUrl}/devices/${encodeURIComponent(serialNumber)}/tasks?connection_request`;
    const taskPayload = { name: "setParameterValues", parameterValues };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ACS_API_TIMEOUT);
    try {
        const response = await fetch(taskUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(taskPayload),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            return {
                success: false,
                skipped: false,
                reason: "acs_error",
                serialNumber,
                status: response.status,
                error: errorText || `HTTP ${response.status}`,
            };
        }

        let taskId = null;
        try {
            const body = await response.json();
            taskId = body?._id || null;
        } catch (_ignored) {
            taskId = null;
        }

        return {
            success: true,
            skipped: false,
            reason: "queued",
            serialNumber,
            taskId,
            parametersCount: parameterValues.length,
        };
    } catch (error) {
        if (error?.name === "AbortError") {
            return { success: false, skipped: false, reason: "timeout", serialNumber };
        }
        return {
            success: false,
            skipped: false,
            reason: "network_error",
            serialNumber,
            error: error?.message || String(error),
        };
    } finally {
        clearTimeout(timeoutId);
    }
};


export const updateCustomerWlan = async (customerId, updates) => {
    if (!customerId || (!updates.ssid && !updates.key)) {
        throw new Error("Customer ID and at least one update (ssid or key) are required.");
    }

    if (updates.key && updates.key.length < 8) {
        throw new Error("Password Wi-Fi harus terdiri dari minimal 8 karakter.");
    }

    console.log(`[WLAN Update] Starting for customer ${customerId}`, updates);

    try {
        // **PERUBAHAN: Gunakan getCustomerDeviceDetailsWithRefresh dengan forceRefresh**
        const deviceDetails = await getCustomerDeviceDetailsWithRefresh(customerId, true); // forceRefresh = true
        
        console.log(`[WLAN Update] Device details after refresh:`, {
            hasWlanConfigs: !!deviceDetails.wlanConfigs,
            wlanConfigsCount: deviceDetails.wlanConfigs?.length,
            wlanConfigs: deviceDetails.wlanConfigs
        });

        if (!deviceDetails.wlanConfigs || deviceDetails.wlanConfigs.length === 0) {
            // Coba sekali lagi tanpa refresh, mungkin data sudah ada
            console.log(`[WLAN Update] No WLAN configs after refresh, trying without refresh...`);
            const deviceDetailsNoRefresh = await getCustomerDeviceDetailsWithRefresh(customerId, false);
            
            if (!deviceDetailsNoRefresh.wlanConfigs || deviceDetailsNoRefresh.wlanConfigs.length === 0) {
                throw new Error("No WLAN configurations found for this device even after refresh.");
            }
            
            // Use the non-refreshed data if it exists
            return await proceedWithWlanUpdate(customerId, updates, deviceDetailsNoRefresh);
        }

        return await proceedWithWlanUpdate(customerId, updates, deviceDetails);

    } catch (error) {
        console.error(`[WLAN Update] Critical error for customer ${customerId}:`, error);
        throw new Error(`Failed to update WLAN settings: ${error.message}`);
    }
};

// Helper function untuk melanjutkan proses update setelah mendapatkan device details
const proceedWithWlanUpdate = async (customerId, updates, deviceDetails) => {
    console.log(`[WLAN Update] Starting robust update for customer ${customerId} using discovered paths.`);

    const parameters = [];

    if (!deviceDetails.wlanConfigs || deviceDetails.wlanConfigs.length === 0) {
        throw new Error("WLAN configuration is missing from device details.");
    }

    // Profil model untuk prioritas path
    const profile = getDeviceProfileByModel(deviceDetails.model || '', 'ont');
    const profileSsidPaths = profile?.paths?.ssid || [];
    const profileKeyPaths = profile?.paths?.key || [];

    const detectBand = (config) => {
        const pathString = `${config.ssidPath || ''} ${config.keyPath || ''}`.toLowerCase();
        const nameString = String(unwrapAcsValue(config.ssid) || '').toLowerCase();
        if (pathString.match(/\\.1(\\.|$)/) || pathString.includes('radio.1') || nameString.includes('2.4')) return '2.4';
        if (pathString.match(/\\.5(\\.|$)/) || pathString.includes('radio.2') || pathString.includes('5g') || nameString.includes('5 ghz')) return '5';
        return config.band || null;
    };

    const preferIgd = deviceDetails.wlanConfigs.some(c => (c.ssidPath || c.keyPath || '').includes('InternetGatewayDevice'));

    const derivePaths = (config, idx) => {
        let ssidPath = config.ssidPath;
        let keyPath = config.keyPath;
        const forcedIndex = config.band === '5' ? 5 : config.band === '2.4' ? 1 : idx;

        const detectScheme = (path) => {
            if (!path) return null;
            if (path.includes('InternetGatewayDevice')) return "igd";
            if (path.includes('Device.WiFi')) return "device";
            return null;
        };

        let scheme = detectScheme(ssidPath) || detectScheme(keyPath) || (preferIgd ? "igd" : null);

        if (!ssidPath && keyPath) {
            if (keyPath.includes('InternetGatewayDevice')) {
                ssidPath = keyPath.replace(/KeyPassphrase|PreSharedKey\\.\\d+\\.PreSharedKey/g, 'SSID');
                scheme = "igd";
            } else if (keyPath.includes('Device.WiFi.AccessPoint')) {
                const match = keyPath.match(/Device\\.WiFi\\.AccessPoint\\.(\\d+)\\.Security/);
                const apIdx = match ? match[1] : forcedIndex;
                ssidPath = `Device.WiFi.SSID.${apIdx}.SSID`;
                scheme = "device";
            }
        }

        if (!keyPath && ssidPath) {
            if (ssidPath.includes('InternetGatewayDevice')) {
                keyPath = ssidPath.replace(/SSID$/, 'KeyPassphrase');
                if (keyPath === ssidPath) {
                    keyPath = ssidPath.replace(/SSID$/, 'PreSharedKey.1.PreSharedKey');
                }
                scheme = "igd";
            } else if (ssidPath.includes('Device.WiFi.SSID')) {
                const match = ssidPath.match(/Device\\.WiFi\\.SSID\\.(\\d+)/);
                const apIdx = match ? match[1] : forcedIndex;
                keyPath = `Device.WiFi.AccessPoint.${apIdx}.Security.KeyPassphrase`;
                scheme = "device";
            }
        }

        if (!scheme) scheme = "device";

        if (!ssidPath) {
            if (scheme === "igd") {
                ssidPath = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${forcedIndex}.SSID`;
            } else {
                ssidPath = `Device.WiFi.SSID.${forcedIndex}.SSID`;
            }
        }
        if (!keyPath) {
            if (scheme === "igd") {
                keyPath = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${forcedIndex}.PreSharedKey.1.PreSharedKey`;
            } else {
                keyPath = `Device.WiFi.AccessPoint.${forcedIndex}.Security.KeyPassphrase`;
            }
        }

        return { ssidPath, keyPath };
    };

    const normalized = deviceDetails.wlanConfigs
        .map((config) => {
            let ssidPath = (typeof config.ssidPath === 'string' && config.ssidPath.length > 0) ? config.ssidPath : '';
            let keyPath = (typeof config.keyPath === 'string' && config.keyPath.length > 0) ? config.keyPath : '';

            // Derive only from existing path, jangan buat path baru
            if (!ssidPath && keyPath) {
                if (keyPath.includes('KeyPassphrase')) {
                    ssidPath = keyPath.replace('KeyPassphrase', 'SSID');
                } else if (keyPath.includes('PreSharedKey')) {
                    ssidPath = keyPath.replace(/PreSharedKey(\.\\d+)?\.PreSharedKey/, 'SSID');
                }
            }
            if (!keyPath && ssidPath && ssidPath.includes('SSID')) {
                keyPath = ssidPath.replace(/SSID$/, 'KeyPassphrase');
                if (keyPath === ssidPath) {
                    keyPath = ssidPath.replace(/SSID$/, 'PreSharedKey.1.PreSharedKey');
                }
            }

            if (!ssidPath && !keyPath) return null;

            const band = detectBand({ ...config, ssidPath, keyPath });
            const matchProfileSsid = profileSsidPaths.some(p => ssidPath && ssidPath.includes(p.replace('*', '')));
            const matchProfileKey = profileKeyPaths.some(p => keyPath && keyPath.includes(p.replace('*', '')));
            return { ...config, ssidPath, keyPath, band, matchProfile: matchProfileSsid || matchProfileKey };
        })
        .filter(Boolean);

    // Pilih target 2.4G (SSID index 1) dan 5G (index 5) jika tersedia, tanpa membuat path sintetis
    const pickByIndex = (list, idxStr) =>
        list.find(n => (n.ssidPath || '').includes(`.${idxStr}.SSID`) || (n.keyPath || '').includes(`.${idxStr}.`));

    // Prioritaskan yang match profil jika ada
    const prioritized = normalized.sort((a, b) => Number(b.matchProfile) - Number(a.matchProfile));

    const target24 = pickByIndex(prioritized, '1') || prioritized.find(n => n.band === '2.4') || prioritized[0];
    const target5 = pickByIndex(prioritized, '5') || prioritized.find(n => n.band === '5');

    [target24, target5].forEach(config => {
        if (!config) return;
        if (updates.ssid && config.ssidPath) {
            parameters.push({ path: config.ssidPath, value: updates.ssid });
        }
        if (updates.key && config.keyPath) {
            parameters.push({ path: config.keyPath, value: updates.key });
        }
    });
    
    // Hapus duplikat berdasarkan path
    const uniqueParameters = Array.from(new Map(parameters.map(p => [p.path, p])).values());

    if (uniqueParameters.length === 0) {
        console.error("[WLAN Update] No valid parameters could be determined for the update for customer " + customerId, { updates });
        throw new Error("No settings to update for the given device configuration. Please provide a new SSID or password.");
    }

    const [[customer]] = await pool.query("SELECT acsSerialNumber FROM customers WHERE id = ?", [customerId]);
    if (!customer || !customer.acsSerialNumber) {
        throw new Error("No linked ACS device found for this customer.");
    }
    const serialNumber = customer.acsSerialNumber;

    const settings = await getSettings();
    const acsSettings = settings.acs;
    if (!acsSettings?.apiUrl) {
        throw new Error("ACS API URL is not configured.");
    }

    const headers = { 'Content-Type': 'application/json' };
    if (acsSettings.username && acsSettings.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    const taskUrl = `${apiUrl}/devices/${encodeURIComponent(serialNumber)}/tasks?connection_request`;
    
    const taskPayload = {
        name: "setParameterValues",
        parameterValues: uniqueParameters.map(p => [p.path, p.value, "xsd:string"])
    };

    console.log(`[WLAN Update] Preparing to send task to ACS for device ${serialNumber}`);
    console.log(`[WLAN Update] Task URL: ${taskUrl}`);
    console.log(`[WLAN Update] Task Payload:`, JSON.stringify(taskPayload, null, 2));


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
            console.error(`[WLAN Update] ACS API responded with an error. Status: ${response.status}`, errorText);
            throw new Error(`The device management server responded with an error (${response.status}).`);
        }

        const responseData = await response.json();
        console.log(`[WLAN Update] ACS task queued successfully.`);

        // Optimistic update to the local DB cache
        if (updates.ssid) {
            try {
                await pool.query(
                    'UPDATE acs_devices SET ssid1 = ?, last_sync_at = NOW() WHERE serialNumber = ?', 
                    [updates.ssid, serialNumber]
                );
            } catch (dbError) {
                console.warn(`[WLAN Update] Failed to update local cache after successful task.`, dbError);
            }
        }

        return { 
            success: true, 
            message: `WLAN settings update has been queued successfully.`,
            parametersUpdated: uniqueParameters.length,
            taskId: responseData._id
        };
        
    } catch (error) {
        console.error(`[WLAN Update] Fetch to ACS failed.`, error);
        if (error.name === 'AbortError') {
            throw new Error('Request to the device management server timed out.');
        }
        if (error.cause && error.cause.code === 'ECONNRESET') {
            throw new Error('Connection to the device management server was reset. The server may be down or a firewall may be blocking the connection.');
        }
        throw new Error(`A network error occurred while communicating with the device management server: ${error.message}`);
    } finally {
        clearTimeout(timeoutId);
    }
};
// Di services.js - tambahkan function ini
// COPY FUNCTION INI LANGSUNG DI services.js

const resolveRealDevice = async (rawId, acsSettings) => {
    if (!acsSettings?.apiUrl) return rawId;

    console.log(`[resolveRealDevice] Looking up device: ${rawId}`);
    
    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    const headers = {};
    if (acsSettings.username && acsSettings.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    const normalized = rawId.trim().replace(/\s+/g, " ");
    const candidates = [
        rawId, 
        normalized, 
        normalized.replace(/\s+/g, "-"), 
        normalized.replace(/\s+/g, "_"), 
        normalized.replace(/\s+/g, ""), 
        decodeURIComponent(rawId)
    ];
    const uniqueCandidates = [...new Set(candidates)];

    console.log(`[resolveRealDevice] Trying candidates:`, uniqueCandidates);

    for (const candidate of uniqueCandidates) {
        try {
            const q = encodeURIComponent(JSON.stringify({ _id: candidate }));
            const url = `${apiUrl}/devices?query=${q}`;
            console.log(`[resolveRealDevice] Trying: ${candidate} -> ${url}`);
            
            const response = await fetch(url, { headers });
            if (response.ok) {
                const arr = await response.json();
                if (Array.isArray(arr) && arr.length > 0) {
                    console.log(`✅ [resolveRealDevice] Found match: ${candidate} -> ${arr[0]._id}`);
                    return arr[0]._id;
                }
            }
        } catch (e) {
            console.log(`[resolveRealDevice] Error with candidate ${candidate}:`, e.message);
        }
    }

    console.log(`❌ [resolveRealDevice] No match found, using original: ${rawId}`);
    return rawId;
};
// COPY FUNCTION INI DI services.js SEBELUM getCustomerDeviceDetails


const convertToLegacyFormat = (parsedDetails) => {
    console.log('[convertToLegacyFormat] Converting parsed details to legacy format...');
    
    if (!parsedDetails) {
        console.log('[convertToLegacyFormat] No parsed details provided');
        return {
            isOnline: false,
            model: 'Unknown',
            rxPower: null,
            wlanConfigs: []
        };
    }

    // Helper: deteksi band 2.4/5 dari path atau nama SSID
    const detectBand = (wlan) => {
        const pathString = `${wlan.ssidPath || ''} ${wlan.keyPath || ''}`.toLowerCase();
        const nameString = String(unwrapAcsValue(wlan.ssid) || '').toLowerCase();
        if (pathString.match(/\.1(\.|$)/) || pathString.includes('radio.1') || nameString.includes('2.4')) return '2.4';
        if (pathString.match(/\.5(\.|$)/) || pathString.includes('radio.2') || pathString.includes('5g') || nameString.includes('5g') || nameString.includes('5 ghz')) return '5';
        return null;
    };

    // Gunakan hanya path yang benar-benar berasal dari ACS (hindari sintetis)
    const derivePathsSafely = (wlan) => {
        let ssidPath = (typeof wlan.ssidPath === 'string' && wlan.ssidPath.length > 0) ? wlan.ssidPath : '';
        let keyPath = (typeof wlan.keyPath === 'string' && wlan.keyPath.length > 0) ? wlan.keyPath : '';

        if (!ssidPath && keyPath) {
            if (keyPath.includes('KeyPassphrase')) {
                ssidPath = keyPath.replace('KeyPassphrase', 'SSID');
            } else if (keyPath.includes('PreSharedKey')) {
                ssidPath = keyPath.replace(/PreSharedKey(\.\\d+)?\.PreSharedKey/, 'SSID');
            }
        }
        if (!keyPath && ssidPath) {
            if (ssidPath.includes('SSID')) {
                keyPath = ssidPath.replace(/SSID$/, 'KeyPassphrase');
                if (keyPath === ssidPath) {
                    keyPath = ssidPath.replace(/SSID$/, 'PreSharedKey.1.PreSharedKey');
                }
            }
        }

        return { ssidPath, keyPath };
    };

    // Determine if device is online (simple heuristic)
    const isOnline = parsedDetails.general?.uptime && 
                    parsedDetails.general.uptime !== 'N/A' && 
                    parsedDetails.general.uptime !== undefined;

    // Convert WLAN structure dengan label band, tanpa membuang index non-standar
    const wlanConfigs = (parsedDetails.wlan || [])
        .map((wlan) => {
            const band = wlan.band || detectBand(wlan);
            const { ssidPath, keyPath } = derivePathsSafely(wlan);
            // Lewati entri tanpa path valid agar tidak mengirim parameter invalid
            if (!ssidPath && !keyPath) return null;
            return {
                ssidPath,
                keyPath,
                ssid: typeof wlan.ssid === 'string' ? wlan.ssid : 'Unknown SSID',
                key: typeof wlan.key === 'string' ? wlan.key : '',
                associatedDevices: wlan.associatedDevices || [],
                band, // '2.4' | '5' | null
            };
        })
        .filter(Boolean);

    // Get RX power from WAN connections
    let rxPower = null;
    if (parsedDetails.wan && parsedDetails.wan.length > 0) {
        const firstWan = parsedDetails.wan[0];
        if (firstWan.rxPower && typeof firstWan.rxPower === 'string') {
            const match = firstWan.rxPower.match(/(-?\d+\.?\d*)/);
            rxPower = match ? parseFloat(match[1]) : null;
        }
    }

    const result = {
        isOnline: isOnline,
        model: parsedDetails.general?.model || 'Unknown Model',
        rxPower: rxPower,
        wlanConfigs: wlanConfigs
    };

    console.log('[convertToLegacyFormat] Conversion result:', {
        isOnline: result.isOnline,
        model: result.model,
        rxPower: result.rxPower,
        wlanConfigsCount: result.wlanConfigs.length,
        wlanConfigs: result.wlanConfigs.map(w => ({
            ssid: w.ssid,
            keyLength: w.key ? w.key.length : 0,
            devicesCount: w.associatedDevices.length,
            band: w.band
        }))
    });

    return result;
};

export const getCustomerDeviceDetails = async (customerId) => {
  if (!customerId) {
    throw new Error("Customer ID is required.");
  }

  console.log('🔍 [getCustomerDeviceDetails] Starting for customer:', customerId);
  
  try {
    const settings = await getSettings();
    const acsSettings = settings.acs;

    if (!acsSettings?.apiUrl) {
      throw new Error("ACS API URL is not configured");
    }

    // Cari customer
    const [[customer]] = await pool.query(
      "SELECT acsSerialNumber FROM customers WHERE id = ?", 
      [customerId]
    );
    
    if (!customer || !customer.acsSerialNumber) {
      throw new Error("No linked ACS device found for customer " + customerId);
    }

    const serialNumber = customer.acsSerialNumber;
    console.log('📱 Customer serial number:', serialNumber);
    
    const targetId = serialNumber;

    // Prepare headers
    const headers = {};
    if (acsSettings.username && acsSettings.password) {
      headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    // Query device dari ACS
    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    const q = encodeURIComponent(JSON.stringify({ _id: targetId }));
    const url = `${apiUrl}/devices?query=${q}`;
    
    console.log('🌐 Fetching from ACS URL:', url);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ACS_API_TIMEOUT);

    let response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') {
        throw new Error(`ACS request timed out after ${ACS_API_TIMEOUT / 1000}s`);
      }
      if (fetchError?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') {
        throw new Error('ACS connection timeout. Please check ACS host/port and firewall.');
      }
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`ACS API responded with status ${response.status}`);
    }

    const devices = await response.json();
    console.log('📦 ACS response - devices count:', devices.length);
    
    if (!Array.isArray(devices) || devices.length === 0) {
      throw new Error("Device not found in ACS");
    }

    const device = devices[0];
    console.log('📄 Device data received, parsing...');
    
    // Parse device details
    const parsedDetails = parseDeviceDetails(device);
    console.log('🔄 Converting to legacy format...');
    
    // Konversi ke format yang diharapkan frontend
    const legacyFormat = convertToLegacyFormat(parsedDetails);
    
    console.log('✅ FINAL RESULT:', {
      isOnline: legacyFormat.isOnline,
      model: legacyFormat.model,
      wlanConfigsCount: legacyFormat.wlanConfigs?.length || 0,
      hasWlanData: legacyFormat.wlanConfigs && legacyFormat.wlanConfigs.length > 0
    });
    
    return legacyFormat;
    
  } catch (error) {
    console.error('❌ ERROR in getCustomerDeviceDetails:', error);
    throw error;
  }
};


export const refreshCustomerDevice = async (customerId, parameters = []) => {
    if (!customerId) {
        throw new Error("Customer ID is required.");
    }

    const [[customer]] = await pool.query("SELECT acsSerialNumber FROM customers WHERE id = ?", [customerId]);
    if (!customer || !customer.acsSerialNumber) {
        throw new Error("No linked ACS device found for this customer.");
    }
    const serialNumber = customer.acsSerialNumber;

    console.log(`[Refresh Device] Triggering summon for device ${serialNumber}`, { parameters });

    const settings = await getSettings();
    const acsSettings = settings.acs;
    if (!acsSettings?.apiUrl) {
        throw new Error("ACS API URL is not configured.");
    }

    const headers = { 'Content-Type': 'application/json' };
    if (acsSettings.username && acsSettings.password) {
        headers["Authorization"] = "Basic " + Buffer.from(`${acsSettings.username}:${acsSettings.password}`).toString("base64");
    }

    const apiUrl = acsSettings.apiUrl.replace(/\/$/, "");
    
    // Build task payload untuk summon dengan parameter spesifik
    const taskPayload = {
        name: "getParameterValues",
        parameterNames: parameters.length > 0 ? parameters : [
            // Default parameters untuk WLAN data
            "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*",
            "InternetGatewayDevice.LANInterfaces.WLANConfiguration.*",
            "Device.WiFi.*",
            "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.SSID",
            "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.PreSharedKey.*.PreSharedKey",
            "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.KeyPassphrase",
            "Device.WiFi.SSID.*.SSID",
            "Device.WiFi.AccessPoint.*.Security.KeyPassphrase"
        ]
    };

    const taskUrl = `${apiUrl}/devices/${encodeURIComponent(serialNumber)}/tasks?connection_request`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 detik untuk summon

    try {
        console.log(`[Refresh Device] Sending summon request to ACS`);
        
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

        const result = await response.json();
        console.log(`[Refresh Device] Summon triggered successfully for ${serialNumber}`);

        // Tunggu sebentar untuk memastikan data sudah ter-update
        await new Promise(resolve => setTimeout(resolve, 5000));

        return {
            success: true,
            message: "Device refresh triggered successfully",
            taskId: result._id,
            serialNumber: serialNumber
        };

    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Device refresh request timed out after 45 seconds.');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
};

// Di backend - pastikan forceRefresh BENAR-BENAR bekerja
export const getCustomerDeviceDetailsWithRefresh = async (customerId, forceRefresh = false) => {
    console.log(`[Device Details] FORCE REFRESH: ${forceRefresh} untuk customer ${customerId}`);

    try {
        if (forceRefresh) {
            console.log(`🚨 [Device Details] MEMAKSA REFRESH DATA...`);
            
            try {
                // Kirim task ke device untuk melaporkan data terbaru
                await refreshCustomerDevice(customerId, [
                    "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.SSID",
                    "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.KeyPassphrase",
                    "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.PreSharedKey.*.PreSharedKey",
                    "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.AssociatedDevice.*.MACAddress",
                    "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.AssociatedDevice.*.IPAddress", 
                    "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.AssociatedDevice.*.SignalStrength",
                    "Device.WiFi.SSID.*.SSID",
                    "Device.WiFi.AccessPoint.*.Security.KeyPassphrase",
                    "Device.WiFi.AccessPoint.*.AssociatedDevice.*.MACAddress"
                ]);
                
                console.log(`[Device Details] Menunggu 12 detik untuk data ter-update...`);
                await new Promise(resolve => setTimeout(resolve, 12000));
                
            } catch (refreshError) {
                console.warn(`[Device Details] Refresh gagal:`, refreshError.message);
                // Jangan throw error, lanjut dengan data cached
            }
        }

        // Ambil data device details - PASTIKAN ini mengambil data TERBARU
        const details = await getCustomerDeviceDetails(customerId);
        
        console.log(`[Device Details] Hasil akhir - forceRefresh: ${forceRefresh}`, {
            wlanConfigsCount: details.wlanConfigs?.length,
            model: details.model,
            isOnline: details.isOnline,
            timestamp: new Date().toISOString()
        });
        
        return details;
        
    } catch (error) {
        console.error(`[Device Details] Error:`, error);
        throw error;
    }
};



