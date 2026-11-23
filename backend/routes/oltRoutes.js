import express from 'express';
import { getSettings } from '../utils.js';
import { getDeviceProfileByModel, listDeviceProfiles } from '../utils/deviceProfiles.js';
import { listOltSnmpProfiles } from '../utils/oltSnmpProfiles.js';
import { isSnmpEnabledForDevice, readSnmpOnuList, readSnmpOnuPower, readSnmpSystemInfo } from '../utils/oltSnmp.js';
import Telnet from 'telnet-client';
import pool from '../db.js';

const router = express.Router();
let SSHClientCtor = null;
let ssh2LoadError = null;

const getSSHClientCtor = async () => {
    if (SSHClientCtor) return SSHClientCtor;
    if (ssh2LoadError) {
        throw ssh2LoadError;
    }
    try {
        const mod = await import('ssh2');
        SSHClientCtor = mod?.Client || mod?.default?.Client || mod?.default;
        if (typeof SSHClientCtor !== 'function') {
            throw new Error('ssh2 Client constructor tidak ditemukan.');
        }
        return SSHClientCtor;
    } catch (error) {
        const wrapped = new Error(`Gagal memuat ssh2 di runtime server: ${error?.message || error}`);
        wrapped.cause = error;
        ssh2LoadError = wrapped;
        throw wrapped;
    }
};

// Log setiap request ke rute OLT untuk memudahkan debugging
router.use((req, _res, next) => {
    console.log(`[OLT] Incoming ${req.method} ${req.originalUrl}`);
    next();
});

// In-memory cache sederhana untuk hasil ONT
const ontCache = new Map(); // key: `${id}-${frame}-${slot}-${port}-type`
const setCache = (key, data) => ontCache.set(key, { data, ts: Date.now() });
const getCache = (key, ttlMs = 60000) => {
    const item = ontCache.get(key);
    if (!item) return null;
    if (Date.now() - item.ts > ttlMs) return null;
    return item.data;
};

// In-memory meta (nama pelanggan/deskripsi) per ONT
const ontMeta = new Map(); // key: `${id}-${frame}-${slot}-${port}-${onuId}` (normalized lowercase)
const metaKey = (deviceId, frame, slot, port, onuId) =>
    `${normalizeId(deviceId)}-${frame}-${slot}-${port}-${onuId}`;
const setOntMeta = (deviceId, frame, slot, port, onuId, meta) => {
    const key = metaKey(deviceId, frame, slot, port, onuId);
    ontMeta.set(key, { ...meta, ts: Date.now() });
};
const getOntMeta = (deviceId, frame, slot, port, onuId) => {
    const key = metaKey(deviceId, frame, slot, port, onuId);
    return ontMeta.get(key) || null;
};

// --- DB cache (persistent) ---
let ontTableReady = false;
const ensureOntTable = async () => {
    if (ontTableReady) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS olt_ont_cache (
            device_id VARCHAR(255) NOT NULL,
            frame INT NOT NULL,
            slot INT NOT NULL,
            port INT NOT NULL,
            onu_id INT NOT NULL,
            serial VARCHAR(255) DEFAULT '-',
            customer_name VARCHAR(255) DEFAULT '',
            description VARCHAR(255) DEFAULT '',
            status VARCHAR(64) DEFAULT 'unknown',
            power_rx FLOAT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (device_id, frame, slot, port, onu_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    ontTableReady = true;
};

const saveOntCache = async (deviceId, rows = []) => {
    await ensureOntTable();
    if (!rows.length) return;
    const values = rows.map((o) => [
        deviceId,
        o.frame || 0,
        o.slot || 0,
        o.port || 0,
        o.onuId || 0,
        o.serial || '-',
        o.customerName || '',
        o.description || '',
        o.status || 'unknown',
        o.powerRx !== undefined && o.powerRx !== null ? o.powerRx : null,
    ]);
    const sql = `
        REPLACE INTO olt_ont_cache
        (device_id, frame, slot, port, onu_id, serial, customer_name, description, status, power_rx)
        VALUES ?
    `;
    await pool.query(sql, [values]);
};

const loadOntCache = async (deviceId, frame, slot, port) => {
    await ensureOntTable();
    const [rows] = await pool.query(
        `SELECT frame, slot, port, onu_id AS onuId, serial, customer_name AS customerName, description, status, power_rx AS powerRx
         FROM olt_ont_cache
         WHERE device_id = ? AND frame = ? AND slot = ? AND port = ?
         ORDER BY onu_id ASC`,
        [deviceId, frame, slot, port]
    );
    return rows || [];
};

const loadOntCacheAllPorts = async (deviceId) => {
    await ensureOntTable();
    const [rows] = await pool.query(
        `SELECT frame, slot, port, onu_id AS onuId, serial, customer_name AS customerName, description, status, power_rx AS powerRx
         FROM olt_ont_cache
         WHERE device_id = ?
         ORDER BY frame ASC, slot ASC, port ASC, onu_id ASC`,
        [deviceId]
    );
    return rows || [];
};

const normalizeId = (val) => String(val || '').trim().toLowerCase();

const findDevice = async (id) => {
    const settings = await getSettings();
    const devices = settings.olt?.devices || [];
    const needle = normalizeId(id);
    const found = devices.find((d) => {
        const candidates = [d.id, d.host, d.name];
        return candidates.some((c) => normalizeId(c) === needle);
    });
    if (!found) {
        console.warn('[OLT] Device not found for id', id, 'available:', devices.map((d) => d.id || d.host || d.name));
    }
    return found;
};

const fillTemplate = (cmds = [], replacements = {}) =>
    cmds.map((c) =>
        Object.entries(replacements).reduce(
            (acc, [key, val]) => acc.replace(new RegExp(`{${key}}`, 'g'), val ?? ''),
            c
        )
    );

const defaultReplacements = (device = {}, extra = {}, query = {}) => ({
    frame: query.frame ?? device.ponFrame ?? device.gponFrame ?? device.frame ?? 1,
    slot: query.slot ?? device.ponSlot ?? device.gponSlot ?? device.slot ?? 1,
    port: query.port ?? device.ponPort ?? device.gponPort ?? 1, // jangan pakai management port
    pon: query.port ?? device.ponPort ?? device.gponPort ?? 1,
    ontId: extra.ontId ?? 'all',
    userVlan: '',
    vlan: '',
    servicePortId: '',
    lineProfile: '',
    srvProfile: '',
    cttr: '',
    slotno: query.slot ?? device.slot ?? 1,
    serial: '',
    ...extra,
});

const formatUptimeSeconds = (totalSeconds = null) => {
    if (!Number.isFinite(Number(totalSeconds))) return null;
    const seconds = Math.max(0, Number(totalSeconds));
    const day = Math.floor(seconds / 86400);
    const hour = Math.floor((seconds % 86400) / 3600);
    const minute = Math.floor((seconds % 3600) / 60);
    const sec = Math.floor(seconds % 60);
    return `${day}d ${hour}h ${minute}m ${sec}s`;
};

const resolveSnmpIndexFromPath = (frame, slot, port, onuId) => {
    const f = Number(frame);
    const s = Number(slot);
    const p = Number(port);
    const o = Number(onuId);
    if ([f, s, p, o].every((v) => Number.isFinite(v) && v >= 0)) {
        return `${f}.${s}.${p}.${o}`;
    }
    return String(onuId || '').trim();
};

const toCliMonitoringDevice = (device = {}) => {
    const requestedType = String(device.connectionType || 'ssh').toLowerCase();
    const cliType = requestedType === 'telnet' ? 'telnet' : 'ssh';
    const defaultPort = cliType === 'telnet' ? 23 : 22;
    const configuredPort = Number(device.port);
    return {
        ...device,
        connectionType: cliType,
        port: Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : defaultPort,
    };
};

const isAllPortsRequest = (query = {}) => {
    const allPorts = String(query.allPorts || '').trim().toLowerCase();
    const port = String(query.port || '').trim().toLowerCase();
    return allPorts === '1' || allPorts === 'true' || port === 'all' || port === '*';
};

const buildRegisterCommands = (device, payload) => {
    const {
        frame = '0',
        slot = '0',
        port = '0',
        onuId = '1',
        serial = '',
        vlan = '',
        userVlan = '',
        gemport = '',
        servicePortId = '',
        lineProfile = '',
        srvProfile = '',
        cttr = '',
        portId = '',
        customerName = '',
        description = '',
        services = [],
        tcontProfile = '',
        tcontId = '',
    } = payload;

    const profile = getDeviceProfileByModel(device?.model || device?.vendor || '', 'olt');

    const bindings = Array.isArray(services) && services.length
        ? services
        : [{ vlan, userVlan, gemport, servicePortId }];

    const primary = bindings[0] || {};

    const replacements = {
        frame,
        slot,
        port,
        pon: port, // alias
        portId: portId || port,
        ontId: Math.max(1, Number(onuId) || 1),
        onuId: Math.max(1, Number(onuId) || 1),
        serial,
        vlan: primary.vlan ?? vlan,
        userVlan: primary.userVlan || primary.vlan || vlan,
        gemport: primary.gemport ?? gemport,
        servicePortId: primary.servicePortId ?? servicePortId,
        lineProfile: lineProfile || '1G',
        srvProfile: srvProfile || '1G',
        cttr,
        customerName,
        description,
        tcontProfile,
        tcontId,
        // Paksa vendor ke ZTE (CLI ZTE biasanya butuh keyword "ZTE")
        vendor: 'ZTE',
    };

    // Khusus ZTE C300/C320: gunakan urutan perintah yang diminta (description -> tcont -> gemport -> service-port -> service binding)
    if (profile?.id === 'zte-olt-c300-c320') {
        const tcontVal = tcontId || 4;
        const tcontProf = srvProfile || tcontProfile || lineProfile || '1G';
        const descText = description || customerName || '';
        const cmds = [];
        cmds.push('configure terminal');
        cmds.push(`interface gpon-olt_{frame}/{slot}/{port}`);
        cmds.push(`onu {ontId} type {vendor} sn {serial}`);
        cmds.push('exit');
        cmds.push(`interface gpon-onu_{frame}/{slot}/{port}:{ontId}`);
        if (descText) cmds.push(`description {description}`);
        cmds.push(`tcont ${tcontVal} profile ${tcontProf}`);
        bindings.forEach((svc, idx) => {
            const gem = svc.gemport || primary.gemport || idx + 1;
            cmds.push(`gemport ${gem} tcont ${tcontVal}`);
        });
        bindings.forEach((svc, idx) => {
            const spId = svc.servicePortId ?? (idx + 1);
            const vlanVal = svc.vlan ?? replacements.vlan;
            const uVlan = svc.userVlan || vlanVal;
            const vport = svc.vport || (svc.gemport || primary.gemport || idx + 1);
            cmds.push(`service-port ${spId} vport ${vport} user-vlan ${uVlan} vlan ${vlanVal}`);
        });
        cmds.push('exit');
        cmds.push(`pon-onu-mng gpon-onu_{frame}/{slot}/{port}:{ontId}`);
        bindings.forEach((svc, idx) => {
            const gem = svc.gemport || primary.gemport || idx + 1;
            const vlanVal = svc.vlan ?? replacements.vlan;
            cmds.push(`service ${idx + 1} gemport ${gem} vlan ${vlanVal}`);
        });
        cmds.push('exit');
        return fillTemplate(cmds, { ...replacements, description: descText, tcontId: tcontVal, tcontProfile: tcontProf });
    }

    if (profile?.commands?.registerOnt) {
        const cmds = [];
        cmds.push(...fillTemplate(profile.commands.registerOnt, replacements));
        if (profile.commands.tcontGemService) {
            bindings.forEach((svc, idx) => {
                const svcRepl = {
                    ...replacements,
                    vlan: svc.vlan ?? replacements.vlan,
                    userVlan: svc.userVlan || svc.vlan || replacements.vlan,
                   gemport: svc.gemport ?? replacements.gemport ?? 1,
                   servicePortId: svc.servicePortId ?? (Number(replacements.servicePortId || 0) + idx),
                    tcontId: svc.tcontId ?? (replacements.tcontId || 4),
                    vport: svc.vport ?? svc.gemport ?? 1,
                    serviceId: svc.servicePortId ?? (idx + 1),
                };
                cmds.push(...fillTemplate(profile.commands.tcontGemService, svcRepl));
            });
        } else if (profile.commands.bindService) {
            bindings.forEach((svc, idx) => {
                const svcRepl = {
                    ...replacements,
                    vlan: svc.vlan ?? replacements.vlan,
                    userVlan: svc.userVlan || svc.vlan || replacements.vlan,
                    gemport: svc.gemport ?? replacements.gemport,
                    servicePortId: svc.servicePortId ?? (Number(replacements.servicePortId || 0) + idx),
                };
                cmds.push(...fillTemplate(profile.commands.bindService, svcRepl));
            });
        }
        if (profile.commands.ipconfig) {
            cmds.push(...fillTemplate(profile.commands.ipconfig, replacements));
        }
        return cmds;
    }

    // fallback ZTE-style generic
    return fillTemplate(
        [
            'enable',
            'config',
            `interface gpon-olt_{frame}/{slot}`,
            `onu add {port} {ontId} sn {serial}`,
            `interface gpon-onu_olt_{frame}/{slot}/{port}:{ontId}`,
            `service-port {servicePortId} vlan {vlan} gpon-onu_olt {frame}/{slot}/{port} {ontId} gemport {gemport} multi-service user-vlan {userVlan}`,
        ],
        replacements
    );
};

// --- Connection helpers ---
const runSSHCommands = async (device, commands = []) => {
    const SSHClient = await getSSHClientCtor();
    return new Promise((resolve, reject) => {
        const conn = new SSHClient();
        let output = '';
        conn
            .on('ready', () => {
                const joined = commands.join(' && ');
                conn.exec(joined || 'echo ok', (err, stream) => {
                    if (err) return reject(err);
                    stream.on('close', () => conn.end());
                    stream.on('data', (data) => {
                        output += data.toString();
                    });
                    stream.stderr.on('data', (data) => {
                        output += data.toString();
                    });
                });
            })
            .on('error', (e) => {
                console.error('[OLT][SSH] Connection error:', e.message);
                reject(e);
            })
            .on('close', () => resolve(output || ''));

        conn.connect({
            host: device.host,
            port: device.port || 22,
            username: device.username,
            password: device.password,
            readyTimeout: 10000,
        });
    });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runTelnetCommands = async (device, commands = []) => {
    const promptRegex = /(ZXAN[^\r\n#>]*[#>)]\s*$|[#>)]\s*$)/mi;
    const moreRegex = /--More--|---- More ----|More/mi;
    const waitRegex = new RegExp(`${promptRegex.source}|${moreRegex.source}`, 'mi');
    // Manual login, jadi username/password tidak dikirim otomatis oleh telnet-client
    const params = {
        host: device.host,
        port: device.port || 23,
        timeout: 30000,
        negotiationMandatory: false,
        irs: '\r\n',
        ors: '\n',
        debug: (msg) => console.log('[OLT][Telnet][debug]', msg),
    };

    const needReconnect = (err = {}) => {
        const msg = (err.message || '').toLowerCase();
        return msg.includes('socket not writable') || msg.includes('broken pipe') || msg.includes('econnreset') || msg.includes('timeout');
    };

    const openSession = async () => {
        const connection = new Telnet();
        await connection.connect(params);
        console.log('[OLT][Telnet] Connected');
        // Login manual sesuai urutan: Username -> Password -> prompt ZXAN#
        try {
            await connection.send('\r\n', { waitfor: /[Uu]sername[: ]*$/m, timeout: 8000 });
            await connection.send((device.username || '') + '\r\n', { waitfor: /[Pp]assword[: ]*$/m, timeout: 8000 });
            await connection.send((device.password || '') + '\r\n', { waitfor: promptRegex, timeout: 8000 });
        } catch (authErr) {
            console.warn('[OLT][Telnet] Manual login failed:', authErr.message || authErr);
        }
        try {
            await connection.send('\r\n', { waitfor: promptRegex, timeout: 8000 });
        } catch (warmErr) {
            console.warn('[OLT][Telnet] Prompt warmup not received:', warmErr.message || warmErr);
        }
        // Matikan paging jika memungkinkan
        try {
            await connection.send('terminal length 0\r\n', { waitfor: waitRegex, timeout: 5000 });
        } catch (lenErr) {
            console.warn('[OLT][Telnet] terminal length 0 failed or not supported:', lenErr.message || lenErr);
        }
        return connection;
    };

    let connection = null;
    let output = '';
    try {
        connection = await openSession();
        let idx = 0;
        for (const cmd of commands) {
            let attempt = 0;
            while (attempt < 2) {
                try {
                    const lowerCmd = cmd.toLowerCase();
                    const waitOpt = lowerCmd.startsWith('show ') ? '' : waitRegex;
                    const res = await connection.send(cmd + '\r\n', { waitfor: waitOpt, timeout: 15000 });
                    output += `\n[${idx}] ${cmd}\n${res}`;
                    break;
                } catch (sendErr) {
                    console.warn('[OLT][Telnet] send() failed:', sendErr.message || sendErr);
                    if (attempt === 0 && needReconnect(sendErr)) {
                        try { connection.end(); } catch (e) {}
                        console.log('[OLT][Telnet] Reconnecting and retrying command...');
                        connection = await openSession();
                        attempt += 1;
                        continue;
                    }
                    // Fallback: coba kirim tanpa waitfor jika pattern tidak cocok
                    if (attempt === 0) {
                        try {
                            const res = await connection.send(cmd + '\r\n', { waitfor: '', timeout: 5000 });
                            output += `\n[${idx}] ${cmd} (no-wait)\n${res}`;
                            break;
                        } catch (rawErr) {
                            console.warn('[OLT][Telnet] raw send failed:', rawErr.message || rawErr);
                        }
                    }
                    throw sendErr;
                }
            }
            idx += 1;
            await sleep(500); // beri jeda antar perintah supaya OLT tidak kebanjiran
        }
        try {
            const tail = await connection.send('\r\n', { waitfor: promptRegex, timeout: 5000 });
            output += tail || '';
        } catch (tailErr) {
            console.warn('[OLT][Telnet] tail prompt not received:', tailErr.message || tailErr);
        }
    } catch (e) {
        console.error('[OLT][Telnet] Error:', e.message || e);
        throw e;
    } finally {
        try { connection?.end(); } catch (e) {}
    }
    return output;
};

const runDeviceCommands = async (device, commands = []) => {
    if (!commands || commands.length === 0) return '';
    const type = (device.connectionType || 'ssh').toLowerCase();
    const preferTelnet = type === 'telnet';
    console.log('[OLT] Executing commands via', type, 'host:', device.host, 'port:', device.port || (type === 'telnet' ? 23 : 22));
    let execPromise = preferTelnet ? runTelnetCommands(device, commands) : runSSHCommands(device, commands);
    // Tambahkan timeout supaya tidak menggantung
    const timeoutMs = 120000;
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Command timeout')), timeoutMs));
    try {
        return await Promise.race([execPromise, timeoutPromise]);
    } catch (e) {
        if (!preferTelnet) {
            console.warn('[OLT] SSH failed, trying Telnet fallback...', e.message || e);
            execPromise = runTelnetCommands(device, commands);
            return await Promise.race([execPromise, timeoutPromise]);
        }
        throw e;
    }
};

// --- Parsers best-effort ---
const parseRegisteredOnu = (raw = '') => {
    const rows = [];
    const lines = raw.split(/\r?\n/);
    const seen = new Set();
    for (const line of lines) {
        const cleaned = line.replace(/[^\x20-\x7E]/g, ' ');
        const trimmed = cleaned.trim();
        if (!trimmed) continue;
        if (/^-{3,}/.test(trimmed) || /^OnuIndex/i.test(trimmed)) continue;
        const tokens = trimmed.split(/\s+/).filter(Boolean);
        const zteOnuIndex = trimmed.match(/^\s*(\d+)\/(\d+)\/(\d+):(\d+)\s+([A-Za-z]+)/);
        if (zteOnuIndex) {
            const [, frame, slot, port, onuId, statusToken] = zteOnuIndex;
            rows.push({
                frame: Number(frame),
                slot: Number(slot),
                port: Number(port),
                onuId: Number(onuId),
                serial: '-',
                status: statusToken,
                powerRx: null,
            });
            continue;
        }
        // Format tabel: OnuIndex Admin State OMCC State Phase State Channel
        const tabRow = trimmed.match(/^\s*(\d+)\/(\d+)\/(\d+):(\d+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)(?:\s+([^\s]+))?/);
        if (tabRow) {
            const [, frame, slot, port, onuId, admin, omcc, phase, channel] = tabRow;
            rows.push({
                frame: Number(frame),
                slot: Number(slot),
                port: Number(port),
                onuId: Number(onuId),
                serial: '-',
                status: phase || admin || omcc || channel || 'unknown',
                powerRx: null,
            });
            continue;
        }
        const zteMatch = trimmed.match(/gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)\s+(\w+)/i);
        if (zteMatch) {
            const [, frame, slot, port, onuId, statusToken] = zteMatch;
            rows.push({
                frame: Number(frame), slot: Number(slot), port: Number(port),
                onuId: Number(onuId), serial: '-', status: statusToken, powerRx: null,
            });
            continue;
        }
        const stateRow = trimmed.match(/^\s*(\d+)\/(\d+)\/(\d+)\s+(\d+)\s+([A-Za-z0-9]+)\s+(\w+)/);
        if (stateRow) {
            const [, frame, slot, port, onuId, serial, statusToken] = stateRow;
            rows.push({
                frame: Number(frame), slot: Number(slot), port: Number(port),
                onuId: Number(onuId), serial, status: statusToken, powerRx: null,
            });
            continue;
        }
        // ZTE summary lines sometimes include "gpon-olt_1/3/1: ONU state" etc.
        const alt = trimmed.match(/gpon-olt_(\d+)\/(\d+)\/(\d+):\s+(\d+)\s+([A-Za-z0-9]+)\s+(\w+)/i);
        if (alt) {
            const [, frame, slot, port, onuId, serial, statusToken] = alt;
            rows.push({
                frame: Number(frame), slot: Number(slot), port: Number(port),
                onuId: Number(onuId), serial, status: statusToken, powerRx: null,
            });
            continue;
        }
        // generic numeric columns
        const nums = cleaned.replace(/[^\x20-\x7E]/g, ' ').split(/\s+/).filter(Boolean);
        if (nums.length >= 4 && nums.slice(0, 4).every((v) => !Number.isNaN(Number(v)))) {
            const key = `${nums[0]}-${nums[1]}-${nums[2]}-${nums[3]}`;
            if (!seen.has(key)) {
                seen.add(key);
                rows.push({
                    frame: Number(nums[0]),
                    slot: Number(nums[1]),
                    port: Number(nums[2]),
                    onuId: Number(nums[3]),
                    serial: nums[4] || '-',
                    status: nums[5] || 'unknown',
                    powerRx: null,
                });
            }
            continue;
        }
        // fallback: baris indeks F/S/P:ID dengan status di token terakhir
        const simple = trimmed.match(/^\s*(\d+)\/(\d+)\/(\d+):(\d+)/);
        if (simple) {
            const tokens = trimmed.split(/\s+/).filter(Boolean);
            const lastToken = tokens[tokens.length - 1] || 'unknown';
            const key = `${simple[1]}-${simple[2]}-${simple[3]}-${simple[4]}`;
            if (!seen.has(key)) {
                seen.add(key);
                rows.push({
                    frame: Number(simple[1]),
                    slot: Number(simple[2]),
                    port: Number(simple[3]),
                    onuId: Number(simple[4]),
                    serial: '-',
                    status: lastToken,
                    powerRx: null,
                });
            }
            continue;
        }
        // ultra fallback: token pertama berbentuk F/S/P:ID
        const firstTok = (trimmed.split(/\s+/)[0] || '').match(/(\d+)\/(\d+)\/(\d+):(\d+)/);
        if (firstTok) {
            const key = `${firstTok[1]}-${firstTok[2]}-${firstTok[3]}-${firstTok[4]}`;
            if (!seen.has(key)) {
                seen.add(key);
                rows.push({
                    frame: Number(firstTok[1]),
                    slot: Number(firstTok[2]),
                    port: Number(firstTok[3]),
                    onuId: Number(firstTok[4]),
                    serial: '-',
                    status: tokens && tokens.length ? tokens[tokens.length - 1] : 'unknown',
                    powerRx: null,
                });
            }
            continue;
        }
        // catch-all: jika ada pola F/S/P:ID di mana saja pada baris (bisa lebih dari satu)
        const anyMatches = [...cleaned.matchAll(/(\d+)\/(\d+)\/(\d+):(\d+)/g)];
        if (anyMatches.length) {
            for (const m of anyMatches) {
                const key = `${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
                if (seen.has(key)) continue;
                seen.add(key);
                rows.push({
                    frame: Number(m[1]),
                    slot: Number(m[2]),
                    port: Number(m[3]),
                    onuId: Number(m[4]),
                    serial: '-',
                    status: tokens && tokens.length ? tokens[tokens.length - 1] : 'unknown',
                    powerRx: null,
                });
            }
        }
    }
    return rows;
};

const parseUnregisteredOnu = (raw = '') => {
    const rows = [];
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const zteTab = trimmed.match(/^gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)\s+([A-Za-z0-9]+)\s+(\w+)/i);
        if (zteTab) {
            const [, frame, slot, port, onuId, serial] = zteTab;
            rows.push({
                frame: Number(frame), slot: Number(slot), port: Number(port),
                detectedOnuId: Number(onuId), serial, powerRx: null,
            });
            continue;
        }
        const matchSn = trimmed.match(/onu\s+(\d+)\s+type.*sn\s+([A-Za-z0-9]+)/i);
        if (matchSn) {
            rows.push({
                frame: 0, slot: 0, port: 0,
                detectedOnuId: Number(matchSn[1]),
                serial: matchSn[2],
                powerRx: null,
            });
            continue;
        }
        const zteMatch = trimmed.match(/gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)/i);
        if (zteMatch) {
            const [, frame, slot, port, onuId] = zteMatch;
            rows.push({
                frame: Number(frame), slot: Number(slot), port: Number(port),
                detectedOnuId: Number(onuId), serial: '-', powerRx: null,
            });
            continue;
        }
        // Generic kolom numerik: F/S/P ONUID SERIAL STATUS/RX...
        const cols = trimmed.split(/\s+/).filter(Boolean);
        if (cols.length >= 4 && cols.slice(0, 4).every((v) => !Number.isNaN(Number(v)))) {
            rows.push({
                frame: Number(cols[0]),
                slot: Number(cols[1]),
                port: Number(cols[2]),
                detectedOnuId: Number(cols[3]),
                serial: cols[4] || '-',
                powerRx: cols[5] ? Number(cols[5]) : null,
            });
        }
    }
    return rows;
};

const parseRxPower = (raw = '') => {
    // Ambil angka Rx pertama yang valid
    const match = raw.match(/Rx[: ]*([\-0-9\.]+)/i);
    if (match && !Number.isNaN(Number(match[1]))) {
        return Number(match[1]);
    }
    return null;
};

const parseSerialFromDetail = (raw = '') => {
    const snMatch = raw.match(/SN\s*[:=]\s*([A-Za-z0-9]+)/i) || raw.match(/Sn\s+([A-Za-z0-9]+)/i);
    return snMatch ? snMatch[1] : null;
};

const parseNameFromDetail = (raw = '') => {
    const nameMatch =
        raw.match(/Equipment ID\s*[:=]\s*([^\r\n]+)/i) ||
        raw.match(/Model\s*[:=]\s*([^\r\n]+)/i) ||
        raw.match(/name\s*[:=]\s*([^\r\n]+)/i) ||
        raw.match(/Description\s*[:=]\s*([^\r\n]+)/i);
    if (nameMatch) {
        return nameMatch[1].trim();
    }
    return null;
};

router.get('/devices', async (req, res) => {
    try {
        const settings = await getSettings();
        const devices = settings.olt?.devices || [];
        console.log('[OLT] Loaded devices from settings:', devices.map((d) => d.id || d.host || d.name));
        const decorated = devices.map((d) => {
            const id = d.id || d.host || d.name;
            const snmpActive = isSnmpEnabledForDevice(d);
            return {
                ...d,
                id,
                profileId: getDeviceProfileByModel(d?.model || d?.vendor || '', 'olt')?.id || null,
                connectionType: (d.connectionType || 'ssh').toLowerCase(),
                snmpEnabled: snmpActive,
                status: 'online',
                uptime: null,
                unregCount: null,
            };
        });
        res.json(decorated);
    } catch (error) {
        console.error('[OLT] Failed to load devices from settings:', error);
        res.status(500).json({ message: 'Failed to load OLT devices from settings.' });
    }
});

// List known profiles (for UI pilihan template)
router.get('/profiles', (req, res) => {
    res.json(listDeviceProfiles('olt'));
});

router.get('/snmp-profiles', (_req, res) => {
    res.json(listOltSnmpProfiles());
});

// Info singkat OLT (produk/uptime) best-effort
router.get('/:id/info', async (req, res) => {
    const { id } = req.params;
    try {
        const device = await findDevice(id);
        if (!device) return res.status(404).json({ message: 'OLT tidak ditemukan di settings.' });
        let monitoringCliDevice = device;
        if (isSnmpEnabledForDevice(device)) {
            try {
                const snmpInfo = await readSnmpSystemInfo(device);
                return res.json({
                    product: snmpInfo.sysDescr || device.model || device.name || null,
                    uptime: formatUptimeSeconds(snmpInfo.uptimeSeconds),
                    status: 'online',
                    raw: null,
                    source: 'snmp',
                });
            } catch (snmpError) {
                console.warn('[OLT][SNMP] Info error:', snmpError?.message || snmpError);
                monitoringCliDevice = toCliMonitoringDevice(device);
            }
        }
        const profile = getDeviceProfileByModel(monitoringCliDevice?.model || monitoringCliDevice?.vendor || '', 'olt');
        const diagCmds = profile?.commands?.diagnostics?.systemUptime || ['show system-group'];
        const commands = ['terminal length 0', ...diagCmds];
        const filled = fillTemplate(commands, defaultReplacements(monitoringCliDevice));
        // Batasi waktu info supaya tidak timeout lama, jika gagal tetap balas minimal
        const raw = await Promise.race([
            runDeviceCommands(monitoringCliDevice, filled),
            new Promise((_, reject) => setTimeout(() => reject(new Error('info-timeout')), 8000)),
        ]);
        const clean = (val) => String(val || '').replace(/[^\x20-\x7E]+/g, '').trim();
        const product =
            (raw.match(/ZXAN\s+[^\r\n]+/i) || raw.match(/(ZTE|Huawei|C-DATA)[^\r\n]+/i) || [])[0] || device.model || device.name;
        const uptimeMatch =
            raw.match(/uptime\s*[:=]\s*([^\r\n]+)/i) ||
            raw.match(/up\s*time\s*[:=]\s*([^\r\n]+)/i) ||
            raw.match(/system up time\s*[:=]\s*([^\r\n]+)/i);
        const uptime = uptimeMatch ? uptimeMatch[1].trim() : null;
        res.json({
            product: clean(product) || null,
            uptime: clean(uptime) || null,
            raw,
            status: 'online', // koneksi sukses -> anggap online
            source: 'cli',
        });
    } catch (error) {
        console.warn('[OLT] Info error (non-fatal):', error.message || error);
        // Jika hanya timeout info, anggap perangkat reachable (online) tapi tanpa detail
        if ((error.message || '').includes('info-timeout')) {
            return res.json({
                product: null,
                uptime: null,
                status: 'online',
                raw: null,
                error: error.message || String(error),
            });
        }
        return res.json({
            product: null,
            uptime: null,
            status: 'unknown', // jika gagal, biarkan unknown
            raw: null,
            error: error.message || String(error),
        });
    }
});

router.post('/:id/test', async (req, res) => {
    const { id } = req.params;
    try {
        const device = await findDevice(id);
        if (!device) return res.status(404).json({ message: 'OLT tidak ditemukan di settings.' });
        let monitoringCliDevice = device;
        if (isSnmpEnabledForDevice(device)) {
            try {
                const snmpInfo = await readSnmpSystemInfo(device);
                return res.json({
                    success: true,
                    message: `Tes SNMP ke OLT ${device.name || device.host} berhasil.`,
                    source: 'snmp',
                    product: snmpInfo.sysDescr || null,
                    uptime: formatUptimeSeconds(snmpInfo.uptimeSeconds),
                });
            } catch (snmpError) {
                console.warn('[OLT][SNMP] Test failed, fallback ke CLI device:', snmpError?.message || snmpError);
                monitoringCliDevice = toCliMonitoringDevice(device);
            }
        }
        const profile = getDeviceProfileByModel(monitoringCliDevice?.model || monitoringCliDevice?.vendor || '', 'olt');
        const commands = profile?.commands?.diagnostics?.systemUptime || ['show version'];
        const filled = fillTemplate(commands, defaultReplacements(monitoringCliDevice));
        const raw = await runDeviceCommands(monitoringCliDevice, filled);
        res.json({ success: true, message: `Tes koneksi ke OLT ${device.name || device.host} berhasil (fallback CLI/Telnet).`, profile: profile?.id || null, raw, source: 'cli' });
    } catch (error) {
        console.error('[OLT] Test SSH error:', error);
        res.status(500).json({ message: 'Gagal menguji koneksi OLT.' });
    }
});

router.get('/:id/snmp/onus', async (req, res) => {
    const { id } = req.params;
    try {
        const device = await findDevice(id);
        if (!device) return res.status(404).json({ message: 'OLT tidak ditemukan di settings.' });
        if (!isSnmpEnabledForDevice(device)) {
            return res.status(400).json({ message: 'SNMP belum diaktifkan untuk OLT ini.' });
        }
        const data = await readSnmpOnuList(device);
        return res.json(data);
    } catch (error) {
        console.error('[OLT][SNMP] Failed to fetch ONUs:', error);
        return res.status(500).json({ message: 'Gagal mengambil data ONU via SNMP.', detail: error?.message || String(error) });
    }
});

router.post('/:id/register-ont', async (req, res) => {
    const { id } = req.params;
    const payload = req.body;
    try {
        const device = await findDevice(id);
        if (!device) return res.status(404).json({ message: 'OLT tidak ditemukan di settings.' });
        if (String(device.connectionType || '').toLowerCase() === 'snmp') {
            return res.status(400).json({ message: 'Mode SNMP only tidak mendukung registrasi ONT via CLI.' });
        }

        const profile = getDeviceProfileByModel(device?.model || device?.vendor || '', 'olt');

        const commands = buildRegisterCommands(device, payload);
        console.log('[OLT] Register ONT commands:', commands);
        const raw = await runDeviceCommands(device, commands);
        console.log('[OLT] Raw register ONT output:', raw);
        // simpan meta customer/desc untuk overlay list
        const f = Number(payload.frame || 1);
        const s = Number(payload.slot || 1);
        const p = Number(payload.port || 1);
        const onuid = Number(payload.onuId || 1);
        const devKey = device.id || device.host || device.name || id;
        setOntMeta(devKey, f, s, p, onuid, {
            customerName: payload.customerName || payload.description || '',
            description: payload.description || payload.customerName || '',
            serial: payload.serial || '',
        });
        res.json({
            success: true,
            message: `Registrasi ONT ke OLT ${device.name || device.host} berhasil dijalankan.`,
            profile: profile?.id || null,
            commands,
            raw,
        });
    } catch (error) {
        console.error('[OLT] Register ONT error:', error);
        res.status(500).json({ message: 'Gagal registrasi ONT.', detail: error.message || String(error) });
    }
});

router.get('/:id/onts', async (req, res) => {
    try {
        console.log('[OLT] GET /:id/onts called with id', req.params.id);
        const { id } = req.params;
        const refresh = req.query.refresh === '1';
        const allPorts = isAllPortsRequest(req.query);
        const device = await findDevice(id);
        console.log('[OLT] Device resolved for ONTs:', device);
        if (!device) return res.status(404).json({ message: 'OLT tidak ditemukan di settings.' });
        let monitoringCliDevice = device;
        if (isSnmpEnabledForDevice(device)) {
            try {
                const snmpData = await readSnmpOnuList(device);
                const rows = (snmpData.onus || []).map((o) => ({
                    frame: Number(o.frame || 0),
                    slot: Number(o.slot || 1),
                    port: Number(o.port || 1),
                    onuId: Number(o.onuId || 0),
                    serial: o.sn || '-',
                    customerName: o.name || '',
                    description: o.name || '',
                    status: o.status || 'unknown',
                    powerRx: Number.isFinite(Number(o.rxPower)) ? Number(o.rxPower) : null,
                    snmpIndex: o.index,
                }));
                const frame = Number(req.query.frame || defaultReplacements(device).frame || 1);
                const slot = Number(req.query.slot || defaultReplacements(device).slot || 1);
                const port = Number(req.query.port || defaultReplacements(device).port || 1);
                const filtered = rows.filter((r) => r.frame === frame && r.slot === slot && r.port === port);
                // Mode filtered harus strict: jika PON terpilih tidak ada data, kembalikan kosong (bukan semua port).
                const finalRows = allPorts ? rows : filtered;
                if (!refresh) {
                    const cacheKey = allPorts ? `${id}-all-all-all-registered` : `${id}-${frame}-${slot}-${port}-registered`;
                    setCache(cacheKey, finalRows);
                }
                return res.json(finalRows);
            } catch (snmpError) {
                console.warn('[OLT][SNMP] Gagal ambil daftar ONU, fallback ke CLI device:', snmpError?.message || snmpError);
                monitoringCliDevice = toCliMonitoringDevice(device);
            }
        }
        const profile = getDeviceProfileByModel(monitoringCliDevice?.model || monitoringCliDevice?.vendor || '', 'olt');
        let baseCmds = [];
        if (allPorts) {
            const allPortCmds = profile?.commands?.diagnostics?.ontInfoAll || [];
            if (allPortCmds.length) {
                baseCmds = ['terminal length 0', ...allPortCmds];
            } else if (profile?.id === 'zte-olt-c300-c320') {
                // ZTE mendukung summary ONU lintas port tanpa parameter PON.
                baseCmds = ['terminal length 0', 'show gpon onu state'];
            } else if (!profile) {
                // Fallback generic untuk model yang belum punya profile (mis. HIOSO).
                baseCmds = ['terminal length 0', 'show gpon onu state'];
            } else {
                baseCmds = profile?.commands?.diagnostics?.showOnuState || [];
                baseCmds = ['terminal length 0', ...(baseCmds.length ? baseCmds : [`show gpon onu state gpon-olt_{frame}/{slot}/{port}`])];
            }
        } else {
            baseCmds = profile?.commands?.diagnostics?.showOnuState ||
                profile?.commands?.diagnostics?.ontInfoAll || [];
            if (profile?.id === 'zte-olt-c300-c320' && (!baseCmds || !baseCmds.length)) {
                baseCmds = ['terminal length 0', 'show gpon onu state gpon-olt_{frame}/{slot}/{port}'];
            } else {
                baseCmds = ['terminal length 0', ...(baseCmds.length ? baseCmds : [`show gpon onu state gpon-olt_{frame}/{slot}/{port}`])];
            }
        }
        // Default tetap aman: port terpilih. Jika allPorts=1, gunakan command lintas-port bila tersedia.
        const commands = baseCmds;
        const filled = fillTemplate(commands, defaultReplacements(monitoringCliDevice, { ontId: 'all' }, req.query));
        console.log('[OLT] Fetch ONT registered commands:', filled);
        const cacheKey = allPorts
            ? `${id}-all-all-all-registered`
            : `${id}-${req.query.frame || '1'}-${req.query.slot || '1'}-${req.query.port || '1'}-registered`;
        const frame = Number(req.query.frame || defaultReplacements(monitoringCliDevice).frame || 1);
        const slot = Number(req.query.slot || defaultReplacements(monitoringCliDevice).slot || 1);
        const port = Number(req.query.port || defaultReplacements(monitoringCliDevice).port || 1);
        if (!refresh) {
            // coba cache in-memory lalu DB
            const cachedMem = getCache(cacheKey, 60000);
            if (cachedMem) return res.json(cachedMem);
            const cachedDb = allPorts
                ? await loadOntCacheAllPorts(id)
                : await loadOntCache(id, frame, slot, port);
            if (cachedDb && cachedDb.length) {
                setCache(cacheKey, cachedDb);
                return res.json(cachedDb);
            }
        }
        const raw = await runDeviceCommands(monitoringCliDevice, filled);
        console.log('[OLT] Raw ONT registered output:', raw);
        let parsed = parseRegisteredOnu(raw);
        const fetchDetail = String(req.query.detail ?? '1') !== '0';
        if (parsed.length === 0) {
            console.warn('[OLT] Parsed ONT registered empty. Check CLI output/regex.');
        } else {
            // Overlay meta pelanggan jika ada
            parsed = parsed.map((o) => {
                const meta = getOntMeta(id, o.frame, o.slot, o.port, o.onuId);
                return meta
                    ? {
                        ...o,
                        customerName: meta.customerName || o.customerName,
                        serial: meta.serial || o.serial,
                        description: meta.description || o.description,
                    }
                    : o;
            });
        }
        if (parsed.length && fetchDetail) {
            // enrich serial jika masih kosong
            for (let i = 0; i < parsed.length; i++) {
                const o = parsed[i];
                if (o.serial && o.serial !== '-') continue;
                const detailCmds = profile?.commands?.diagnostics?.showOnuVersion || [
                    'show gpon remote-onu equip gpon-onu_{frame}/{slot}/{port}:{ontId}'
                ];
                const detailFilled = fillTemplate(detailCmds, defaultReplacements(monitoringCliDevice, { ontId: o.onuId, frame: o.frame, slot: o.slot, port: o.port }, req.query));
                console.log('[OLT] Fetch ONT detail commands:', detailFilled);
                const detailRaw = await runDeviceCommands(monitoringCliDevice, detailFilled);
                console.log('[OLT] Raw ONT detail output:', detailRaw);
                const sn = parseSerialFromDetail(detailRaw);
                const nm = parseNameFromDetail(detailRaw);
                parsed[i] = {
                    ...o,
                    serial: sn || o.serial,
                    customerName: nm || o.customerName,
                };
            }
        }
        setCache(cacheKey, parsed);
        await saveOntCache(id, parsed);
        res.json(parsed);
    } catch (error) {
        console.error('[OLT] Fetch ONTs error:', error);
        res.status(500).json({ message: 'Gagal mengambil daftar ONT.', detail: error.message });
    }
});

router.get('/:id/onts/:onuId/power', async (req, res) => {
    try {
        const { id, onuId } = req.params;
        const { frame, slot, port, snmpIndex } = req.query;
        const device = await findDevice(id);
        if (!device) return res.status(404).json({ message: 'OLT tidak ditemukan di settings.' });
        let monitoringCliDevice = device;
        if (isSnmpEnabledForDevice(device)) {
            try {
                const index = String(snmpIndex || '').trim() || resolveSnmpIndexFromPath(frame, slot, port, onuId);
                const rx = await readSnmpOnuPower(device, index);
                return res.json({ rxPower: rx, raw: null, source: 'snmp', snmpIndex: index });
            } catch (snmpError) {
                console.warn('[OLT][SNMP] Gagal ambil power ONU, fallback ke CLI device:', snmpError?.message || snmpError);
                monitoringCliDevice = toCliMonitoringDevice(device);
            }
        }
        const profile = getDeviceProfileByModel(monitoringCliDevice?.model || monitoringCliDevice?.vendor || '', 'olt');
        const commands = profile?.commands?.diagnostics?.showOnuPower || [
            'show pon power attenuation gpon-onu_{frame}/{slot}/{port}:{ontId}'
        ];
        const filled = fillTemplate(commands, defaultReplacements(monitoringCliDevice, { ontId: onuId }, req.query));
        console.log('[OLT] Fetch ONT power commands:', filled);
        const raw = await runDeviceCommands(monitoringCliDevice, filled);
        console.log('[OLT] Raw ONT power output:', raw);
        const rx = parseRxPower(raw);
        res.json({ rxPower: rx, raw });
    } catch (error) {
        console.error('[OLT] Fetch ONT power error:', error);
        res.status(500).json({ message: 'Gagal mengambil power ONT.', detail: error.message });
    }
});

// Detail ONT (SN, Equipment ID/nama) per ONU agar tidak perlu loop semua
router.get('/:id/onts/:onuId/detail', async (req, res) => {
    try {
        const { id, onuId } = req.params;
        const { frame, slot, port, snmpIndex } = req.query;
        const device = await findDevice(id);
        if (!device) return res.status(404).json({ message: 'OLT tidak ditemukan di settings.' });
        let monitoringCliDevice = device;
        if (isSnmpEnabledForDevice(device)) {
            try {
                const snmpData = await readSnmpOnuList(device);
                const idx = String(snmpIndex || '').trim() || resolveSnmpIndexFromPath(frame, slot, port, onuId);
                const found = (snmpData.onus || []).find((o) => String(o.index) === idx);
                if (found) {
                    return res.json({
                        serial: found.sn || null,
                        customerName: found.name || null,
                        source: 'snmp',
                        raw: null,
                    });
                }
                console.warn('[OLT][SNMP] Detail ONU tidak ditemukan, fallback ke CLI device. index:', idx);
                monitoringCliDevice = toCliMonitoringDevice(device);
            } catch (snmpError) {
                console.warn('[OLT][SNMP] Gagal ambil detail ONU, fallback ke CLI device:', snmpError?.message || snmpError);
                monitoringCliDevice = toCliMonitoringDevice(device);
            }
        }
        const profile = getDeviceProfileByModel(monitoringCliDevice?.model || monitoringCliDevice?.vendor || '', 'olt');
        const detailCmds = profile?.commands?.diagnostics?.showOnuVersion || [
            'show gpon remote-onu equip gpon-onu_{frame}/{slot}/{port}:{ontId}'
        ];
        const filled = fillTemplate(detailCmds, defaultReplacements(monitoringCliDevice, { ontId: onuId, frame, slot, port }, req.query));
        const raw = await runDeviceCommands(monitoringCliDevice, ['terminal length 0', ...filled]);
        const serial = parseSerialFromDetail(raw);
        const name = parseNameFromDetail(raw);

        // Simpan meta di memori dan DB
        const f = Number(frame || 1);
        const s = Number(slot || 1);
        const p = Number(port || 1);
        const onuidNum = Number(onuId || 0);
        const devKey = device.id || device.host || device.name || id;
        // Pertahankan status sebelumnya supaya tidak jatuh ke "unknown" setelah ambil detail
        let status = 'unknown';
        const cacheKey = `${id}-${f}-${s}-${p}-registered`;
        const cachedList = getCache(cacheKey, 60000);
        if (cachedList?.length) {
            const found = cachedList.find((o) => o.frame === f && o.slot === s && o.port === p && o.onuId === onuidNum);
            if (found?.status) status = found.status;
        }
        if (status === 'unknown') {
            try {
                const dbRows = await loadOntCache(devKey, f, s, p);
                const foundDb = dbRows.find((o) => o.onuId === onuidNum);
                if (foundDb?.status) status = foundDb.status;
            } catch (e) {
                console.warn('[OLT] detail loadOntCache failed:', e.message || e);
            }
        }
        const meta = {
            customerName: name || '',
            description: name || '',
            serial: serial || '',
        };
        setOntMeta(devKey, f, s, p, onuidNum, meta);
        if (cachedList?.length) {
            const updated = cachedList.map((o) =>
                o.frame === f && o.slot === s && o.port === p && o.onuId === onuidNum
                    ? { ...o, serial: serial || o.serial, customerName: name || o.customerName, description: name || o.description }
                    : o
            );
            setCache(cacheKey, updated);
        }
        await saveOntCache(devKey, [{
            frame: f,
            slot: s,
            port: p,
            onuId: onuidNum,
            serial: serial || '-',
            customerName: name || '',
            description: name || '',
            status,
            powerRx: null,
        }]);

        res.json({ serial: serial || null, customerName: name || null, raw });
    } catch (error) {
        console.error('[OLT] Fetch ONT detail (single) error:', error);
        res.status(500).json({ message: 'Gagal mengambil detail ONT.', detail: error.message });
    }
});

router.post('/:id/onts/:onuId/reboot', async (req, res) => {
    try {
        const { id, onuId } = req.params;
        const device = await findDevice(id);
        if (!device) return res.status(404).json({ message: 'OLT tidak ditemukan di settings.' });
        if (isSnmpEnabledForDevice(device)) {
            return res.status(400).json({ message: 'Reboot ONU via SNMP belum didukung. Gunakan mode SSH/Telnet.' });
        }
        const profile = getDeviceProfileByModel(device?.model || device?.vendor || '', 'olt');
        const commands = profile?.commands?.rebootOnu || [
            'configure terminal',
            'pon-onu',
            'pon-onu-mng gpon-onu_{frame}/{slot}/{port}:{ontId}',
            'reboot'
        ];
        const filled = fillTemplate(commands, defaultReplacements(device, { ontId: onuId }, req.query));
        console.log('[OLT] Reboot ONT commands:', filled);
        const raw = await runDeviceCommands(device, filled);
        res.json({ success: true, message: `Perintah reboot dikirim ke ONT ${onuId}.`, raw });
    } catch (error) {
        console.error('[OLT] Reboot ONT error:', error);
        res.status(500).json({ message: 'Gagal reboot ONT.', detail: error.message });
    }
});

router.get('/:id/unregistered', async (req, res) => {
    try {
        console.log('[OLT] GET /:id/unregistered called with id', req.params.id);
        const { id } = req.params;
        const refresh = req.query.refresh === '1';
        const device = await findDevice(id);
        console.log('[OLT] Device resolved for unregistered:', device);
        if (!device) return res.status(404).json({ message: 'OLT tidak ditemukan di settings.' });
        let monitoringCliDevice = device;
        if (isSnmpEnabledForDevice(device)) {
            // Unregistered ONU belum dipetakan stabil via SNMP lintas vendor, pakai koneksi CLI device sebagai fallback.
            monitoringCliDevice = toCliMonitoringDevice(device);
        }
        const profile = getDeviceProfileByModel(monitoringCliDevice?.model || monitoringCliDevice?.vendor || '', 'olt');
        const commands = profile?.commands?.diagnostics?.unregisteredOnu ||
            ['terminal length 0', 'show gpon onu uncfg'];
        const filled = fillTemplate(commands, defaultReplacements(monitoringCliDevice, { ontId: 'all' }, req.query));
        console.log('[OLT] Fetch ONT unregistered commands:', filled);
        const cacheKey = `${id}-${req.query.frame || 'all'}-${req.query.slot || 'all'}-${req.query.port || 'all'}-unreg`;
        if (!refresh) {
            const cached = getCache(cacheKey, 60000);
            if (cached) {
                return res.json(cached);
            }
        }
        const raw = await runDeviceCommands(monitoringCliDevice, filled);
        console.log('[OLT] Raw ONT unregistered output:', raw);
        const parsed = parseUnregisteredOnu(raw);
        if (!parsed.length) {
            console.warn('[OLT] Parsed ONT unregistered empty. Check CLI output/regex.');
        }
        setCache(cacheKey, parsed);
        // Simpan count ke meta device untuk kartu (best effort)
        try {
            const devices = await getSettings();
            const device = (devices.olt?.devices || []).find((d) => (d.id || d.host || d.name) === id);
            if (device) {
                device.unregCount = parsed.length;
            }
        } catch (e) {
            console.warn('[OLT] Failed to persist unreg count to settings cache:', e.message || e);
        }
        res.json(parsed);
    } catch (error) {
        console.error('[OLT] Fetch unregistered ONTs error:', error);
        res.status(500).json({ message: 'Gagal mengambil ONT belum terdaftar.', detail: error.message });
    }
});

export default router;
