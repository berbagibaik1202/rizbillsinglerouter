import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import crypto from 'node:crypto';
import { createResellerPpobService, ppobOwnerColumn } from '../backend/services/resellerPpob.js';

// Load the real route definitions with isolated database/provider dependencies.
const source = readFileSync(new URL('../backend/routes/ppobRoutes.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace(/export const /g, 'const ')
    .replace('export default router;', 'return router;');

test('PPOB routes isolate reseller/customer history and forbid other accounts and admin actions', async t => {
    const rows = [
        { transaction_ref_id: 'CUSTOMER', customer_id: 'same-id', reseller_id: null, status: 'SUCCESS' },
        { transaction_ref_id: 'RESELLER', customer_id: null, reseller_id: 'same-id', status: 'SUCCESS' },
        { transaction_ref_id: 'OTHER', customer_id: null, reseller_id: 'other-id', status: 'PENDING' },
    ];
    const query = async (sql, values) => {
        if (sql.includes('WHERE t.reseller_id = ?')) return [rows.filter(r => r.reseller_id === values[0])];
        if (sql.includes('WHERE t.customer_id = ?')) return [rows.filter(r => r.customer_id === values[0])];
        if (sql.includes('AND reseller_id = ?')) return [rows.filter(r => r.transaction_ref_id === values[0] && r.reseller_id === values[1])];
        if (sql.includes('AND customer_id = ?')) return [rows.filter(r => r.transaction_ref_id === values[0] && r.customer_id === values[1])];
        throw new Error(`Unexpected database access: ${sql}`);
    };
    const pool = { query, getConnection: async () => ({ query, release() {} }) };
    let providerCalls = 0;
    const provider = { checkStatus: async () => { providerCalls++; throw new Error('unexpected dispatch'); } };
    const router = new Function('express', 'crypto', 'pool', 'digiflazzService', 'formatRupiah', 'getSettings', 'createResellerPpobService', 'ppobOwnerColumn', source)(
        express, crypto, pool, provider, String, async () => ({}), createResellerPpobService, ppobOwnerColumn);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'same-id', role: req.get('x-test-role') || 'reseller' }; next(); });
    app.use(router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const request = (path, role = 'reseller', method = 'GET') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'x-test-role': role } });
    const reseller = await (await request('/transactions')).json();
    const customer = await (await request('/transactions', 'customer')).json();
    assert.deepEqual(reseller.map(t => t.transaction_ref_id), ['RESELLER']);
    assert.deepEqual(customer.map(t => t.transaction_ref_id), ['CUSTOMER']);
    assert.equal((await request('/transactions/CUSTOMER/refresh', 'reseller', 'POST')).status, 404);
    assert.equal((await request('/transactions/RESELLER/refresh', 'customer', 'POST')).status, 404);
    assert.equal((await request('/transactions/OTHER/refresh', 'reseller', 'POST')).status, 404);
    assert.equal((await request('/transactions/RESELLER/refresh', 'reseller', 'POST')).status, 200);
    assert.equal((await request('/transactions', 'technician')).status, 403);
    assert.equal((await request('/admin/transactions')).status, 403);
    assert.equal((await request('/callback', 'reseller', 'POST')).status, 403);
    assert.equal(providerCalls, 0);
});
