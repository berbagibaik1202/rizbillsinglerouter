import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

// Run the actual service functions with isolated database/router dependencies.
const source = await fs.readFile(new URL('../backend/services.js', import.meta.url), 'utf8');
const serviceFunctions = source.slice(source.indexOf('export const suspendCustomer ='), source.indexOf('export const rebootCustomerDevice =')).replaceAll('export const ', 'const ');

function setup(t, status, deactivateDuringLookup = false) {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec('CREATE TABLE customers (id TEXT PRIMARY KEY, status TEXT, previousPppoeProfile TEXT);');
    db.prepare('INSERT INTO customers VALUES (?, ?, ?)').run('customer', status, 'original');
    let routerLookups = 0;
    const pool = {
        query: async (sql, params) => {
            if (sql.includes('SELECT c.*')) return [[db.prepare('SELECT * FROM customers WHERE id = ?').get(params[0])]];
            if (sql.startsWith('UPDATE customers')) return [{ affectedRows: db.prepare(sql).run(...params).changes }];
            throw new Error(`Unexpected query: ${sql}`);
        },
        getConnection: async () => { throw new Error('Unexpected transaction'); },
    };
    const context = vm.createContext({
        pool,
        console: { log() {}, warn() {} },
        getSettings: async () => ({ billing: { suspensionProfileName: 'isolir' } }),
        resolveLinkedPppoeForCustomer: async () => {
            routerLookups++;
            if (deactivateDuringLookup) db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('Inactive', 'customer');
            return { username: '', pppoeUser: null };
        },
    });
    vm.runInContext(`${serviceFunctions}\nglobalThis.services = { suspendCustomer, restoreCustomerProfile };`, context);
    return { db, services: context.services, routerLookups: () => routerLookups };
}

test('inactive customers keep their status for every invoice state and never reach the router', async t => {
    for (const customerStatus of ['Inactive', 'inactive', ' INACTIVE ']) {
        const fixture = setup(t, customerStatus);
        for (const status of ['Unpaid', 'Overdue', 'Paid']) {
            const invoice = { id: 'invoice', status };
            await fixture.services.suspendCustomer('customer', invoice);
            await fixture.services.restoreCustomerProfile('customer', invoice);
            assert.equal(fixture.db.prepare('SELECT status FROM customers').get().status, customerStatus);
        }
        assert.equal(fixture.routerLookups(), 0);
    }
});

test('an active customer can still be suspended', async t => {
    const fixture = setup(t, 'Active');
    await fixture.services.suspendCustomer('customer', { status: 'Overdue' });
    assert.equal(fixture.db.prepare('SELECT status FROM customers').get().status, 'Suspended');
});

test('deactivation during suspension processing is preserved', async t => {
    const fixture = setup(t, 'Active', true);
    await fixture.services.suspendCustomer('customer', { status: 'Overdue' });
    assert.equal(fixture.db.prepare('SELECT status FROM customers').get().status, 'Inactive');
});
