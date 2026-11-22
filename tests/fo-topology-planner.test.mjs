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
