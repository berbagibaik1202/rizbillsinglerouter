import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { insertInvoiceForNonInactiveCustomer } from '../backend/invoiceGeneration.js';

test('invoice generation checks the current customer status before inserting', async t => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec(`
        CREATE TABLE customers (id TEXT PRIMARY KEY, status TEXT);
        CREATE TABLE invoices (
            id TEXT PRIMARY KEY, customerId TEXT, amount INTEGER,
            billingPeriodStart TEXT, billingPeriodEnd TEXT, dueDate TEXT,
            notes TEXT, issueDate TEXT, status TEXT
        );
    `);
    const adapter = {
        query: async (sql, values) => [{ affectedRows: db.prepare(sql).run(...values).changes }],
    };
    const invoice = {
        id: 'invoice', customerId: 'customer', amount: 150000,
        billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-30',
        dueDate: '2026-10-10', notes: 'Monthly invoice',
        issueDate: '2026-10-01', status: 'Unpaid',
    };

    for (const status of ['Active', 'Suspended', 'Unregister', 'Inactive', 'inactive', ' INACTIVE ']) {
        db.exec('DELETE FROM invoices; DELETE FROM customers;');
        db.prepare('INSERT INTO customers VALUES (?, ?)').run(invoice.customerId, status);
        const inserted = await insertInvoiceForNonInactiveCustomer(adapter, invoice);
        const eligible = ['Active', 'Suspended', 'Unregister'].includes(status);
        assert.equal(inserted, eligible, status);
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM invoices').get().count, eligible ? 1 : 0, status);
        if (eligible) assert.deepEqual({ ...db.prepare('SELECT * FROM invoices').get() }, invoice);
    }

    db.exec('DELETE FROM invoices; DELETE FROM customers;');
    db.prepare('INSERT INTO customers VALUES (?, ?)').run(invoice.customerId, 'Active');
    // The invoice was prepared for an active customer, but the customer is
    // deactivated before the generation job persists it.
    db.prepare('UPDATE customers SET status = ? WHERE id = ?').run('Inactive', invoice.customerId);
    assert.equal(await insertInvoiceForNonInactiveCustomer(adapter, invoice), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM invoices').get().count, 0);

    db.exec('DELETE FROM customers;');
    assert.equal(await insertInvoiceForNonInactiveCustomer(adapter, invoice), false);
});
