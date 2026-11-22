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
