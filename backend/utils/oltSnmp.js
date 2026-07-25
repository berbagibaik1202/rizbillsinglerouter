import { getOltSnmpProfileById, guessOltSnmpProfile } from './oltSnmpProfiles.js';

let netSnmpModule = undefined;

const sanitizeOid = (oid = '') => String(oid || '').trim().replace(/^\.*/, '');

const cleanSnmpString = (val) => String(val || '').replace(/[^\x20-\x7E]/g, '').trim();

const round2 = (val) => Number(Number(val).toFixed(2));

const parseSignalValue = (value, divider = 1, profile = null, signalType = 'rx') => {
    const num = Number(value);
    if (!Number.isFinite(num) || num === 0 || num === 65535 || num === -65535) return 0;
    if (profile?.signalEncoding === 'zte-0p002-minus-30') {
        if (signalType === 'rx') {
            if (num < 32768) return round2((num * 0.002) - 30);
            if (num < 65535) return round2(-30 - ((65535 - num) * 0.002));
            return 0;
        }
        if (signalType === 'tx') {
            if (num < 65535) return round2((num * 0.002) - 30);
            return 0;
        }
    }
    const div = Number(divider) || 1;
    if (Math.abs(num) > 500 && div === 1) return Number((num / 100).toFixed(2));
    return Number((num / div).toFixed(2));
};

const parseStatusValue = (value, profile = null) => {
    const v = Number(value);
    if (profile?.statusEncoding === 'zte-onu-phase') {
        if (v === 4) return 'Working';
        if (v === 2) return 'Down (LOS)';
        if (v === 5) return 'Down (DyingGasp)';
        if (v === 7) return 'Down (Offline)';
        if (v === 6) return 'Down (AuthFailed)';
        if (v === 1) return 'Logging';
        return 'Down';
    }
    const isGpon = profile?.id === 'hioso-gpon';
    if (isGpon) return v >= 2 && v <= 4 ? 'Up' : 'Down';
    return v === 1 || v === 3 || v === 4 ? 'Up' : 'Down';
};

export const isSnmpEnabledForDevice = (device = {}) => {
    const connType = String(device.connectionType || '').toLowerCase();
    return connType === 'snmp' || Boolean(device.snmpEnabled);
};

const getNetSnmp = async () => {
    if (netSnmpModule !== undefined) return netSnmpModule;
    try {
        netSnmpModule = await import('net-snmp');
    } catch (error) {
        console.error('[OLT][SNMP] net-snmp module not installed:', error?.message || error);
        netSnmpModule = null;
    }
    return netSnmpModule;
};

const splitHostAndPort = (rawHost = '') => {
    const input = String(rawHost || '').trim();
    if (!input) return { host: '', port: null };

    // Accept formats like:
    // - 1.2.3.4
    // - 1.2.3.4:161
    // - udp://1.2.3.4:161
    // - [2001:db8::1]:161
    // - udp://[2001:db8::1]:161
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `udp://${input}`;
    try {
        const parsed = new URL(withProtocol);
        const host = String(parsed.hostname || '').trim();
        const port = parsed.port ? Number(parsed.port) : null;
        return { host, port: Number.isFinite(port) && port > 0 ? port : null };
    } catch (_error) {
        // Fallback for malformed values that may still be a plain host.
        return { host: input, port: null };
    }
};

const buildDeviceSnmpConfig = (device = {}) => {
    const version = String(device.snmpVersion || '2c').toLowerCase();
    const hostInput = String(device.snmpHost || device.host || '').trim();
    const { host: parsedHost, port: parsedPort } = splitHostAndPort(hostInput);
    const configuredPort = Number(device.snmpPort || parsedPort || 161) || 161;
    const normalizedPort = configuredPort === 162 ? 161 : configuredPort;
    if (configuredPort === 162) {
        console.warn('[OLT][SNMP] snmpPort=162 terdeteksi. Monitoring SNMP menggunakan port 161 (162 biasanya trap).');
    }
    const sourceAddress = String(device.snmpSourceAddress || process.env.SNMP_SOURCE_ADDRESS || '').trim();
    return {
        host: parsedHost,
        port: normalizedPort,
        version,
        community: String(device.snmpCommunity || 'public'),
        timeout: Number(device.snmpTimeoutMs || 5000) || 5000,
        retries: Number(device.snmpRetries || 1) || 1,
        sourceAddress: sourceAddress || undefined,
        v3User: String(device.snmpV3User || ''),
        v3AuthProtocol: String(device.snmpV3AuthProtocol || 'sha').toLowerCase(),
        v3AuthKey: String(device.snmpV3AuthKey || ''),
        v3PrivProtocol: String(device.snmpV3PrivProtocol || 'aes').toLowerCase(),
        v3PrivKey: String(device.snmpV3PrivKey || ''),
    };
};

const describeSnmpTarget = (device = {}) => {
    const cfg = buildDeviceSnmpConfig(device);
    return `${cfg.host || 'unknown-host'}:${cfg.port || 161}`;
};

const createSnmpSession = async (device = {}) => {
    const snmp = await getNetSnmp();
    if (!snmp) {
        throw new Error('Fitur SNMP aktif, tetapi package "net-snmp" belum terpasang.');
    }
    const cfg = buildDeviceSnmpConfig(device);
    if (!cfg.host) throw new Error('SNMP host belum diisi.');

    const options = {
        port: cfg.port,
        retries: cfg.retries,
        timeout: cfg.timeout,
    };
    if (cfg.sourceAddress) {
        options.sourceAddress = cfg.sourceAddress;
    }

    if (cfg.version === '3') {
        if (!cfg.v3User) {
            throw new Error('SNMP v3 user belum diisi.');
        }
        const hasAuth = Boolean(String(cfg.v3AuthKey || '').trim());
        const hasPriv = Boolean(String(cfg.v3PrivKey || '').trim());
        if (hasPriv && !hasAuth) {
            throw new Error('SNMP v3 privKey terisi tetapi authKey kosong. Isi authKey atau kosongkan privKey.');
        }
        const authProtocol = cfg.v3AuthProtocol === 'md5' ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha;
        const privProtocol = cfg.v3PrivProtocol === 'des' ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes;
        const level = hasPriv
            ? snmp.SecurityLevel.authPriv
            : hasAuth
                ? snmp.SecurityLevel.authNoPriv
                : snmp.SecurityLevel.noAuthNoPriv;
        const user = {
            name: cfg.v3User,
            level,
        };
        if (hasAuth) {
            user.authProtocol = authProtocol;
            user.authKey = cfg.v3AuthKey;
        }
        if (hasPriv) {
            user.privProtocol = privProtocol;
            user.privKey = cfg.v3PrivKey;
        }
        return { snmp, session: snmp.createV3Session(cfg.host, user, options) };
    }

    if (cfg.version === '1') options.version = snmp.Version1;
    if (cfg.version === '2c') options.version = snmp.Version2c;

    return { snmp, session: snmp.createSession(cfg.host, cfg.community, options) };
};

const walkOid = async (snmp, session, oid) =>
    new Promise((resolve, reject) => {
        const cleanOid = sanitizeOid(oid);
        const rows = {};
        const feed = (varbinds = []) => {
            for (const vb of varbinds) {
                if (snmp.isVarbindError(vb)) continue;
                const vbOid = sanitizeOid(vb.oid);
                if (!vbOid.startsWith(cleanOid)) continue;
                rows[vbOid] = vb.value;
            }
        };
        const done = (error) => {
            if (error) return reject(error);
            resolve(rows);
        };
        if (typeof session.subtree === 'function') {
            session.subtree(cleanOid, 20, feed, done);
            return;
        }
        session.walk(cleanOid, 20, feed, done);
    });

const getOidValue = async (snmp, session, oid) =>
    new Promise((resolve, reject) => {
        const target = sanitizeOid(oid);
        session.get([target], (error, varbinds = []) => {
            if (error) return reject(error);
            const vb = varbinds[0];
            if (!vb || snmp.isVarbindError(vb)) return resolve(null);
            resolve(vb.value);
        });
    });

const extractIdx = (rawOid, baseOid) => {
    const cleanRaw = sanitizeOid(rawOid);
    const cleanBase = sanitizeOid(baseOid);
    if (cleanRaw.startsWith(`${cleanBase}.`)) return cleanRaw.substring(cleanBase.length + 1);
    return cleanRaw;
};

const decodeZteIfIndex = (ifIndex) => {
    const idx = Number(ifIndex);
    if (!Number.isFinite(idx)) return null;
    return {
        rack: (idx >>> 24) & 0x0f,
        shelf: (idx >>> 16) & 0xff,
        slot: (idx >>> 8) & 0xff,
        port: idx & 0xff,
    };
};

const parseZtePortFromName = (name = '') => {
    const m = String(name || '').match(/ONU-(\d+):(\d+)/i);
    if (!m) return null;
    return { port: Number(m[1]), onuId: Number(m[2]) };
};

const parseIndexToPath = (idx, profile = null, name = '') => {
    if (profile?.indexEncoding === 'zte-ifindex-onuid') {
        const parts = String(idx || '').split('.').map((v) => Number(v)).filter((v) => Number.isFinite(v));
        if (parts.length >= 2) {
            const ifIndex = parts[parts.length - 2];
            const onuId = parts[parts.length - 1];
            const decoded = decodeZteIfIndex(ifIndex);
            const nameHint = parseZtePortFromName(name);
            return {
                frame: decoded?.rack || 1,
                slot: decoded?.slot || decoded?.shelf || 1,
                port: (decoded?.port && decoded.port > 0) ? decoded.port : (nameHint?.port || 1),
                onuId: nameHint?.onuId || onuId,
                ifIndex,
            };
        }
    }
    const parts = String(idx || '').split('.').map((v) => Number(v)).filter((v) => Number.isFinite(v));
    const len = parts.length;
    if (len >= 2) {
        return {
            frame: len >= 4 ? parts[len - 4] : 0,
            slot: len >= 3 ? parts[len - 3] : 1,
            port: parts[len - 2],
            onuId: parts[len - 1],
        };
    }
    return { frame: 0, slot: 1, port: 1, onuId: Number(parts[0] || 0) };
};

export const resolveSnmpProfileForDevice = (device = {}) => {
    const configured = String(device.snmpProfile || 'auto').toLowerCase();
    if (configured !== 'auto') {
        const found = getOltSnmpProfileById(configured);
        if (found) return found;
    }
    return guessOltSnmpProfile(device.model || device.vendor || '');
};

export const readSnmpSystemInfo = async (device = {}) => {
    const { snmp, session } = await createSnmpSession(device);
    try {
        const sysDescr = await getOidValue(snmp, session, '1.3.6.1.2.1.1.1.0');
        const sysName = await getOidValue(snmp, session, '1.3.6.1.2.1.1.5.0');
        const uptimeTicks = await getOidValue(snmp, session, '1.3.6.1.2.1.1.3.0');
        const ticks = Number(uptimeTicks);
        const uptimeSeconds = Number.isFinite(ticks) ? Math.floor(ticks / 100) : null;
        return {
            sysDescr: cleanSnmpString(sysDescr),
            sysName: cleanSnmpString(sysName),
            uptimeSeconds,
        };
    } catch (error) {
        throw new Error(`SNMP system-info gagal ke ${describeSnmpTarget(device)}: ${error?.message || error}`);
    } finally {
        try { session.close(); } catch (_e) {}
    }
};

export const readSnmpOnuList = async (device = {}) => {
    const selected = resolveSnmpProfileForDevice(device);
    if (!selected) {
        throw new Error(`SNMP profile OID ONU belum tersedia untuk model "${device?.model || device?.name || 'unknown'}".`);
    }
    const profile = {
        ...selected,
        oids: {
            ...selected.oids,
            ...(device.snmpOids || {}),
            divider: Number(device?.snmpOids?.divider ?? selected?.oids?.divider ?? 1),
        },
    };

    const { snmp, session } = await createSnmpSession(device);
    try {
        const names = await walkOid(snmp, session, profile.oids.name);
        if (!Object.keys(names).length) {
            throw new Error(`OID name untuk profile "${profile.id}" tidak mengembalikan data.`);
        }
        const sns = await walkOid(snmp, session, profile.oids.sn);
        const statuses = await walkOid(snmp, session, profile.oids.status);
        const txs = await walkOid(snmp, session, profile.oids.tx);
        const rxs = await walkOid(snmp, session, profile.oids.rx);

        const map = {};
        for (const [oid, value] of Object.entries(names)) {
            const idx = extractIdx(oid, profile.oids.name);
            map[idx] = {
                index: idx,
                name: cleanSnmpString(value),
                sn: '',
                status: 'Down',
                txPower: 0,
                rxPower: 0,
            };
        }

        for (const [oid, value] of Object.entries(sns)) {
            const idx = extractIdx(oid, profile.oids.sn);
            if (map[idx]) map[idx].sn = cleanSnmpString(value);
        }
        for (const [oid, value] of Object.entries(statuses)) {
            const idx = extractIdx(oid, profile.oids.status);
            if (map[idx]) map[idx].status = parseStatusValue(value, profile);
        }
        for (const [oid, value] of Object.entries(txs)) {
            const idx = extractIdx(oid, profile.oids.tx);
            if (map[idx]) map[idx].txPower = parseSignalValue(value, profile.oids.divider, profile, 'tx');
        }
        for (const [oid, value] of Object.entries(rxs)) {
            const idx = extractIdx(oid, profile.oids.rx);
            if (map[idx]) map[idx].rxPower = parseSignalValue(value, profile.oids.divider, profile, 'rx');
        }

        const onus = Object.values(map)
            .filter((o) => o.name || o.sn)
            .map((o) => ({ ...o, ...parseIndexToPath(o.index, profile, o.name) }));

        return {
            detectedProfile: profile.id,
            onus,
        };
    } catch (error) {
        throw new Error(`SNMP ONU list gagal ke ${describeSnmpTarget(device)} (profile ${profile.id}): ${error?.message || error}`);
    } finally {
        try { session.close(); } catch (_e) {}
    }
};

export const readSnmpOnuPower = async (device = {}, index = '') => {
    const selected = resolveSnmpProfileForDevice(device);
    if (!selected) {
        throw new Error(`SNMP profile OID ONU belum tersedia untuk model "${device?.model || device?.name || 'unknown'}".`);
    }
    const profile = {
        ...selected,
        oids: {
            ...selected.oids,
            ...(device.snmpOids || {}),
            divider: Number(device?.snmpOids?.divider ?? selected?.oids?.divider ?? 1),
        },
    };
    if (!index) return null;

    const { snmp, session } = await createSnmpSession(device);
    try {
        const oid = `${sanitizeOid(profile.oids.rx)}.${String(index).trim()}`;
        const raw = await getOidValue(snmp, session, oid);
        if (raw == null) return null;
        return parseSignalValue(raw, profile.oids.divider, profile, 'rx');
    } catch (error) {
        throw new Error(`SNMP ONU power gagal ke ${describeSnmpTarget(device)} index ${String(index).trim()}: ${error?.message || error}`);
    } finally {
        try { session.close(); } catch (_e) {}
    }
};
