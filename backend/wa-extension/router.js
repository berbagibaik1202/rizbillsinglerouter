import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { normalizePhone, permissionsFor, hashToken, newToken, fail, createCache, acsStatus } from './core.js';
import { recordCashMutation } from '../cashMutationService.js';
import { toMySQLDatetime } from '../utils.js';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fields = 'c.id, c.name, c.phone, c.status, c.pppoeUsername, c.acsSerialNumber, c.oltDeviceId, c.oltFrame, c.oltSlot, c.oltPort, c.oltOnuId, p.name AS packageName, p.speed AS packageSpeed, p.price AS packagePrice';
const from = 'FROM customers c LEFT JOIN packages p ON p.id = c.packageId';
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const invoiceStatus = (status, dueDate) => {
    if (String(status || '').toLowerCase() !== 'unpaid' || !dueDate) return status || 'UNKNOWN';
    const due = new Date(`${String(dueDate).slice(0, 10)}T23:59:59`);
    return Number.isFinite(due.getTime()) && due < new Date() ? 'OVERDUE' : 'UNPAID';
};

export function createWaExtensionRouter({ db, network, acs, env = process.env }) {
    const router = express.Router();
    const cache = createCache(3000);
    let cleanupAfter = 0;
    const need = permission => (req, res, next) => req.operator.permissions.includes(permission) ? next() : next(fail(403, 'Permission tidak mencukupi.'));
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    async function operator(user) {
        const [grants] = await db.query('SELECT permission, allowed FROM extension_permissions WHERE user_id = ?', [user.id]);
        return { id: user.id, username: user.username, role: user.role, permissions: permissionsFor(user, grants) };
    }

    async function limit(key, max, seconds) {
        if (Date.now() >= cleanupAfter) {
            cleanupAfter = Date.now() + 60000;
            await db.query('DELETE FROM extension_rate_limits WHERE expires_at <= UTC_TIMESTAMP()');
        }
        // Fixed windows use a unique key; atomic updates also work across backend processes.
        const bucket = hashToken(`${key}:${Math.floor(Date.now() / (seconds * 1000))}`);
        await db.query('INSERT INTO extension_rate_limits (bucket_key, hits, expires_at) VALUES (?, 1, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)) ON DUPLICATE KEY UPDATE hits = hits + 1', [bucket, seconds]);
        const [[row]] = await db.query('SELECT hits FROM extension_rate_limits WHERE bucket_key = ?', [bucket]);
        if (row.hits > max) throw fail(429, 'Terlalu banyak permintaan. Tunggu sebelum mencoba lagi.');
    }

    async function issue(userId, sessionId = randomUUID(), refreshHash = null) {
        const accessToken = newToken();
        const refreshToken = newToken();
        if (refreshHash) {
            const [result] = await db.query('UPDATE extension_sessions SET access_hash = ?, refresh_hash = ?, access_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE) WHERE id = ? AND refresh_hash = ? AND expires_at > UTC_TIMESTAMP()', [hashToken(accessToken), hashToken(refreshToken), sessionId, refreshHash]);
            if (result.affectedRows !== 1) throw fail(401, 'Sesi berakhir. Login kembali.');
        } else {
            await db.query('INSERT INTO extension_sessions (id, user_id, access_hash, refresh_hash, access_expires_at, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))', [sessionId, userId, hashToken(accessToken), hashToken(refreshToken)]);
        }
        return { accessToken, refreshToken, expiresIn: 900 };
    }

    router.post('/auth/login', wrap(async (req, res) => {
        await limit(`login:${req.ip}`, 10, 60);
        const { username, password } = req.body;
        if (typeof username !== 'string' || !username.trim() || username.length > 255 || typeof password !== 'string' || !password || password.length > 256) throw fail(400, 'Isi username dan password.');
        const [[user]] = await db.query('SELECT id, username, password, role FROM users WHERE username = ?', [username.trim()]);
        if (!user || !await bcrypt.compare(password, user.password)) throw fail(401, 'Username atau password salah.');
        const who = await operator(user);
        if (!who.permissions.includes('view')) throw fail(403, 'Akun belum diberi akses WA NOC.');
        await db.query('DELETE FROM extension_sessions WHERE expires_at <= UTC_TIMESTAMP()');
        await db.query('DELETE FROM extension_rate_limits WHERE expires_at <= UTC_TIMESTAMP()');
        res.json({ ...await issue(user.id), user: who });
    }));

    router.post('/auth/refresh', wrap(async (req, res) => {
        await limit(`refresh:${req.ip}`, 30, 60);
        if (!/^[a-f0-9]{64}$/.test(req.body.refreshToken || '')) throw fail(401, 'Sesi tidak valid.');
        const refreshHash = hashToken(req.body.refreshToken);
        const [[session]] = await db.query('SELECT s.id AS session_id, u.id, u.username, u.role FROM extension_sessions s JOIN users u ON u.id = s.user_id WHERE s.refresh_hash = ? AND s.expires_at > UTC_TIMESTAMP()', [refreshHash]);
        if (!session) throw fail(401, 'Sesi berakhir. Login kembali.');
        const who = await operator(session);
        if (!who.permissions.includes('view')) throw fail(403, 'Akses WA NOC dicabut.');
        res.json({ ...await issue(session.id, session.session_id, refreshHash), user: who });
    }));

    router.use(wrap(async (req, _res, next) => {
        const token = req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (!token) throw fail(401, 'Login extension diperlukan.');
        const [[session]] = await db.query('SELECT s.id AS session_id, u.id, u.username, u.role FROM extension_sessions s JOIN users u ON u.id = s.user_id WHERE s.access_hash = ? AND s.access_expires_at > UTC_TIMESTAMP() AND s.expires_at > UTC_TIMESTAMP()', [hashToken(token)]);
        if (!session) throw fail(401, 'Sesi berakhir. Login kembali.');
        req.operator = await operator(session);
        req.extensionSession = session.session_id;
        next();
    }));

    router.post('/auth/logout', wrap(async (req, res) => {
        await db.query('DELETE FROM extension_sessions WHERE id = ?', [req.extensionSession]);
        res.json({ success: true });
    }));
    router.get('/auth/me', (req, res) => res.json(req.operator));
    router.use(need('view'));
    router.use((req, _res, next) => { limit(`read:${req.operator.id}`, 240, 60).then(() => next(), next); });

    router.get('/customer/by-phone/:phone', wrap(async (req, res) => {
        const phone = normalizePhone(req.params.phone);
        if (!phone) throw fail(400, 'Nomor WhatsApp tidak valid.');
        // Existing phone strings are normalized in JS to also support older punctuation.
        const [phones] = await db.query('SELECT id, phone FROM customers WHERE phone IS NOT NULL');
        const ids = new Set(phones.filter(row => normalizePhone(row.phone) === phone).map(row => row.id));
        const [links] = await db.query('SELECT customer_id FROM customer_whatsapp_links WHERE phone_number = ?', [phone]);
        links.forEach(row => ids.add(row.customer_id));
        if (!ids.size) throw fail(404, 'Pelanggan tidak ditemukan. Cari pelanggan secara manual.');
        if (ids.size > 1) throw fail(409, 'Nomor terhubung ke beberapa pelanggan. Pilih secara manual.');
        res.json(await customer([...ids][0]));
    }));

    router.get('/customers', wrap(async (req, res) => {
        const query = String(req.query.q || '').trim();
        if (query.length < 2 || query.length > 100) throw fail(400, 'Pencarian minimal 2, maksimal 100 karakter.');
        const term = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
        const [rows] = await db.query(`SELECT ${fields} ${from} WHERE c.name LIKE ? OR c.id LIKE ? OR c.phone LIKE ? OR c.pppoeUsername LIKE ? OR c.acsSerialNumber LIKE ? LIMIT 25`, Array(5).fill(term));
        res.json(rows);
    }));

    async function customer(id) {
        const [[row]] = await db.query(`SELECT ${fields} ${from} WHERE c.id = ?`, [id]);
        if (!row) throw fail(404, 'Pelanggan tidak ditemukan.');
        return row;
    }
    router.param('id', (req, _res, next, id) => { customer(id).then(row => { req.customer = row; next(); }, next); });
    router.get('/customer/:id/overview', (req, res) => res.json({ customer: req.customer }));
    router.get('/customer/:id/billing', wrap(async (req, res) => {
        const [invoices] = await db.query(
            'SELECT i.id, i.dueDate, i.amount, i.status, i.billingPeriodStart, i.billingPeriodEnd FROM invoices i WHERE i.customerId = ? ORDER BY i.dueDate DESC LIMIT 12',
            [req.customer.id],
        );
        res.json({
            package: { name: req.customer.packageName, speed: req.customer.packageSpeed, price: req.customer.packagePrice },
            customerStatus: req.customer.status,
            invoices: invoices.map(invoice => ({ ...invoice, status: invoiceStatus(invoice.status, invoice.dueDate) })),
        });
    }));

    router.post('/customer/:id/link', need('map'), wrap(async (req, res) => {
        const phone = normalizePhone(req.body.phone);
        if (!phone || req.body.confirm !== true) throw fail(400, 'Nomor dan konfirmasi diperlukan.');
        const [phones] = await db.query('SELECT id, phone FROM customers WHERE phone IS NOT NULL');
        if (phones.some(row => row.id !== req.customer.id && normalizePhone(row.phone) === phone)) throw fail(409, 'Nomor sudah dipakai pelanggan lain.');
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('INSERT INTO customer_whatsapp_links (phone_number, customer_id, verified_by) VALUES (?, ?, ?)', [phone, req.customer.id, req.operator.id]);
            await audit(req, 'MAP_CUSTOMER', 'SUCCESS', conn);
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            if (error.code === 'ER_DUP_ENTRY') throw fail(409, 'Nomor sudah memiliki mapping.');
            throw error;
        } finally { conn.release(); }
        res.json({ success: true });
    }));

    async function provider(req, res, kind, work, ttlKey = '') {
        try {
            const data = await cache(`${kind}:${req.customer.id}:${ttlKey}`, work);
            res.json({ ...data, source: kind });
        } catch {
            res.json({ status: 'UNAVAILABLE', source: kind, message: `${kind} tidak dapat dihubungi.`, sampledAt: new Date().toISOString() });
        }
    }
    for (const [path, traffic] of [['network', false], ['traffic', true]]) {
        router.get(`/customer/:id/${path}`, wrap(async (req, res) => {
            if (!req.customer.pppoeUsername) return res.json({ status: 'UNLINKED' });
            await provider(req, res, path, async () => ({ ...await network.getNocSnapshot(req.customer.pppoeUsername, traffic), sampledAt: new Date().toISOString() }));
        }));
    }
    for (const path of ['acs', 'wifi']) router.get(`/customer/:id/${path}`, wrap(async (req, res) => {
        if (!req.customer.acsSerialNumber) return res.json({ status: 'UNLINKED' });
        await provider(req, res, 'ACS', async () => {
            const data = await acs.read(req.customer.acsSerialNumber);
            return { ...data, status: acsStatus(data.lastInform, Date.now(), positive(env.WA_NOC_ACS_ONLINE_MINUTES, 10), positive(env.WA_NOC_ACS_STALE_MINUTES, 30)), sampledAt: new Date().toISOString() };
        });
    }));
    router.get('/customer/:id/olt', wrap(async (req, res) => {
        const { oltDeviceId, oltFrame, oltSlot, oltPort, oltOnuId } = req.customer;
        if (!oltDeviceId || [oltFrame, oltSlot, oltPort, oltOnuId].some(value => !Number.isInteger(Number(value)))) {
            return res.json({ status: 'UNLINKED' });
        }
        await provider(req, res, 'OLT', async () => {
            const [[onu]] = await db.query(
                'SELECT status, power_rx AS powerRx, serial, updated_at AS updatedAt FROM olt_ont_cache WHERE device_id = ? AND frame = ? AND slot = ? AND port = ? AND onu_id = ?',
                [oltDeviceId, oltFrame, oltSlot, oltPort, oltOnuId],
            );
            if (!onu) throw new Error('ONU belum tersedia di cache OLT.');
            return {
                ...onu,
                status: String(onu.status || 'UNKNOWN').toUpperCase(),
                deviceId: oltDeviceId,
                frame: oltFrame,
                slot: oltSlot,
                port: oltPort,
                onuId: oltOnuId,
                sampledAt: onu.updatedAt || new Date().toISOString(),
            };
        });
    }));

    async function audit(req, action, result, target = db, id = randomUUID()) {
        await target.query('INSERT INTO extension_audit_logs (id, user_id, customer_id, action, device, ip_address, result) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.operator.id, req.customer.id, action, req.customer.acsSerialNumber, req.ip, result]);
        return id;
    }
    for (const action of ['ping', 'reboot']) router.post(`/customer/:id/${action}`, need(action), wrap(async (req, res) => {
        if (action === 'reboot' && req.body.confirm !== true) throw fail(400, 'Konfirmasi restart diperlukan.');
        if (action === 'ping' && !req.customer.pppoeUsername) throw fail(409, 'PPPoE belum terhubung.');
        if (action === 'reboot' && !req.customer.acsSerialNumber) throw fail(409, 'ONU belum terhubung.');
        await limit(`${action}:${action === 'reboot' ? req.customer.id : req.operator.id}`, positive(env[action === 'reboot' ? 'WA_NOC_REBOOT_LIMIT' : 'WA_NOC_PING_LIMIT'], action === 'reboot' ? 3 : 10), action === 'reboot' ? 600 : 60);
        // Persist intent before dispatch. An audit failure prevents device actions.
        const auditId = await audit(req, action.toUpperCase(), 'PENDING');
        let data;
        try {
            data = action === 'ping' ? await network.pingNocCustomer(req.customer.pppoeUsername) : await acs.reboot(req.customer.acsSerialNumber);
        } catch {
            await db.query('UPDATE extension_audit_logs SET result = ? WHERE id = ?', ['UNKNOWN', auditId]);
            throw fail(502, action === 'reboot' ? 'Hasil restart belum diketahui. Periksa history/perangkat sebelum mengulang.' : 'Ping gagal. Periksa status koneksi pelanggan.');
        }
        try {
            await db.query('UPDATE extension_audit_logs SET result = ? WHERE id = ?', [action === 'reboot' ? 'QUEUED' : 'SUCCESS', auditId]);
        } catch {
            throw fail(502, 'Tindakan telah dikirim tetapi hasil audit belum tersimpan. Periksa perangkat sebelum mengulang.');
        }
        res.json({ ...data, auditId });
    }));
    router.post('/customer/:id/wifi', need('wifi_write'), wrap(async (req, res) => {
        if (req.body.confirm !== true) throw fail(400, 'Konfirmasi perubahan WiFi diperlukan.');
        const ssid = typeof req.body.ssid === 'string' ? req.body.ssid.trim() : '';
        const key = typeof req.body.key === 'string' ? req.body.key : '';
        const band = String(req.body.band || '');
        if ((!ssid && !key) || ssid.length > 32 || (key && key.length < 8)) {
            throw fail(400, 'SSID maksimal 32 karakter dan password WiFi minimal 8 karakter.');
        }
        if (!['2.4', '5'].includes(band)) throw fail(400, 'Pilih WiFi 2.4 GHz atau 5 GHz.');
        if (!req.customer.acsSerialNumber) throw fail(409, 'ONU belum terhubung ke ACS.');
        await limit(`wifi:${req.customer.id}`, positive(env.WA_NOC_WIFI_LIMIT, 3), 3600);
        const auditId = await audit(req, 'WIFI_UPDATE', 'PENDING');
        try {
            const result = await acs.updateWifi(req.customer.id, { band, ...(ssid ? { ssid } : {}), ...(key ? { key } : {}) });
            await db.query('UPDATE extension_audit_logs SET result = ? WHERE id = ?', ['QUEUED', auditId]);
            res.json({ status: 'QUEUED', message: 'Perubahan WiFi dikirim ke ACS. Tunggu perangkat melapor kembali.', taskId: result.taskId || null, auditId });
        } catch {
            await db.query('UPDATE extension_audit_logs SET result = ? WHERE id = ?', ['UNKNOWN', auditId]);
            throw fail(502, 'Hasil perubahan WiFi belum diketahui. Periksa perangkat sebelum mencoba lagi.');
        }
    }));
    router.post('/customer/:id/invoice/:invoiceId/pay', need('billing_write'), wrap(async (req, res) => {
        if (req.body.confirm !== true) throw fail(400, 'Konfirmasi pembayaran diperlukan.');
        const method = String(req.body.method || '');
        if (!['Cash', 'Transfer'].includes(method)) throw fail(400, 'Metode pembayaran harus Cash atau Transfer.');
        const [[invoice]] = await db.query('SELECT id, customerId, amount, status, dueDate FROM invoices WHERE id = ? AND customerId = ?', [req.params.invoiceId, req.customer.id]);
        if (!invoice) throw fail(404, 'Tagihan pelanggan tidak ditemukan.');
        if (!['Unpaid', 'Overdue'].includes(invoice.status)) throw fail(409, 'Tagihan ini sudah tidak dapat ditandai lunas.');
        await limit(`payment:${req.customer.id}`, positive(env.WA_NOC_PAYMENT_LIMIT, 10), 3600);
        const auditId = await audit(req, 'MARK_INVOICE_PAID', 'PENDING');
        const payment = { id: `PAY-${Date.now()}-${invoice.id.slice(-4)}`, invoiceId: invoice.id, customerId: invoice.customerId, date: toMySQLDatetime(new Date()), amount: invoice.amount, method };
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [result] = await connection.query('UPDATE invoices SET status = ? WHERE id = ? AND customerId = ? AND status IN (?, ?)', ['Paid', invoice.id, req.customer.id, 'Unpaid', 'Overdue']);
            if (result.affectedRows !== 1) throw fail(409, 'Tagihan sudah berubah. Muat ulang data billing.');
            await connection.query('INSERT INTO payments SET ?', payment);
            await recordCashMutation(connection, { date: payment.date, direction: 'in', category: 'invoice_payment', amount: payment.amount, method, description: `Pembayaran invoice ${invoice.id}`, reference_type: 'payment', reference_id: payment.id, customer_id: invoice.customerId, created_by: req.operator.id, source: 'system' });
            await connection.query('UPDATE extension_audit_logs SET result = ? WHERE id = ?', ['SUCCESS', auditId]);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            await db.query('UPDATE extension_audit_logs SET result = ? WHERE id = ?', ['FAILED', auditId]);
            throw error;
        } finally { connection.release(); }
        res.json({ status: 'PAID', invoiceId: invoice.id, method, auditId, message: `Tagihan ditandai lunas melalui ${method}.` });
    }));
    router.get('/customer/:id/history', need('history'), wrap(async (req, res) => {
        const [rows] = await db.query('SELECT id, action, result, created_at FROM extension_audit_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50', [req.customer.id]);
        res.json(rows);
    }));
    router.use((_req, res) => res.status(404).json({ message: 'Endpoint WA NOC tidak ditemukan.' }));
    router.use((error, _req, res, _next) => {
        if (error.status === 429) res.set('Retry-After', '60');
        if (!error.status) console.error('[WA NOC]', error.code || error.name);
        res.status(error.status || 500).json({ message: error.status ? error.message : 'Layanan WA NOC belum tersedia. Periksa migrasi dan konfigurasi backend.' });
    });
    return router;
}
