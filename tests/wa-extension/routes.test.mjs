import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import { createWaExtensionRouter } from '../../backend/wa-extension/router.js';
import { hashToken } from '../../backend/wa-extension/core.js';

async function fixture(t, options = {}) {
    const user = { id: 'u1', username: 'operator', role: options.role || 'admin', password: await bcrypt.hash('test-password', 4) };
    const customers = [{ id: 'C1', name: 'Pelanggan Satu', phone: '081234567890', status: 'active', pppoeUsername: 'ppp-one', acsSerialNumber: 'onu-one', oltDeviceId: 'OLT-1', oltFrame: 1, oltSlot: 1, oltPort: 4, oltOnuId: 62 }, { id: 'C2', name: 'Pelanggan Dua', phone: options.duplicatePhone ? '+62 81234567890' : '089876543210', pppoeUsername: 'ppp-two', acsSerialNumber: 'onu-two' }];
    const sessions = [];
    const audits = [];
    const limits = new Map();
    const links = [];
    const invoices = [{ id: 'INV-OVERDUE', customerId: 'C1', dueDate: '2000-01-01', amount: 150000, status: 'Unpaid' }, { id: 'INV-PAID', customerId: 'C1', dueDate: '2000-02-01', amount: 150000, status: 'Paid' }];
    let grants = options.grants || [];
    const query = async (sql, args = []) => {
        if (sql.startsWith('INSERT INTO extension_rate_limits')) { limits.set(args[0], (limits.get(args[0]) || 0) + 1); return [{}]; }
        if (sql.startsWith('SELECT hits')) return [[{ hits: limits.get(args[0]) }]];
        if (sql.startsWith('SELECT id, username, password')) return [[...(args[0] === user.username ? [user] : [])]];
        if (sql.startsWith('SELECT permission')) return [grants];
        if (sql.startsWith('DELETE FROM extension_rate_limits') || sql.includes('DELETE FROM extension_sessions WHERE expires_at')) return [{}];
        if (sql.startsWith('INSERT INTO extension_sessions')) { sessions.push({ session_id: args[0], access: args[2], refresh: args[3] }); return [{}]; }
        if (sql.startsWith('SELECT s.id')) {
            const session = sessions.find(row => sql.includes('WHERE s.refresh_hash') ? row.refresh === args[0] : row.access === args[0]);
            return [[...(session ? [{ ...user, ...session }] : [])]];
        }
        if (sql.startsWith('UPDATE extension_sessions')) {
            const session = sessions.find(row => row.session_id === args[2] && row.refresh === args[3]);
            if (session) { session.access = args[0]; session.refresh = args[1]; }
            return [{ affectedRows: session ? 1 : 0 }];
        }
        if (sql.startsWith('DELETE FROM extension_sessions WHERE id')) { const index = sessions.findIndex(row => row.session_id === args[0]); if (index >= 0) sessions.splice(index, 1); return [{}]; }
        if (sql.startsWith('SELECT id, phone')) return [customers.map(({ id, phone }) => ({ id, phone }))];
        if (sql.startsWith('SELECT customer_id FROM customer_whatsapp_links')) return [links.filter(row => row.phone_number === args[0])];
        if (sql.startsWith('SELECT c.id')) return [sql.includes('WHERE c.id =') ? customers.filter(row => row.id === args[0]) : customers];
        if (sql.startsWith('SELECT i.id')) return [invoices.filter(row => row.customerId === args[0])];
        if (sql.startsWith('SELECT status, power_rx')) return [[{ status: 'Up', powerRx: -19.8, serial: 'onu-one', updatedAt: '2026-09-10T12:00:00.000Z' }]];
        if (sql.startsWith('INSERT INTO customer_whatsapp_links')) { links.push({ phone_number: args[0], customer_id: args[1] }); return [{}]; }
        if (sql.startsWith('INSERT INTO extension_audit_logs')) {
            if (options.auditFails) throw new Error('Audit unavailable');
            audits.push({ id: args[0], action: args[3], result: args[6] }); return [{}];
        }
        if (sql.startsWith('UPDATE extension_audit_logs')) { audits.find(row => row.id === args[1]).result = args[0]; return [{}]; }
        if (sql.startsWith('SELECT id, action')) return [audits];
        throw new Error(`Unexpected query: ${sql}`);
    };
    const db = { query, getConnection: async () => ({ query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) };
    let rebootCalls = 0;
    const app = express(); app.use(express.json());
    app.use('/api/wa-extension', createWaExtensionRouter({ db, network: {
        async getNocSnapshot() { if (options.networkFails) throw new Error('secret router address'); return { status: 'OFFLINE', online: false, downloadMbps: 0, uploadMbps: 0 }; },
        async pingNocCustomer() { return { target: '10.0.0.1', samples: [{ time: '8ms' }] }; },
    }, acs: {
        async read() { return { lastInform: new Date().toISOString(), wifi: [{ ssid: 'Customer Wifi' }] }; },
        async reboot() { rebootCalls++; if (options.rebootFails) throw new Error('private ACS credential'); return { status: 'QUEUED' }; },
    }, env: { WA_NOC_REBOOT_LIMIT: 1 } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const call = async (path, method = 'GET', body, token) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/wa-extension${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, data: await response.json() };
    };
    const login = () => call('/auth/login', 'POST', { username: 'operator', password: 'test-password' });
    return { call, login, sessions, audits, rebootCalls: () => rebootCalls, setGrants: value => { grants = value; } };
}

test('requires dedicated token; customer/reseller role cannot log in implicitly', async t => {
    const f = await fixture(t, { role: 'reseller' });
    assert.equal((await f.call('/customers?q=test')).status, 401);
    assert.equal((await f.call('/customers?q=test', 'GET', undefined, 'legacy.jwt.token')).status, 401);
    assert.equal((await f.login()).status, 403);
});

test('token hashes only in DB, refresh rotates and logout revokes', async t => {
    const f = await fixture(t); const login = await f.login();
    assert.equal(login.status, 200);
    const { accessToken, refreshToken } = login.data;
    assert.equal(f.sessions[0].access, hashToken(accessToken));
    assert.notEqual(f.sessions[0].refresh, refreshToken);
    assert.equal((await f.call('/auth/me', 'GET', undefined, accessToken)).status, 200);
    const fresh = await f.call('/auth/refresh', 'POST', { refreshToken });
    assert.equal(fresh.status, 200);
    assert.equal((await f.call('/auth/refresh', 'POST', { refreshToken })).status, 401);
    assert.equal((await f.call('/auth/me', 'GET', undefined, accessToken)).status, 401);
    assert.equal((await f.call('/auth/logout', 'POST', {}, fresh.data.accessToken)).status, 200);
    assert.equal((await f.call('/auth/me', 'GET', undefined, fresh.data.accessToken)).status, 401);
});

test('customer lookup normalizes phone, returns 404 and refuses ambiguous matches', async t => {
    const f = await fixture(t); const token = (await f.login()).data.accessToken;
    assert.equal((await f.call('/customer/by-phone/6281234567890', 'GET', undefined, token)).data.id, 'C1');
    assert.equal((await f.call('/customer/by-phone/6280000000000', 'GET', undefined, token)).status, 404);
    const ambiguous = await fixture(t, { duplicatePhone: true }); const token2 = (await ambiguous.login()).data.accessToken;
    assert.equal((await ambiguous.call('/customer/by-phone/6281234567890', 'GET', undefined, token2)).status, 409);
});

test('provider failures remain UNAVAILABLE, customer and ACS panels still work', async t => {
    const f = await fixture(t, { networkFails: true }); const token = (await f.login()).data.accessToken;
    const network = await f.call('/customer/C1/network', 'GET', undefined, token);
    assert.equal(network.data.status, 'UNAVAILABLE');
    assert.equal(JSON.stringify(network).includes('secret router'), false);
    assert.equal((await f.call('/customer/C1/overview', 'GET', undefined, token)).data.customer.id, 'C1');
    assert.equal((await f.call('/customer/C1/acs', 'GET', undefined, token)).data.status, 'ONLINE');
});

test('billing returns package details and resolves overdue invoices', async t => {
    const f = await fixture(t); const token = (await f.login()).data.accessToken;
    const billing = await f.call('/customer/C1/billing', 'GET', undefined, token);
    assert.equal(billing.status, 200);
    assert.equal(billing.data.invoices[0].status, 'OVERDUE');
    assert.equal(billing.data.invoices[1].status, 'Paid');
});

test('OLT status uses explicit customer mapping and cached ONU data', async t => {
    const f = await fixture(t); const token = (await f.login()).data.accessToken;
    const olt = await f.call('/customer/C1/olt', 'GET', undefined, token);
    assert.equal(olt.status, 200);
    assert.equal(olt.data.status, 'UP');
    assert.equal(olt.data.onuId, 62);
    assert.equal((await f.call('/customer/C2/olt', 'GET', undefined, token)).data.status, 'UNLINKED');
});

test('confirmed reboot records intent and queued result, rate limits repeated actions', async t => {
    const f = await fixture(t); const token = (await f.login()).data.accessToken;
    assert.equal((await f.call('/customer/C1/reboot', 'POST', {}, token)).status, 400);
    assert.equal(f.rebootCalls(), 0);
    assert.equal((await f.call('/customer/C1/reboot', 'POST', { confirm: true }, token)).data.status, 'QUEUED');
    assert.equal(f.audits[0].result, 'QUEUED');
    assert.equal((await f.call('/customer/C1/reboot', 'POST', { confirm: true }, token)).status, 429);
    assert.equal(f.rebootCalls(), 1);
});

test('audit outage prevents dispatch and ambiguous device outcome stays UNKNOWN', async t => {
    const f = await fixture(t, { auditFails: true }); const token = (await f.login()).data.accessToken;
    assert.equal((await f.call('/customer/C1/reboot', 'POST', { confirm: true }, token)).status, 500);
    assert.equal(f.rebootCalls(), 0);
    const g = await fixture(t, { rebootFails: true }); const token2 = (await g.login()).data.accessToken;
    const result = await g.call('/customer/C1/reboot', 'POST', { confirm: true }, token2);
    assert.equal(result.status, 502); assert.equal(g.audits[0].result, 'UNKNOWN');
    assert.equal(JSON.stringify(result).includes('credential'), false);
});

test('permission revocation takes effect for an existing session', async t => {
    const f = await fixture(t); const token = (await f.login()).data.accessToken;
    f.setGrants([{ permission: 'reboot', allowed: 0 }]);
    assert.equal((await f.call('/customer/C1/reboot', 'POST', { confirm: true }, token)).status, 403);
    assert.equal(f.rebootCalls(), 0);
    f.setGrants([{ permission: 'view', allowed: 0 }]);
    assert.equal((await f.call('/customer/C1/overview', 'GET', undefined, token)).status, 403);
});

test('mapping refuses a number owned by another customer', async t => {
    const f = await fixture(t); const token = (await f.login()).data.accessToken;
    assert.equal((await f.call('/customer/C2/link', 'POST', { phone: '081234567890', confirm: true }, token)).status, 409);
    assert.equal((await f.call('/customer/C1/link', 'POST', { phone: '081111111111', confirm: true }, token)).status, 200);
    assert.equal((await f.call('/customer/by-phone/6281111111111', 'GET', undefined, token)).data.id, 'C1');
});
