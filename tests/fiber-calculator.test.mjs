import test from 'node:test';
import assert from 'node:assert/strict';

const PLC_LOSS_MAP = {
    '1:2': 3.7,
    '1:4': 7.2,
    '1:8': 10.5,
    '1:16': 13.8,
    '1:32': 17.1,
    '1:64': 20.5,
};

const FBT_LOSS_MAP = {
    '90:10': { through: 0.6, tap: 10.5 },
    '80:20': { through: 1.2, tap: 7.5 },
    '70:30': { through: 1.9, tap: 5.8 },
    '60:40': { through: 2.7, tap: 4.4 },
    '50:50': { through: 3.6, tap: 3.6 },
};

function calculateStageLoss(stage) {
    switch (stage.type) {
        case 'cable': {
            const meters = stage.lengthMeters || 0;
            const rate = stage.attenuationPerKm ?? 0.35;
            return (meters / 1000) * rate;
        }
        case 'plc_splitter': {
            return PLC_LOSS_MAP[stage.plcRatio || '1:8'] || 10.5;
        }
        case 'fbt_coupler': {
            const ratioData = FBT_LOSS_MAP[stage.fbtRatio || '90:10'] || { through: 0.6, tap: 10.5 };
            return stage.fbtPort === 'through' ? ratioData.through : ratioData.tap;
        }
        case 'splice': {
            const count = stage.spliceCount || 0;
            const loss = stage.lossPerSplice ?? 0.1;
            return count * loss;
        }
        case 'connector': {
            const count = stage.connectorCount || 0;
            const loss = stage.lossPerConnector ?? 0.25;
            return count * loss;
        }
        case 'custom_attenuator': {
            return Math.max(0, stage.customLossDb || 0);
        }
        default:
            return 0;
    }
}

function evaluateRxStatus(rxPowerDbm) {
    if (rxPowerDbm > -8) {
        return { status: 'OVERPOWER', label: 'Overpower (> -8 dBm)', color: 'red' };
    }
    if (rxPowerDbm >= -24 && rxPowerDbm <= -15) {
        return { status: 'OPTIMAL', label: 'Optimal (-15 s/d -24 dBm)', color: 'green' };
    }
    if (rxPowerDbm < -24 && rxPowerDbm >= -27) {
        return { status: 'WARNING', label: 'Waspada / Redaman Tinggi (-24 s/d -27 dBm)', color: 'yellow' };
    }
    return { status: 'LOS', label: 'Kritis / Redaman Buruk (< -27 dBm)', color: 'red' };
}

test('Fiber Calculator: calculateStageLoss correctly computes optical loss for all elements', () => {
    // Cable: 2000m at 0.35 dB/km = 0.7 dB
    const cableLoss = calculateStageLoss({ type: 'cable', lengthMeters: 2000, attenuationPerKm: 0.35 });
    assert.strictEqual(cableLoss, 0.7);

    // PLC 1:8 = 10.5 dB
    const plcLoss = calculateStageLoss({ type: 'plc_splitter', plcRatio: '1:8' });
    assert.strictEqual(plcLoss, 10.5);

    // FBT 90:10 Tap = 10.5 dB, Through = 0.6 dB
    const fbtTap = calculateStageLoss({ type: 'fbt_coupler', fbtRatio: '90:10', fbtPort: 'tap' });
    assert.strictEqual(fbtTap, 10.5);
    const fbtThrough = calculateStageLoss({ type: 'fbt_coupler', fbtRatio: '90:10', fbtPort: 'through' });
    assert.strictEqual(fbtThrough, 0.6);

    // Splice: 4 splices @ 0.1 dB = 0.4 dB
    const spliceLoss = calculateStageLoss({ type: 'splice', spliceCount: 4, lossPerSplice: 0.1 });
    assert.strictEqual(spliceLoss, 0.4);

    // Connector: 2 connectors @ 0.25 dB = 0.5 dB
    const connLoss = calculateStageLoss({ type: 'connector', connectorCount: 2, lossPerConnector: 0.25 });
    assert.strictEqual(connLoss, 0.5);
});

test('Fiber Calculator: evaluateRxStatus correctly assesses receiver optical margins', () => {
    assert.strictEqual(evaluateRxStatus(-5).status, 'OVERPOWER');
    assert.strictEqual(evaluateRxStatus(-18.5).status, 'OPTIMAL');
    assert.strictEqual(evaluateRxStatus(-25.2).status, 'WARNING');
    assert.strictEqual(evaluateRxStatus(-28.4).status, 'LOS');
});
