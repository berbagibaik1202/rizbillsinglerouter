import { randomUUID } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
export const ppobOwnerColumn = role => {
    if (role === 'reseller') return 'reseller_id';
    if (role === 'customer') return 'customer_id';
    throw fail(403, 'Akses transaksi PPOB tidak diizinkan.');
};

export function createResellerPpobService({ db, provider, normalizeStatus, isPostpaidType }) {
    async function applyResult(refId, data) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [[tx]] = await connection.query('SELECT * FROM ppob_transactions WHERE transaction_ref_id = ? FOR UPDATE', [refId]);
            if (!tx?.reseller_id) throw fail(404, 'Transaksi reseller tidak ditemukan.');
            // A terminal transaction cannot be refunded twice or charged again by a late callback.
            if (tx.status !== 'PENDING') {
                await connection.commit();
                return tx;
            }
            const status = normalizeStatus(data.status, data.rc || data.code);
            const message = JSON.stringify({ text: data.message || 'Transaksi diproses.', ...data });
            if (status === 'FAILED') {
                await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [tx.selling_price, tx.reseller_id]);
            }
            await connection.query('UPDATE ppob_transactions SET status = ?, message = ?, sn = ? WHERE transaction_ref_id = ?', [status, message, data.sn || null, refId]);
            await connection.commit();
            return { ...tx, status, message, sn: data.sn || null };
        } catch (error) { await connection.rollback(); throw error; }
        finally { connection.release(); }
    }

    async function saveInquiry(resellerId, productCode, customerNo, data, total) {
        const refId = data.ref_id || data.refid;
        if (!refId || !Number.isFinite(Number(total)) || Number(total) <= 0 || normalizeStatus(data.status, data.rc) !== 'SUCCESS') {
            throw fail(400, 'Tagihan belum siap dibayar. Silakan cek tagihan kembali.');
        }
        await db.query(`INSERT INTO reseller_ppob_inquiries (ref_id, reseller_id, product_code, customer_no, amount)
            VALUES (?, ?, ?, ?, ?)`, [refId, resellerId, productCode, customerNo, total]);
    }

    async function purchase(resellerId, body) {
        const { product_code, customer_no, bill_ref_id } = body;
        if (typeof product_code !== 'string' || !product_code || typeof customer_no !== 'string' || !customer_no.trim() || customer_no.length > 100) {
            throw fail(400, 'Produk dan nomor tujuan wajib diisi.');
        }
        const connection = await db.getConnection();
        let refId, postpaid;
        try {
            await connection.beginTransaction();
            const [[product]] = await connection.query('SELECT * FROM ppob_products WHERE product_code = ? AND is_active = TRUE', [product_code]);
            if (!product) throw fail(404, 'Produk tidak ditemukan atau sedang tidak aktif.');
            const [[reseller]] = await connection.query("SELECT balance FROM users WHERE id = ? AND role = 'reseller' FOR UPDATE", [resellerId]);
            if (!reseller) throw fail(403, 'Akun reseller tidak ditemukan.');
            postpaid = isPostpaidType(product.product_type || product.category || '');
            let price = Number(product.selling_price);
            refId = `RPPOB-${randomUUID()}`;
            if (postpaid) {
                const [[inquiry]] = await connection.query(`SELECT * FROM reseller_ppob_inquiries
                    WHERE ref_id = ? AND reseller_id = ? AND product_code = ? AND customer_no = ?
                    AND consumed = 0 AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) FOR UPDATE`,
                [bill_ref_id || '', resellerId, product_code, customer_no]);
                if (!inquiry) throw fail(400, 'Cek tagihan kembali. Tagihan kedaluwarsa atau sudah digunakan.');
                price = Number(inquiry.amount);
                refId = inquiry.ref_id;
                await connection.query('UPDATE reseller_ppob_inquiries SET consumed = 1 WHERE ref_id = ?', [refId]);
            }
            if (!Number.isFinite(price) || price <= 0) throw fail(400, 'Harga produk tidak valid.');
            if (Number(reseller.balance) < price) throw fail(400, 'Saldo reseller tidak cukup. Silakan isi saldo.');
            // Serialize purchases with voucher sales using the same users row lock.
            const [[pending]] = await connection.query("SELECT transaction_ref_id FROM ppob_transactions WHERE reseller_id = ? AND product_code = ? AND customer_no = ? AND status = 'PENDING' LIMIT 1", [resellerId, product_code, customer_no]);
            if (pending) throw fail(409, 'Transaksi untuk tujuan ini masih diproses. Periksa riwayat terlebih dahulu.');
            await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [price, resellerId]);
            await connection.query(`INSERT INTO ppob_transactions
                (transaction_ref_id, reseller_id, customer_id, product_code, customer_no, status, selling_price, message)
                VALUES (?, ?, NULL, ?, ?, 'PENDING', ?, ?)`, [refId, resellerId, product_code, customer_no, price, 'Menunggu konfirmasi provider.']);
            // Persist debit before contacting the provider so a timeout cannot create a free purchase.
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
        finally { connection.release(); }

        try {
            const result = await provider.createTransaction(product_code, customer_no, refId, postpaid ? 'pay-pasca' : undefined);
            const data = result?.data || {};
            const tx = await applyResult(refId, data);
            return { success: tx.status !== 'FAILED', status: tx.status, transaction_ref_id: refId, message: tx.status === 'FAILED' ? 'Transaksi gagal. Saldo telah dikembalikan.' : 'Transaksi diproses. Periksa riwayat untuk status terbaru.', data };
        } catch {
            // Keep the reserved balance until a callback or refresh confirms the result.
            return { success: true, status: 'PENDING', transaction_ref_id: refId, message: 'Menunggu konfirmasi provider. Jangan ulangi pembelian; periksa status di riwayat.', data: { status: 'Pending', ref_id: refId } };
        }
    }
    return { purchase, applyResult, saveInquiry };
}
