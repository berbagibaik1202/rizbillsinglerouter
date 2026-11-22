import test from 'node:test';
import assert from 'node:assert/strict';

const PLC_SPLITTER_LOSS = {
    '1:2': 3.7,
    '1:4': 7.2,
    '1:8': 10.5,
    '1:16': 13.8,
    '1:32': 17.1,
    '1:64': 20.5,
};

function calculateCableLoss(meters, ratePerKm = 0.35) {
    return (meters / 1000) * ratePerKm;
}

function calculatePathLoss({
    txPower = 5.0,
    feederMeters = 850,
    odcSplitter = '1:4',
    distributionMeters = 450,
    odpSplitter = '1:8',
    spliceCount = 2,
    connectorCount = 2,
}) {
    const feederLoss = calculateCableLoss(feederMeters);
    const odcLoss = PLC_SPLITTER_LOSS[odcSplitter] || 7.2;
    const distLoss = calculateCableLoss(distributionMeters);
    const odpLoss = PLC_SPLITTER_LOSS[odpSplitter] || 10.5;
    const spliceLoss = spliceCount * 0.1;
    const connectorLoss = connectorCount * 0.25;

    const totalLoss = feederLoss + odcLoss + distLoss + odpLoss + spliceLoss + connectorLoss;
    const calculatedRx = txPower - totalLoss;

    return {
        totalLoss: Number(totalLoss.toFixed(2)),
        calculatedRx: Number(calculatedRx.toFixed(2)),
    };
}

function evaluateDeviation(calculatedRx, actualMeasuredRx) {
    if (actualMeasuredRx == null || isNaN(actualMeasuredRx)) {
        return { hasDeviation: false, deviationDb: 0, status: 'NO_ACTUAL_DATA' };
    }
    const diff = Number(Math.abs(actualMeasuredRx - calculatedRx).toFixed(2));
    const isWarning = diff > 2.5;
    return {
        hasDeviation: isWarning,
        deviationDb: diff,
        status: isWarning ? 'EXCESSIVE_LOSS' : 'NORMAL',
    };
}

test('FO Topology Planner: calculatePathLoss correctly models multi-stage power budgeting', () => {
    // 5.0 dBm TX
    // Feeder: 850m @ 0.35 = 0.2975 dB
    // ODC: 1:4 = 7.2 dB
    // Distribusi: 450m @ 0.35 = 0.1575 dB
    // ODP: 1:8 = 10.5 dB
    // 2 splices = 0.2 dB, 2 connectors = 0.5 dB
    // Total Loss = 0.2975 + 7.2 + 0.1575 + 10.5 + 0.2 + 0.5 = 18.855 -> 18.86 dB
    // RX = 5.0 - 18.86 = -13.86 dBm
    const res = calculatePathLoss({
        txPower: 5.0,
        feederMeters: 850,
        odcSplitter: '1:4',
        distributionMeters: 450,
        odpSplitter: '1:8',
        spliceCount: 2,
        connectorCount: 2,
    });

    assert.ok(Math.abs(res.totalLoss - 18.86) < 0.1);
    assert.ok(Math.abs(res.calculatedRx - (-13.86)) < 0.1);
});

test('FO Topology Planner: evaluateDeviation flags excessive divergence between design and OPM measurement', () => {
    // Normal: calculated -17.0 dBm, actual -18.2 dBm -> deviation 1.2 dB (OK)
    const normal = evaluateDeviation(-17.0, -18.2);
    assert.strictEqual(normal.hasDeviation, false);
    assert.strictEqual(normal.status, 'NORMAL');

    // Excessive: calculated -17.0 dBm, actual -22.5 dBm -> deviation 5.5 dB (Warning)
    const excessive = evaluateDeviation(-17.0, -22.5);
    assert.strictEqual(excessive.hasDeviation, true);
    assert.strictEqual(excessive.status, 'EXCESSIVE_LOSS');
    assert.strictEqual(excessive.deviationDb, 5.5);
});

export function filterOdpsForOdc({ odps, odcs, selectedOdcId }) {
    const odcIdSet = new Set(odcs.map((o) => o.id));
    const odpMapById = new Map(odps.map((o) => [o.id, o]));

    const findRootOdcId = (parentId) => {
        let curr = parentId;
        const visited = new Set();
        while (curr && !visited.has(curr)) {
            visited.add(curr);
            if (odcIdSet.has(curr)) return curr;
            const parentOdp = odpMapById.get(curr);
            if (!parentOdp) break;
            curr = parentOdp.parentId;
        }
        return null;
    };

    return odps.filter((odp) => {
        if (selectedOdcId === 'all') return true;
        const rootOdcId = findRootOdcId(odp.parentId);
        return rootOdcId === selectedOdcId;
    });
}

test('FO Topology Planner: ODC filter strictly isolates ODPs without hijacking foreign or cascading nodes', () => {
    const mockOdcs = [
        { id: 'odc-jkg', name: 'ODC JKG' },
        { id: 'odc-psm', name: 'ODC PSM' },
    ];

    const mockOdps = [
        // Direct children of ODC JKG
        { id: 'odp-jkg-01', name: 'ODP-JKG-01', parentId: 'odc-jkg' },
        { id: 'odp-jkg-02', name: 'ODP-JKG-02', parentId: 'odc-jkg' },
        // Cascading child: parent is ODP-JKG-02 -> root is ODC JKG
        { id: 'odp-jkg-02-sub', name: 'ODP-JKG-02-SUB', parentId: 'odp-jkg-02' },
        // Children of ODC PSM
        { id: 'odp-psm-01', name: 'ODP-PSM-01', parentId: 'odc-psm' },
        { id: 'odp-psm-02', name: 'ODP-PSM-02', parentId: 'odc-psm' },
        // Unmapped ODP
        { id: 'odp-unmapped', name: 'ODP-UNMAPPED', parentId: null },
    ];

    // Filter by ODC JKG: only jkg-01, jkg-02, and jkg-02-sub should be returned
    const jkgFiltered = filterOdpsForOdc({
        odps: mockOdps,
        odcs: mockOdcs,
        selectedOdcId: 'odc-jkg',
    });
    const jkgIds = jkgFiltered.map((o) => o.id);
    assert.deepStrictEqual(jkgIds.sort(), ['odp-jkg-01', 'odp-jkg-02', 'odp-jkg-02-sub'].sort());
    assert.ok(!jkgIds.includes('odp-psm-01'), 'Must not hijack PSM ODP into JKG');
    assert.ok(!jkgIds.includes('odp-psm-02'), 'Must not hijack PSM ODP into JKG');
    assert.ok(!jkgIds.includes('odp-unmapped'), 'Must not hijack unmapped ODP into filtered ODC');

    // Filter by ODC PSM: only psm-01 and psm-02
    const psmFiltered = filterOdpsForOdc({
        odps: mockOdps,
        odcs: mockOdcs,
        selectedOdcId: 'odc-psm',
    });
    const psmIds = psmFiltered.map((o) => o.id);
    assert.deepStrictEqual(psmIds.sort(), ['odp-psm-01', 'odp-psm-02'].sort());

    // Filter 'all': returns all 6
    const allFiltered = filterOdpsForOdc({
        odps: mockOdps,
        odcs: mockOdcs,
        selectedOdcId: 'all',
    });
    assert.strictEqual(allFiltered.length, 6);
});

export function calculateOdcPower({
    rootTx = 5.0,
    feederMeters = 850,
    odcSplitter = '1:4',
}) {
    const feederLoss = (feederMeters / 1000) * 0.35;
    const powerIn = Number((rootTx - feederLoss).toFixed(2));

    let splitterLoss = 7.2;
    if (odcSplitter === 'direct' || odcSplitter === '1:1') splitterLoss = 0;
    else if (odcSplitter === '1:2') splitterLoss = 3.7;
    else if (odcSplitter === '1:8') splitterLoss = 10.5;

    const powerOut = Number((powerIn - splitterLoss).toFixed(2));
    return { powerIn, powerOut, feederLoss: Number(feederLoss.toFixed(2)) };
}

test('FO Topology Planner: OLT dedicated SFP port delivers strong positive power to ODC input', () => {
    // 5.0 dBm SFP TX, 850m 24C feeder cable -> feeder loss = 0.30 dB
    // Power arriving at ODC must be strong positive: +4.70 dBm!
    const resDirect = calculateOdcPower({
        rootTx: 5.0,
        feederMeters: 850,
        odcSplitter: 'direct',
    });
    assert.strictEqual(resDirect.powerIn, 4.70);
    assert.strictEqual(resDirect.powerOut, 4.70, 'Direct pass-through keeps power at +4.70 dBm');

    // 1:2 splitter inside ODC -> loss 3.7 dB -> power out +1.00 dBm
    const res12 = calculateOdcPower({
        rootTx: 5.0,
        feederMeters: 850,
        odcSplitter: '1:2',
    });
    assert.strictEqual(res12.powerIn, 4.70);
    assert.strictEqual(res12.powerOut, 1.00);

    // 1:4 splitter inside ODC -> loss 7.2 dB -> power out -2.50 dBm
    const res14 = calculateOdcPower({
        rootTx: 5.0,
        feederMeters: 850,
        odcSplitter: '1:4',
    });
    assert.strictEqual(res14.powerIn, 4.70);
    assert.strictEqual(res14.powerOut, -2.50);
});

export function resolveNodeCategory(name, type, isSimulated) {
    if (type === 'olt') return 'OLT';
    if (type === 'odc') return 'ODC';
    if (isSimulated) return 'DRAF';
    const upper = (name || '').toUpperCase();
    if (upper.startsWith('JB-') || upper.startsWith('JB ') || upper.startsWith('JC-') || upper.startsWith('CLOSURE') || upper.startsWith('SPLICE')) {
        return 'JB';
    }
    if (upper.startsWith('TIANG') || upper.startsWith('TNG-') || upper.startsWith('TNG ') || upper.startsWith('POLE')) {
        return 'TIANG';
    }
    return 'ODP';
}

export function evaluateCustomerDropStatus(custStatus, odpPowerOut, portIdx) {
    if (custStatus === 'inactive') {
        return { color: '#f43f5e', label: 'CRITICAL' };
    }
    const isWarning = odpPowerOut < -20 || portIdx === 3 || custStatus === 'suspended';
    if (isWarning) {
        return { color: '#f59e0b', label: 'WARNING' };
    }
    return { color: '#10b981', label: 'OPTIMAL' };
}

test('FO Topology Planner: resolveNodeCategory correctly identifies OLT, ODC, JB, TIANG, ODP and DRAF', () => {
    assert.strictEqual(resolveNodeCategory('OLT-PUSAT', 'olt'), 'OLT');
    assert.strictEqual(resolveNodeCategory('ODC-TBT-01', 'odc'), 'ODC');
    assert.strictEqual(resolveNodeCategory('JB-TBT-01', 'odp'), 'JB');
    assert.strictEqual(resolveNodeCategory('JC-KEMANG-01', 'odp'), 'JB');
    assert.strictEqual(resolveNodeCategory('TNG-042', 'odp'), 'TIANG');
    assert.strictEqual(resolveNodeCategory('TIANG-PASAR-02', 'odp'), 'TIANG');
    assert.strictEqual(resolveNodeCategory('ODP-TBT-01', 'odp'), 'ODP');
    assert.strictEqual(resolveNodeCategory('ODP-RENCANA-BARU', 'simulated', true), 'DRAF');
});

test('FO Topology Planner: evaluateCustomerDropStatus maps optical and connection health correctly', () => {
    // Active customer with optimal ODP power (-16.8 dBm) -> Optimal Green
    const opt = evaluateCustomerDropStatus('active', -16.8, 1);
    assert.strictEqual(opt.label, 'OPTIMAL');
    assert.strictEqual(opt.color, '#10b981');

    // Active customer on port 3 or with low ODP power (< -20 dBm) -> Warning Amber
    const warnPort3 = evaluateCustomerDropStatus('active', -16.8, 3);
    assert.strictEqual(warnPort3.label, 'WARNING');
    assert.strictEqual(warnPort3.color, '#f59e0b');

    const warnPower = evaluateCustomerDropStatus('active', -21.3, 1);
    assert.strictEqual(warnPower.label, 'WARNING');
    assert.strictEqual(warnPower.color, '#f59e0b');

    // Inactive customer -> Critical Red
    const crit = evaluateCustomerDropStatus('inactive', -16.8, 1);
    assert.strictEqual(crit.label, 'CRITICAL');
    assert.strictEqual(crit.color, '#f43f5e');
});

export const TIA598_COLORS = [
    { num: 1, name: 'Biru', hex: '#0284c7', textColor: '#ffffff' },
    { num: 2, name: 'Oranye', hex: '#ea580c', textColor: '#ffffff' },
    { num: 3, name: 'Hijau', hex: '#16a34a', textColor: '#ffffff' },
    { num: 4, name: 'Cokelat', hex: '#92400e', textColor: '#ffffff' },
    { num: 5, name: 'Abu-abu', hex: '#64748b', textColor: '#ffffff' },
    { num: 6, name: 'Putih', hex: '#f8fafc', textColor: '#0f172a' },
    { num: 7, name: 'Merah', hex: '#dc2626', textColor: '#ffffff' },
    { num: 8, name: 'Hitam', hex: '#1e293b', textColor: '#ffffff' },
    { num: 9, name: 'Kuning', hex: '#ca8a04', textColor: '#ffffff' },
    { num: 10, name: 'Ungu', hex: '#7c3aed', textColor: '#ffffff' },
    { num: 11, name: 'Pink', hex: '#db2777', textColor: '#ffffff' },
    { num: 12, name: 'Toska', hex: '#0891b2', textColor: '#ffffff' },
];

export const getTubeOrCoreColor = (num) => {
    const idx = ((num - 1) % 12 + 12) % 12;
    return TIA598_COLORS[idx];
};

export function isCoreSpliced(cableId, tubeNumber, coreNumber, splices, enclosureNodeId) {
    const found = splices.find((s) => {
        if (enclosureNodeId && s.enclosureNodeId !== enclosureNodeId) return false;
        return (
            (s.fromCableId === cableId && s.fromTubeNumber === tubeNumber && s.fromCoreNumber === coreNumber) ||
            (s.toCableId === cableId && s.toTubeNumber === tubeNumber && s.toCoreNumber === coreNumber)
        );
    });
    return { isSpliced: !!found, splice: found };
}

export function countCableUsedCores(cableId, splices) {
    const uniqueKeys = new Set();
    splices.forEach((s) => {
        if (s.fromCableId === cableId) {
            uniqueKeys.add(`T${s.fromTubeNumber}-C${s.fromCoreNumber}`);
        }
        if (s.toCableId === cableId) {
            uniqueKeys.add(`T${s.toTubeNumber}-C${s.toCoreNumber}`);
        }
    });
    return uniqueKeys.size;
}

export function getUpstreamTracePath(targetNodeId, cables) {
    const traceNodeIds = new Set();
    if (!targetNodeId) return { traceNodeIds, traceCableIds: new Set() };
    traceNodeIds.add(targetNodeId);
    const traceCableIds = new Set();

    let queue = [targetNodeId];
    const visited = new Set();

    while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const incomingCables = cables.filter((c) => c.toNodeId === currentId);
        for (const cable of incomingCables) {
            traceCableIds.add(cable.id);
            traceNodeIds.add(cable.fromNodeId);
            if (cable.fromNodeId !== 'root-olt') {
                queue.push(cable.fromNodeId);
            }
        }
    }

    return { traceNodeIds, traceCableIds };
}

export function synthesizeTopologyCables(persistedCables = [], flattenedNodes = [], deletedKeys = {}) {
    const list = [];
    const pairToCableMap = new Map();

    // 1. First add any custom/persisted cables
    persistedCables.forEach((c) => {
        const pairKey = `${c.fromNodeId}->${c.toNodeId}`;
        if (!deletedKeys[pairKey] && !deletedKeys[c.id]) {
            list.push(c);
            pairToCableMap.set(pairKey, c);
        }
    });

    // 2. Synthesize missing cables for any parent->child connections in the tree
    flattenedNodes.forEach((parent) => {
        if (!parent.children) return;
        parent.children.forEach((child) => {
            const pairKey = `${parent.id}->${child.id}`;
            if (deletedKeys[pairKey]) return;

            if (!pairToCableMap.has(pairKey)) {
                const isFeeder = parent.type === 'olt';
                const childCode = (child.name || '').replace(/[^A-Za-z0-9]/g, '');
                const parentCode = (parent.name || '').replace(/[^A-Za-z0-9]/g, '');
                const autoName = isFeeder
                    ? `FDR-OLT1-${childCode}`
                    : `DST-${parentCode}-${childCode}`;

                if (deletedKeys[autoName]) return;

                const totalCores = isFeeder ? 24 : (child.totalPorts > 8 ? 24 : 12);
                const tubesCount = isFeeder ? 2 : Math.max(1, Math.ceil(totalCores / 12));

                const synCable = {
                    id: autoName,
                    name: autoName,
                    fromNodeId: parent.id,
                    toNodeId: child.id,
                    totalCores,
                    tubesCount,
                    coresPerTube: 12,
                    lengthMeters: child.cableMeters || (isFeeder ? 850 : 350),
                    cableType: isFeeder ? 'Feeder' : 'Distribusi',
                    status: child.isSimulated ? 'PLANNED' : 'ACTIVE',
                };
                list.push(synCable);
                pairToCableMap.set(pairKey, synCable);
            }
        });
    });

    return list;
}

test('FO Topology Planner: TIA/EIA-598 standard maps 12 tube and core colors accurately', () => {
    assert.strictEqual(TIA598_COLORS.length, 12);
    assert.strictEqual(getTubeOrCoreColor(1).name, 'Biru');
    assert.strictEqual(getTubeOrCoreColor(2).name, 'Oranye');
    assert.strictEqual(getTubeOrCoreColor(3).name, 'Hijau');
    assert.strictEqual(getTubeOrCoreColor(6).name, 'Putih');
    assert.strictEqual(getTubeOrCoreColor(6).textColor, '#0f172a'); // Contrast text
    assert.strictEqual(getTubeOrCoreColor(12).name, 'Toska');
    // Repeating cycle for cables > 12 tubes or cores:
    assert.strictEqual(getTubeOrCoreColor(13).name, 'Biru');
    assert.strictEqual(getTubeOrCoreColor(24).name, 'Toska');
});

test('FO Topology Planner: Splice tracking correctly marks core usage and active counts', () => {
    const mockSplices = [
        {
            id: 'spl-1',
            enclosureNodeId: 'ODC-PSM-01',
            fromCableId: 'FDR-OLT1-ODC2',
            fromTubeNumber: 1,
            fromCoreNumber: 1,
            toCableId: 'DST-ODC2-JB2',
            toTubeNumber: 1,
            toCoreNumber: 1,
            lossDb: 0.05,
        },
        {
            id: 'spl-2',
            enclosureNodeId: 'ODC-PSM-01',
            fromCableId: 'FDR-OLT1-ODC2',
            fromTubeNumber: 1,
            fromCoreNumber: 2,
            toCableId: 'DST-ODC2-LTA1',
            toTubeNumber: 1,
            toCoreNumber: 1,
            lossDb: 0.05,
        },
    ];

    // FDR-OLT1-ODC2: Tube 1 Core 1 is spliced
    const checkCore1 = isCoreSpliced('FDR-OLT1-ODC2', 1, 1, mockSplices);
    assert.strictEqual(checkCore1.isSpliced, true);
    assert.strictEqual(checkCore1.splice?.toCableId, 'DST-ODC2-JB2');

    // FDR-OLT1-ODC2: Tube 1 Core 3 is NOT spliced (spare)
    const checkCore3 = isCoreSpliced('FDR-OLT1-ODC2', 1, 3, mockSplices);
    assert.strictEqual(checkCore3.isSpliced, false);

    // Total used cores on FDR-OLT1-ODC2 should be 2
    assert.strictEqual(countCableUsedCores('FDR-OLT1-ODC2', mockSplices), 2);
    // DST-ODC2-JB2 has 1 used core
    assert.strictEqual(countCableUsedCores('DST-ODC2-JB2', mockSplices), 1);
    // Unknown cable has 0 used cores
    assert.strictEqual(countCableUsedCores('UNKNOWN-CABLE', mockSplices), 0);
});

test('FO Topology Planner: getUpstreamTracePath traces backwards from target node up to root OLT', () => {
    const mockCables = [
        { id: 'fdr-1', fromNodeId: 'root-olt', toNodeId: 'ODC-PSM-01' },
        { id: 'dst-1', fromNodeId: 'ODC-PSM-01', toNodeId: 'JB-PSM-01' },
        { id: 'dst-2', fromNodeId: 'JB-PSM-01', toNodeId: 'ODP-PSM-01' },
        { id: 'fdr-2', fromNodeId: 'root-olt', toNodeId: 'ODC-TBT-01' },
    ];

    // Trace from ODP-PSM-01:
    // Path should be ODP-PSM-01 <- dst-2 <- JB-PSM-01 <- dst-1 <- ODC-PSM-01 <- fdr-1 <- root-olt
    const trace = getUpstreamTracePath('ODP-PSM-01', mockCables);
    assert.ok(trace.traceNodeIds.has('ODP-PSM-01'));
    assert.ok(trace.traceNodeIds.has('JB-PSM-01'));
    assert.ok(trace.traceNodeIds.has('ODC-PSM-01'));
    assert.ok(trace.traceNodeIds.has('root-olt'));
    assert.ok(!trace.traceNodeIds.has('ODC-TBT-01'), 'TBT branch must not be in PSM trace path');

    assert.ok(trace.traceCableIds.has('dst-2'));
    assert.ok(trace.traceCableIds.has('dst-1'));
    assert.ok(trace.traceCableIds.has('fdr-1'));
    assert.ok(!trace.traceCableIds.has('fdr-2'));

    // Trace from ODC-PSM-01:
    const traceOdc = getUpstreamTracePath('ODC-PSM-01', mockCables);
    assert.strictEqual(traceOdc.traceCableIds.size, 1);
    assert.ok(traceOdc.traceCableIds.has('fdr-1'));
});

test('FO Topology Planner: synthesizeTopologyCables automatically provides full cables for real DB nodes like ODC-02-CMS', () => {
    const mockNodes = [
        {
            id: 'root-olt',
            name: 'OLT-PUSAT',
            type: 'olt',
            children: [
                {
                    id: 'ODC-02-CMS',
                    name: 'ODC-02-CMS',
                    type: 'odc',
                    cableMeters: 850,
                    totalPorts: 16,
                    children: [
                        { id: 'CMS-06', name: 'CMS-06', type: 'odp', cableMeters: 274, totalPorts: 8, children: [] },
                        { id: 'CMS-07', name: 'CMS-07', type: 'odp', cableMeters: 310, totalPorts: 8, children: [] },
                        { id: 'CMS-08-CBHBL', name: 'CMS-08-CBHBL', type: 'odp', cableMeters: 347, totalPorts: 8, children: [] },
                    ],
                },
            ],
        },
        {
            id: 'ODC-02-CMS',
            name: 'ODC-02-CMS',
            type: 'odc',
            cableMeters: 850,
            totalPorts: 16,
            children: [
                { id: 'CMS-06', name: 'CMS-06', type: 'odp', cableMeters: 274, totalPorts: 8, children: [] },
                { id: 'CMS-07', name: 'CMS-07', type: 'odp', cableMeters: 310, totalPorts: 8, children: [] },
                { id: 'CMS-08-CBHBL', name: 'CMS-08-CBHBL', type: 'odp', cableMeters: 347, totalPorts: 8, children: [] },
            ],
        },
    ];

    // Even if persistedCables has no entries for ODC-02-CMS:
    const synCables = synthesizeTopologyCables([], mockNodes);

    // Should synthesize: 1 incoming feeder cable + 3 outgoing distribution cables = 4 cables!
    assert.strictEqual(synCables.length, 4);

    const inc = synCables.filter((c) => c.toNodeId === 'ODC-02-CMS');
    assert.strictEqual(inc.length, 1);
    assert.strictEqual(inc[0].name, 'FDR-OLT1-ODC02CMS');
    assert.strictEqual(inc[0].totalCores, 24);
    assert.strictEqual(inc[0].tubesCount, 2);
    assert.strictEqual(inc[0].lengthMeters, 850);

    const out = synCables.filter((c) => c.fromNodeId === 'ODC-02-CMS');
    assert.strictEqual(out.length, 3);
    assert.strictEqual(out[0].name, 'DST-ODC02CMS-CMS06');
    assert.strictEqual(out[1].name, 'DST-ODC02CMS-CMS07');
    assert.strictEqual(out[2].name, 'DST-ODC02CMS-CMS08CBHBL');
    assert.strictEqual(out[2].lengthMeters, 347);

    // Upstream trace path from ODC-02-CMS must now locate the feeder cable!
    const trace = getUpstreamTracePath('ODC-02-CMS', synCables);
    assert.ok(trace.traceCableIds.has('FDR-OLT1-ODC02CMS'));
    assert.ok(trace.traceNodeIds.has('root-olt'));
});

