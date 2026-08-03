import snmp from 'net-snmp';

const SYS_DESCR = '1.3.6.1.2.1.1.1.0';
const SYS_NAME = '1.3.6.1.2.1.1.5.0';
const SYS_UPTIME = '1.3.6.1.2.1.1.3.0';

const IF_TABLE_OID = '1.3.6.1.2.1.2.2';
const IF_NAME_OID = '1.3.6.1.2.1.31.1.1.1.1';
const IF_ALIAS_OID = '1.3.6.1.2.1.31.1.1.1.18';

// ZTE GPON OIDs
const OID_ZX_GPON_ONT_NAME = '1.3.6.1.4.1.3902.1012.3.28.1.1.3';
const OID_ZX_GPON_ONT_PHASE = '1.3.6.1.4.1.3902.1012.3.28.2.1.4';
// ZTE GPON ifIndex pattern (C300/C320): base per board, +256 per PON
const ZTE_BOARD_BASES = [
    { board: 1, slot: 1, base: 268500992 }, // PON1 = base + 256
    { board: 2, slot: 2, base: 268566528 }, // PON1 = base + 256
];
const ZTE_PON_STRIDE = 256;

// Mathematical OID prefixes (3902.1082.*) berdasarkan referensi
const BASE_1082 = '1.3.6.1.4.1.3902.1082';
const OID_MATH_NAME_PREFIX = `${BASE_1082}.500.10.2.3.3.1.2`;
const OID_MATH_SERIAL_PREFIX = `${BASE_1082}.500.10.2.3.3.1.18`;
const OID_MATH_STATUS_PREFIX = `${BASE_1082}.500.10.2.3.8.1.4`;
const OID_MATH_RX_PREFIX = `${BASE_1082}.500.20.2.2.2.1.10`;
// EPON round-trip time (ZXEPON-SERVICE-MIB) untuk estimasi panjang fiber
const OID_EPON_RTT_PREFIX = '1.3.6.1.4.1.3902.1015.1010.1.2.1.1.10';
// Board/PON base untuk index matematika (OnuID/Name/Status/Serial)
const ZTE_MATH_BOARDS = [
    // pola onuid/serial base (285278464/285278720) increment 1 per PON
    { board: 1, slot: 1, ponBase: 285278464, ponStride: 1 },
    { board: 2, slot: 2, ponBase: 285278720, ponStride: 1 },
    // pola ifIndex base (268500992/268566528) increment 256 per PON
    { board: 1, slot: 1, ponBase: 268500992, ponStride: 256 },
    { board: 2, slot: 2, ponBase: 268566528, ponStride: 256 },
];
const IF_COLUMNS = {
    descr: '1.3.6.1.2.1.2.2.1.2',
    adminStatus: '1.3.6.1.2.1.2.2.1.7',
    operStatus: '1.3.6.1.2.1.2.2.1.8',
    highSpeed: '1.3.6.1.2.1.31.1.1.1.15',
    inErrors: '1.3.6.1.2.1.2.2.1.14',
    outErrors: '1.3.6.1.2.1.2.2.1.20',
};

const toSeconds = (ticks = 0) => Math.round(Number(ticks || 0) / 100);

const formatUptime = (seconds) => {
    const s = Math.max(0, Math.floor(seconds || 0));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return [
        days ? `${days}d` : '',
        hours ? `${hours}h` : '',
        mins ? `${mins}m` : '',
        `${secs}s`,
    ].filter(Boolean).join(' ');
};

const createSession = (device) => {
    const opts = {
        port: device.snmpPort || 161,
        timeout: device.snmpTimeoutMs || 5000,
        retries: 1,
    };

    if ((device.snmpVersion || '2c') === '3') {
        const user = {
            name: device.snmpUser || '',
            level: device.snmpSecLevel === 'noAuthNoPriv'
                ? snmp.SecurityLevel.noAuthNoPriv
                : device.snmpSecLevel === 'authNoPriv'
                    ? snmp.SecurityLevel.authNoPriv
                    : snmp.SecurityLevel.authPriv,
        };
        if (user.level === snmp.SecurityLevel.authNoPriv || user.level === snmp.SecurityLevel.authPriv) {
            user.authProtocol = (device.snmpAuthProto || 'sha') === 'md5' ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha;
            user.authKey = device.snmpAuthPass || '';
        }
        if (user.level === snmp.SecurityLevel.authPriv) {
            user.privProtocol = (device.snmpPrivProto || 'aes') === 'des' ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes;
            user.privKey = device.snmpPrivPass || '';
        }
        const session = snmp.createV3Session(device.host, user, opts);
        return session;
    }

    const community = device.snmpCommunity || 'public';
    return snmp.createSession(device.host, community, opts);
};

const snmpGet = (session, oids = []) => new Promise((resolve, reject) => {
    session.get(oids, (err, varbinds) => {
        if (err) return reject(err);
        resolve(varbinds);
    });
});

const snmpTable = (session, baseOid, maxRepetitions = 20) => new Promise((resolve, reject) => {
    session.table(baseOid, maxRepetitions, (err, table) => {
        if (err) return reject(err);
        resolve(table || {});
    });
});

const snmpWalk = (session, oid, maxRepetitions = 10) => new Promise((resolve, reject) => {
    const rows = [];
    session.subtree(oid, maxRepetitions, (varbind) => {
        rows.push(varbind);
    }, (err) => {
        if (err) return reject(err);
        resolve(rows);
    });
});

export const getSystemInfo = async (device) => {
    const session = createSession(device);
    try {
        const vbs = await snmpGet(session, [SYS_DESCR, SYS_NAME, SYS_UPTIME]);
        const byOid = Object.fromEntries(vbs.map((vb) => [vb.oid, vb.value?.toString() || '']));
        const uptimeSeconds = toSeconds(vbs.find((vb) => vb.oid === SYS_UPTIME)?.value || 0);
        return {
            sysDescr: byOid[SYS_DESCR] || null,
            sysName: byOid[SYS_NAME] || null,
            uptimeSeconds,
            uptimeText: formatUptime(uptimeSeconds),
        };
    } finally {
        try { session.close(); } catch (e) { /* ignore */ }
    }
};

export const getInterfaces = async (device, { limit = 128 } = {}) => {
    const session = createSession(device);
    try {
        const table = await snmpTable(session, IF_TABLE_OID, 20);
        const rows = Object.keys(table)
            .sort((a, b) => Number(a) - Number(b))
            .slice(0, limit)
            .map((idx) => {
                const row = table[idx] || {};
                return {
                    index: Number(idx),
                    descr: row[IF_COLUMNS.descr]?.toString() || row[IF_COLUMNS.descr.replace('.2', '.3')]?.toString() || '',
                    adminStatus: Number(row[IF_COLUMNS.adminStatus] || 0),
                    operStatus: Number(row[IF_COLUMNS.operStatus] || 0),
                    highSpeedMbps: Number(row[IF_COLUMNS.highSpeed] || 0),
                    inErrors: Number(row[IF_COLUMNS.inErrors] || 0),
                    outErrors: Number(row[IF_COLUMNS.outErrors] || 0),
                };
            });
        return rows;
    } finally {
        try { session.close(); } catch (e) { /* ignore */ }
    }
};

// ifIndex -> { name, alias }
export const getIfNames = async (device, ifIndexList = []) => {
    const session = createSession(device);
    const result = {};
    try {
        if (ifIndexList.length === 0) return result;
        for (const idx of ifIndexList) {
            try {
                const [nameVb] = await snmpGet(session, [`${IF_NAME_OID}.${idx}`]);
                const [aliasVb] = await snmpGet(session, [`${IF_ALIAS_OID}.${idx}`]);
                result[idx] = {
                    name: nameVb?.value?.toString?.() || '',
                    alias: aliasVb?.value?.toString?.() || '',
                };
            } catch (e) {
                // ignore
            }
        }
    } finally {
        try { session.close(); } catch (e) { /* ignore */ }
    }
    return result;
};

const parseTailIndex = (oid = '') => {
    const parts = oid.split('.').filter(Boolean);
    const onuId = Number(parts.pop() || 0);
    const ifIndex = Number(parts.pop() || 0);
    return { ifIndex, onuId };
};

const parsePonFromName = (name = '') => {
    const m = name.match(/gpon[-_]olt[_-]?(\d+)\/(\d+)\/(\d+)/i);
    if (m) return { frame: Number(m[1]), slot: Number(m[2]), port: Number(m[3]) };
    return null;
};

const decodePonFromIndex = (ifIndex = 0) => {
    for (const b of ZTE_BOARD_BASES) {
        const delta = Number(ifIndex) - Number(b.base);
        if (delta > 0 && delta % ZTE_PON_STRIDE === 0) {
            const pon = delta / ZTE_PON_STRIDE;
            return { frame: 0, slot: b.slot, port: pon };
        }
    }
    return null;
};

const parsePonFromOnuName = (name = '') => {
    const m = String(name || '').match(/ONU-(\d+)[/:]/i);
    if (m) {
        return { port: Number(m[1]) };
    }
    return null;
};

// List ONT registered via SNMP (name + phase status)
export const getGponOnts = async (device) => {
    const session = createSession(device);
    try {
        const [names, phases] = await Promise.all([
            snmpWalk(session, OID_ZX_GPON_ONT_NAME),
            snmpWalk(session, OID_ZX_GPON_ONT_PHASE),
        ]);

        const statusMap = {
            0: 'logging',
            1: 'los',
            2: 'syncMib',
            3: 'working',
            4: 'dyinggasp',
            5: 'authFailed',
            6: 'offline',
        };

        const ifIdxSet = new Set();
        names.forEach((vb) => { const { ifIndex } = parseTailIndex(vb.oid); if (ifIndex) ifIdxSet.add(ifIndex); });
        phases.forEach((vb) => { const { ifIndex } = parseTailIndex(vb.oid); if (ifIndex) ifIdxSet.add(ifIndex); });
        const ifMeta = await getIfNames(device, Array.from(ifIdxSet));

        const phaseByKey = new Map();
        phases.forEach((vb) => {
            const { ifIndex, onuId } = parseTailIndex(vb.oid);
            const key = `${ifIndex}.${onuId}`;
            phaseByKey.set(key, Number(vb.value));
        });

        const result = [];
        names.forEach((vb) => {
            const { ifIndex, onuId } = parseTailIndex(vb.oid);
            if (!ifIndex || !onuId) return;
            const key = `${ifIndex}.${onuId}`;
            const statusCode = phaseByKey.get(key);
            const statusText = statusMap[statusCode] || 'unknown';
            const meta = ifMeta[ifIndex] || {};
            const derivedFromName = parsePonFromName(meta.name || meta.alias || '') || parsePonFromOnuName(vb.value?.toString?.() || '');
            const pon = derivedFromName ||
                decodePonFromIndex(ifIndex) || {
                    frame: Number(device.ponFrame ?? device.gponFrame ?? device.frame ?? 0),
                    slot: Number(device.ponSlot ?? device.gponSlot ?? device.slot ?? 1),
                    port: Number(device.ponPort ?? device.gponPort ?? 1),
                };
            result.push({
                frame: pon?.frame ?? null,
                slot: pon?.slot ?? null,
                port: pon?.port ?? null,
                onuId,
                serial: null,
                customerName: vb.value?.toString?.() || '',
                status: statusText,
                source: 'snmp',
                ifIndex,
            });
        });

        if (result.length) return result;
        // Jika tidak ada hasil, coba jalur matematika (base 1082) berdasarkan config referensi
        const mathResults = [];
        for (const board of ZTE_MATH_BOARDS) {
            for (let pon = 1; pon <= 16; pon++) {
                const ponIndex = board.ponBase + (pon * (board.ponStride || 256));
                let misses = 0;
                let hasData = 0;
                const missThreshold = board.ponStride === 1 ? 10 : 5;
                for (let onu = 1; onu <= 128; onu++) {
                    try {
                        const [nameVb] = await snmpGet(session, [`${OID_MATH_NAME_PREFIX}.${ponIndex}.${onu}`]);
                        const [statusVb] = await snmpGet(session, [`${OID_MATH_STATUS_PREFIX}.${ponIndex}.${onu}`]);
                        let serialVal = null;
                        try {
                            const [serialVb] = await snmpGet(session, [`${OID_MATH_SERIAL_PREFIX}.${ponIndex}.${onu}`]);
                            serialVal = serialVb?.value?.toString?.() || null;
                        } catch (e) { /* ignore missing serial */ }
                        const statusCode = Number(statusVb?.value);
                        const statusText = statusMap[statusCode] || 'unknown';
                        mathResults.push({
                            frame: 0,
                            slot: board.slot,
                            port: pon,
                            onuId: onu,
                            serial: serialVal,
                            customerName: nameVb?.value?.toString?.() || '',
                            status: statusText,
                            source: 'snmp-math',
                            ifIndex: ponIndex,
                        });
                        misses = 0;
                        hasData += 1;
                    } catch (e) {
                        misses += 1;
                        if (misses >= missThreshold && hasData === 0) break;
                        if (misses >= missThreshold && hasData > 0) break;
                    }
                }
            }
        }
        return mathResults;
    } finally {
        try { session.close(); } catch (e) { /* ignore */ }
    }
};

// Hitung indeks PON untuk OID matematika (base 1082) dan ambil RX power ONT.
const computePonIndex = (slot = 1, port = 1, zeroBased = false) => {
    const entry = ZTE_MATH_BOARDS.find((b) => Number(b.slot) === Number(slot));
    if (!entry) return null;
    const stride = entry.ponStride || 256;
    const p = Math.max(0, Number(port || 1) - (zeroBased ? 1 : 0));
    return entry.ponBase + (p * stride);
};

// Hitung ifIndex PON (stride 256) untuk kebutuhan EPON RTT (Type 3/9 composite index).
const computeIfIndex = (slot = 1, port = 1, zeroBased = false) => {
    const entry = ZTE_MATH_BOARDS.find((b) => Number(b.slot) === Number(slot) && Number(b.ponStride || 0) >= 256);
    if (!entry) return null;
    const stride = entry.ponStride || 256;
    const p = Math.max(0, Number(port || 1) - (zeroBased ? 1 : 0));
    return entry.ponBase + (p * stride);
};

export const getOnuPower = async (device, { frame = 0, slot = 1, port = 1, onuId = 1 } = {}) => {
    const session = createSession(device);
    try {
        let lastErr = null;
        for (const zeroBased of [false, true]) {
            try {
                const ponIndex = computePonIndex(slot, port, zeroBased);
                if (!ponIndex) continue;
                const oidRx = `${OID_MATH_RX_PREFIX}.${ponIndex}.${onuId}`;
                const [rxVb] = await snmpGet(session, [oidRx]);
                const rxPower = rxVb?.value != null ? Number(rxVb.value) : null;
                return { rxPower, oid: oidRx };
            } catch (e) {
                lastErr = e;
                continue;
            }
        }
        if (lastErr) throw lastErr;
        throw new Error('Tidak menemukan indeks PON untuk OID power.');
    } finally {
        try { session.close(); } catch (e) { /* ignore */ }
    }
};

// Ambil detail ONT (nama/serial/status) via OID matematika per ONU.
export const getOnuDetailSnmp = async (device, { slot = 1, port = 1, onuId = 1 } = {}) => {
    const session = createSession(device);
    try {
        let lastErr = null;
        for (const zeroBased of [false, true]) {
            try {
                const ponIndex = computePonIndex(slot, port, zeroBased);
                if (!ponIndex) continue;
                const oidName = `${OID_MATH_NAME_PREFIX}.${ponIndex}.${onuId}`;
                const oidSerial = `${OID_MATH_SERIAL_PREFIX}.${ponIndex}.${onuId}`;
                const oidStatus = `${OID_MATH_STATUS_PREFIX}.${ponIndex}.${onuId}`;
                const [nameVb] = await snmpGet(session, [oidName]);
                let serialVb = null;
                try {
                    [serialVb] = await snmpGet(session, [oidSerial]);
                } catch (e) { /* serial optional */ }
                let statusVb = null;
                try {
                    [statusVb] = await snmpGet(session, [oidStatus]);
                } catch (e) { /* status optional */ }
                const statusMap = {
                    0: 'logging',
                    1: 'los',
                    2: 'syncMib',
                    3: 'working',
                    4: 'dyinggasp',
                    5: 'authFailed',
                    6: 'offline',
                };
                const status = statusVb?.value != null ? statusMap[Number(statusVb.value)] || 'unknown' : null;
                return {
                    name: nameVb?.value?.toString?.() || null,
                    serial: serialVb?.value?.toString?.() || null,
                    status,
                    oidName,
                    oidSerial,
                    oidStatus,
                };
            } catch (e) {
                lastErr = e;
                continue;
            }
        }
        if (lastErr) throw lastErr;
        throw new Error('Tidak menemukan indeks PON untuk OID detail.');
    } finally {
        try { session.close(); } catch (e) { /* ignore */ }
    }
};

// Ambil round-trip time (RTT) ONT untuk estimasi panjang fiber (meter).
// Fiber length = dot3MpcpRoundTripTime * 1.635 / 1000
export const getOnuFiberLength = async (device, { ifIndex = null, slot = 1, port = 1 } = {}) => {
    const session = createSession(device);
    try {
        let lastErr = null;
        const candidates = [];
        if (ifIndex) candidates.push(ifIndex);
        // RTT OID menggunakan indeks PON (base 285278720/stride 1)
        for (const zeroBased of [false, true]) {
            const idxMath = computePonIndex(slot, port, zeroBased);
            if (idxMath) candidates.push(idxMath);
        }
        // Tambahkan ifIndex (stride 256) sebagai cadangan
        for (const zeroBased of [false, true]) {
            const idxIf = computeIfIndex(slot, port, zeroBased);
            if (idxIf) candidates.push(idxIf);
        }
        for (const idx of candidates) {
            try {
                const oidRtt = `${OID_EPON_RTT_PREFIX}.${idx}`;
                const [vb] = await snmpGet(session, [oidRtt]);
                const rtt = vb?.value != null ? Number(vb.value) : null;
                const fiberLengthMeters = rtt != null ? (Number(rtt) * 1.635) / 1000 : null;
                return { roundTripTime: rtt, fiberLengthMeters, oid: oidRtt };
            } catch (e) {
                lastErr = e;
                continue;
            }
        }
        if (lastErr) throw lastErr;
        throw new Error('ifIndex tidak diketahui untuk slot/port yang diminta.');
    } finally {
        try { session.close(); } catch (e) { /* ignore */ }
    }
};

export default {
    getSystemInfo,
    getInterfaces,
    getGponOnts,
    getIfNames,
    getOnuPower,
    getOnuDetailSnmp,
    getOnuFiberLength,
};
