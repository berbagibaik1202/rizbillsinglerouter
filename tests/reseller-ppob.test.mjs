import test from 'node:test';
import assert from 'node:assert/strict';
import { createResellerPpobService, ppobOwnerColumn } from '../backend/services/resellerPpob.js';

function fixture({ balance = 100000, type = 'prepaid', response = 'SUCCESS', timeout = false } = {}) {
    let state = { balance, transactions: [], inquiries: [] };
    let tail = Promise.resolve();
    const calls = [];
    const product = { product_code: 'SKU', selling_price: 12000, product_type: type };
    const query = async (sql, args = []) => {
        const q = sql.replace(/\s+/g, ' ');
        if (q.startsWith('SELECT * FROM ppob_products')) return [[product]];
        if (q.startsWith('SELECT balance FROM users')) return [[{ balance: state.balance }]];
        if (q.startsWith('SELECT * FROM reseller_ppob_inquiries')) return [[state.inquiries.find(i =>
            i.ref_id === args[0] && i.reseller_id === args[1] && i.product_code === args[2] && i.customer_no === args[3] && !i.consumed && !i.expired)]];
        if (q.startsWith('INSERT INTO reseller_ppob_inquiries')) {
            const [ref_id, reseller_id, product_code, customer_no, amount] = args;
            state.inquiries.push({ ref_id, reseller_id, product_code, customer_no, amount, consumed: false }); return [{}];
        }
        if (q.startsWith('UPDATE reseller_ppob_inquiries')) { state.inquiries.find(i => i.ref_id === args[0]).consumed = true; return [{}]; }
        if (q.startsWith('SELECT transaction_ref_id FROM ppob_transactions')) return [[state.transactions.find(t => t.reseller_id === args[0] && t.product_code === args[1] && t.customer_no === args[2] && t.status === 'PENDING')]];
        if (q.startsWith('SELECT * FROM ppob_transactions')) return [[state.transactions.find(t => t.transaction_ref_id === args[0])]];
        if (q.startsWith('UPDATE users SET balance')) { state.balance += Number(args[0]) * (q.includes('balance -') ? -1 : 1); return [{ affectedRows: 1 }]; }
        if (q.startsWith('INSERT INTO ppob_transactions')) {
            const [transaction_ref_id, reseller_id, product_code, customer_no, selling_price, message] = args;
            state.transactions.push({ transaction_ref_id, reseller_id, customer_id: null, product_code, customer_no, selling_price, message, status: 'PENDING' }); return [{}];
        }
        if (q.startsWith('UPDATE ppob_transactions SET status')) {
            Object.assign(state.transactions.find(t => t.transaction_ref_id === args[3]), { status: args[0], message: args[1], sn: args[2] }); return [{}];
        }
        throw new Error(`Unexpected query: ${q}`);
    };
    const db = { query, async getConnection() {
        let release, snapshot;
        const finish = () => { if (release) { release(); release = null; } };
        return {
            query,
            async beginTransaction() {
                const previous = tail;
                tail = new Promise(resolve => { release = resolve; });
                await previous;
                snapshot = structuredClone(state);
            },
            async commit() { finish(); },
            async rollback() { if (release) state = snapshot; finish(); },
            release() { finish(); },
        };
    } };
    const provider = { async createTransaction(...args) {
        assert.ok(state.transactions.find(t => t.transaction_ref_id === args[2]), 'debit is persisted before dispatch');
        calls.push(args);
        if (timeout) throw new Error('timeout');
        return { data: { status: response, sn: 'TOKEN', selling_price: 999 } };
    } };
    const service = createResellerPpobService({ db, provider, normalizeStatus: status => ['SUCCESS', 'FAILED'].includes(status) ? status : 'PENDING', isPostpaidType: value => value === 'postpaid' });
    return { service, calls, state: () => state };
}

const purchase = { product_code: 'SKU', customer_no: '08123456789', selling_price: 1, customer_id: 'someone-else', reseller_id: 'other' };

test('reseller prepaid purchase uses server price, own balance, and separate ownership', async () => {
    const f = fixture();
    const result = await f.service.purchase('R1', purchase);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(f.state().balance, 88000);
    assert.equal(f.state().transactions[0].reseller_id, 'R1');
    assert.equal(f.state().transactions[0].customer_id, null);
    assert.equal(f.state().transactions[0].selling_price, 12000);
    assert.equal(f.calls.length, 1);
});

test('insufficient balance never dispatches or creates a debit', async () => {
    const f = fixture({ balance: 100 });
    await assert.rejects(f.service.purchase('R1', purchase), { status: 400 });
    assert.equal(f.state().balance, 100);
    assert.equal(f.state().transactions.length, 0);
    assert.equal(f.calls.length, 0);
});

test('provider timeout retains pending debit and prevents duplicate pending purchases', async () => {
    const f = fixture({ timeout: true });
    const result = await f.service.purchase('R1', purchase);
    assert.equal(result.status, 'PENDING');
    assert.equal(f.state().balance, 88000);
    await assert.rejects(f.service.purchase('R1', purchase), { status: 409 });
    assert.equal(f.calls.length, 1);
});

test('concurrent failure notifications refund exactly the amount reserved, only once', async () => {
    const f = fixture({ response: 'PENDING' });
    const result = await f.service.purchase('R1', purchase);
    await Promise.all([1, 2, 3].map(() => f.service.applyResult(result.transaction_ref_id, { status: 'FAILED', selling_price: 1 })));
    assert.equal(f.state().balance, 100000);
    assert.equal(f.state().transactions[0].status, 'FAILED');
    await f.service.applyResult(result.transaction_ref_id, { status: 'PENDING' });
    await f.service.applyResult(result.transaction_ref_id, { status: 'FAILED' });
    assert.equal(f.state().balance, 100000);
});

test('immediate provider failure refunds and success cannot be refunded by a late failure', async () => {
    const failed = fixture({ response: 'FAILED' });
    assert.equal((await failed.service.purchase('R1', purchase)).success, false);
    assert.equal(failed.state().balance, 100000);
    const success = fixture();
    const result = await success.service.purchase('R1', purchase);
    await success.service.applyResult(result.transaction_ref_id, { status: 'FAILED' });
    assert.equal(success.state().balance, 88000);
    assert.equal(success.state().transactions[0].status, 'SUCCESS');
});

test('postpaid uses saved server inquiry amount and provider reference, then rejects reuse', async () => {
    const f = fixture({ type: 'postpaid' });
    await f.service.saveInquiry('R1', 'SKU', purchase.customer_no, { ref_id: 'INQ1', status: 'SUCCESS' }, 25000);
    const result = await f.service.purchase('R1', { ...purchase, bill_ref_id: 'INQ1', bill_total_charge: 1 });
    assert.equal(result.transaction_ref_id, 'INQ1');
    assert.equal(f.state().balance, 75000);
    assert.deepEqual(f.calls[0], ['SKU', purchase.customer_no, 'INQ1', 'pay-pasca']);
    await assert.rejects(f.service.purchase('R1', { ...purchase, bill_ref_id: 'INQ1' }), { status: 400 });
    assert.equal(f.calls.length, 1);
});

test('postpaid rejects another owner, changed destination, expired or incomplete inquiries', async () => {
    const f = fixture({ type: 'postpaid' });
    await f.service.saveInquiry('R2', 'SKU', purchase.customer_no, { ref_id: 'OTHER', status: 'SUCCESS' }, 25000);
    await assert.rejects(f.service.purchase('R1', { ...purchase, bill_ref_id: 'OTHER' }), { status: 400 });
    await f.service.saveInquiry('R1', 'SKU', purchase.customer_no, { ref_id: 'OWN', status: 'SUCCESS' }, 25000);
    await assert.rejects(f.service.purchase('R1', { ...purchase, customer_no: 'DIFFERENT', bill_ref_id: 'OWN' }), { status: 400 });
    f.state().inquiries.find(i => i.ref_id === 'OWN').expired = true;
    await assert.rejects(f.service.purchase('R1', { ...purchase, bill_ref_id: 'OWN' }), { status: 400 });
    await assert.rejects(f.service.saveInquiry('R1', 'SKU', purchase.customer_no, { ref_id: 'BAD', status: 'PENDING' }, 25000), { status: 400 });
    assert.equal(f.state().balance, 100000);
    assert.equal(f.calls.length, 0);
});

test('simultaneous purchases cannot overdraw a reseller balance', async () => {
    const f = fixture({ balance: 15000 });
    const results = await Promise.allSettled([f.service.purchase('R1', purchase), f.service.purchase('R1', { ...purchase, customer_no: '0899999999' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.state().balance, 3000);
    assert.equal(f.calls.length, 1);
});

test('customer and reseller ownership columns cannot be selected from request body', () => {
    assert.equal(ppobOwnerColumn('customer'), 'customer_id');
    assert.equal(ppobOwnerColumn('reseller'), 'reseller_id');
    assert.throws(() => ppobOwnerColumn('technician'), { status: 403 });
});
