import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, permissionsFor, acsStatus, createCache } from '../../backend/wa-extension/core.js';

test('normalizes Indonesian and international phones without extracting numbers from messages', () => {
    for (const value of ['+62 822-4936-3946', '082249363946', '82249363946', '006282249363946']) assert.equal(normalizePhone(value), '6282249363946');
    assert.equal(normalizePhone('+1 (415) 555-0100'), '14155550100');
    for (const value of ['', 'Internet 082249363946 lambat', '123', null, '1234567890123456']) assert.equal(normalizePhone(value), null);
});

test('explicit deny overrides admin and unknown/reseller roles have no implicit access', () => {
    assert.deepEqual(permissionsFor({ role: 'reseller' }, []), []);
    assert.deepEqual(permissionsFor({ role: 'technician' }, [{ permission: 'view', allowed: 1 }, { permission: 'unrecognized', allowed: 1 }]), ['view']);
    assert.equal(permissionsFor({ role: 'admin' }, [{ permission: 'reboot', allowed: 0 }]).includes('reboot'), false);
});

test('ACS status handles stale, absent, invalid and future last inform', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    assert.equal(acsStatus('2026-09-09T11:55:00Z', now), 'ONLINE');
    assert.equal(acsStatus('2026-09-09T11:45:00Z', now), 'STALE');
    assert.equal(acsStatus('2026-09-09T11:00:00Z', now), 'OFFLINE');
    for (const value of [null, 'invalid', '2026-09-10']) assert.equal(acsStatus(value, now), 'UNKNOWN');
});

test('collector coalesces concurrent requests and retries failures instead of caching fake zeroes', async () => {
    const cache = createCache();
    let calls = 0;
    const work = async () => { calls++; return { downloadMbps: 5 }; };
    const rows = await Promise.all([cache('a', work), cache('a', work)]);
    assert.equal(calls, 1);
    assert.equal(rows[1].downloadMbps, 5);
    await assert.rejects(cache('b', async () => { throw new Error('offline'); }));
    assert.deepEqual(await cache('b', work), { downloadMbps: 5 });
    assert.equal(calls, 2);
});
