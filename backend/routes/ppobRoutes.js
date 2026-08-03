import express from 'express';
import crypto from 'crypto';
import pool from '../db.js';
import * as digiflazzService from '../digiflazzService.js';
import { formatRupiah, getSettings } from '../utils.js';

const router = express.Router();
const parseNumericValue = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return 0;
    const normalized = value
        .replace(/[^\d,.-]/g, '')
        .replace(/\./g, '')
        .replace(/,/g, '.');
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};
const sumDescDetails = (detailArray = []) => {
    if (!Array.isArray(detailArray)) return { tagihan: 0, admin: 0, denda: 0, total: 0 };
    const summary = detailArray.reduce(
        (acc, item) => {
            const nilai = parseNumericValue(item.nilai_tagihan ?? item.nilai ?? 0);
            const admin = parseNumericValue(item.admin ?? 0);
            const denda = parseNumericValue(item.denda ?? 0);
            acc.tagihan += nilai;
            acc.admin += admin;
            acc.denda += denda;
            return acc;
        },
        { tagihan: 0, admin: 0, denda: 0, total: 0 }
    );
    summary.total = summary.tagihan + summary.admin + summary.denda;
    return summary;
};
const normalizeStatus = (rawStatus, rawCode = '') => {
    const up = String(rawStatus || '').trim().toUpperCase();
    const code = String(rawCode || '').trim().toUpperCase();

    const successTokens = ['SUCCESS', 'SUKSES', 'BERHASIL', 'SUCCEEDED', '00'];
    const failedTokens = ['FAILED', 'GAGAL', 'EXPIRED', 'CANCEL', 'CANCELLED', 'REVERSE', 'REVERSED', 'REFUND', 'REFUNDED', '01', '02', '68'];
    const pendingTokens = ['PENDING', 'PROCESS', 'PROCESSING', 'ON PROCESS', 'WAITING', 'IN PROGRESS', '03'];

    if (successTokens.includes(up) || successTokens.includes(code)) return 'SUCCESS';
    if (failedTokens.includes(up) || failedTokens.includes(code)) return 'FAILED';
    if (pendingTokens.includes(up) || pendingTokens.includes(code)) return 'PENDING';
    return 'PENDING';
};

const DIGIFLAZZ_RC_TITLES = {
    '00': 'Transaksi Sukses',
    '01': 'Timeout',
    '02': 'Transaksi Gagal',
    '03': 'Transaksi Pending',
    '40': 'Payload Error',
    '41': 'Signature tidak valid',
    '42': 'Gagal memproses API Buyer',
    '43': 'SKU tidak ditemukan atau Non-Aktif',
    '44': 'Saldo tidak cukup',
    '45': 'IP Anda tidak kami kenali',
    '47': 'Transaksi sudah terjadi di buyer lain',
    '49': 'Ref ID tidak unik',
    '50': 'Transaksi Tidak Ditemukan',
    '51': 'Nomor Tujuan Diblokir',
    '52': 'Prefix Tidak Sesuai Dengan Operator',
    '53': 'Produk Seller Sedang Tidak Tersedia',
    '54': 'Nomor Tujuan Salah',
    '55': 'Produk Sedang Gangguan',
    '56': 'Limit saldo seller',
    '57': 'Jumlah Digit Kurang Atau Lebih',
    '58': 'Sedang Cut Off',
    '59': 'Tujuan di Luar Wilayah/Cluster',
    '60': 'Tagihan belum tersedia atau sudah terbayar',
    '61': 'Belum pernah melakukan deposit',
    '62': 'Seller sedang mengalami gangguan',
    '63': 'Tidak support transaksi multi',
    '64': 'Tarik tiket gagal, coba nominal lain atau hubungi admin.',
    '65': 'Limit transaksi multi',
    '66': 'Cut Off (Perbaikan Sistem Seller)',
    '67': 'Seller belum ter-verfikasi',
    '68': 'Stok habis',
    '69': 'Harga seller lebih besar dari ketentuan harga Buyer',
    '70': 'Timeout Dari Biller',
    '71': 'Produk Sedang Tidak Stabil',
    '72': 'Lakukan Unreg Paket Dahulu',
    '73': 'Kwh Melebihi Batas',
    '74': 'Transaksi Refund',
    '80': 'Akun Anda telah diblokir oleh Seller',
    '81': 'Seller ini telah diblokir oleh Anda',
    '82': 'Akun Anda belum ter-verfikasi',
    '83': 'Limitasi pengecekan pricelist tercapai',
    '84': 'Nominal tidak valid',
    '85': 'Limitasi transaksi tercapai',
    '86': 'Limitasi pengecekan nomor PLN tercapai',
    '87': 'Transaksi E-money wajib kelipatan Rp 1.000',
    '99': 'DF Router Issue'
};

const isPostpaidType = (typeRaw) => {
    if (!typeRaw) return false;
    const normalized = String(typeRaw).toLowerCase().trim();
    if (!normalized) return false;
    const exactMatches = ['postpaid', 'post-paid', 'pasca', 'pascabayar', 'postpaid - pasca'];
    if (exactMatches.includes(normalized)) return true;
    if (normalized.includes('postpaid') || normalized.includes('pasca')) return true;
    if (normalized.includes('post') && normalized.includes('paid')) return true;
    return false;
};

const formatRcTag = (rcCode) => {
    if (!rcCode) return null;
    const normalized = String(rcCode).trim();
    const description = DIGIFLAZZ_RC_TITLES[normalized];
    return description ? `${normalized} (${description})` : normalized;
};

const extractRcInfoFromMessage = (message) => {
    if (!message || typeof message !== 'string') return { rc: null, rcDescription: null };
    const match = message.match(/RC:\s*([0-9]{2})(?:\s*\(([^)]+)\))?/i);
    if (!match) return { rc: null, rcDescription: null };
    const rc = match[1];
    const rcDescription = match[2] || DIGIFLAZZ_RC_TITLES[rc] || null;
    return { rc, rcDescription };
};

export const handleDigiflazzStatusUpdate = async (payload) => {
    const data = payload?.data || payload;
    const refId = data?.ref_id || data?.refid || data?.transaction_ref_id;
    const status = data?.status;
    if (!refId || !status) {
        throw new Error('Digiflazz payload missing ref_id or status.');
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [[tx]] = await connection.query(
            'SELECT * FROM ppob_transactions WHERE transaction_ref_id = ? FOR UPDATE',
            [refId]
        );
        if (!tx) {
            await connection.rollback();
            throw new Error(`Transaction ${refId} not found.`);
        }

        const normalized = normalizeStatus(status, data.rc || data.code);
        
        let existingDetails = {};
        try {
            existingDetails = JSON.parse(tx.message);
            if(typeof existingDetails !== 'object' || existingDetails === null) {
                 existingDetails = { text: tx.message };
            }
        } catch (e) {
            existingDetails = { text: tx.message };
        }

        const rcTag = formatRcTag(data.rc ?? data.code);
        const newText = data.message || existingDetails.text || 'Transaksi diperbarui oleh webhook.';

        const sn = data.sn || existingDetails.sn || null;
        const updatedDetails = {
            ...existingDetails,
            text: newText,
            status: data.status || existingDetails.status,
            rc: data.rc || existingDetails.rc,
            sn: sn,
            customer_name: data.customer_name || existingDetails.customer_name,
            periode: data.periode || existingDetails.periode,
            desc: data.desc || existingDetails.desc,
        };

        const updatedMessage = JSON.stringify(updatedDetails);

        const updateFields = ['status = ?', 'message = ?', 'sn = ?', 'updated_at = NOW()'];
        const updateParams = [normalized, updatedMessage, sn];

        const parsedSelling = parseNumericValue(data.selling_price ?? data.price ?? tx.selling_price ?? 0);

        if (parsedSelling > 0) {
            updateFields.push('selling_price = ?');
            updateParams.push(parsedSelling);
        }

        updateParams.push(refId);

        await connection.query(
            `UPDATE ppob_transactions SET ${updateFields.join(', ')} WHERE transaction_ref_id = ?`,
            updateParams
        );

        if (normalized === 'FAILED' && tx.status !== 'FAILED') {
            await connection.query(
                'UPDATE customers SET voucher_balance = voucher_balance + ? WHERE id = ?',
                [tx.selling_price, tx.customer_id]
            );
        }

        await connection.commit();
        return { refId, status: normalized, message: updatedMessage };
    } catch (error) {
        if (connection) await connection.rollback();
        throw error;
    } finally {
        if (connection) connection.release();
    }
};

const getDigiflazzCredentials = async () => {
    const settings = await getSettings();
    const digiflazz = settings.digiflazz || {};
    return {
        username: digiflazz.username || process.env.DIGIFLAZZ_USERNAME || '',
        apiKey: digiflazz.apiKey || process.env.DIGIFLAZZ_API_KEY || '',
    };
};

const isProductActiveFromProvider = (product) => {
    const candidates = [
        product.seller_product_status,
        product.buyer_product_status,
        product.product_status,
        product.status,
        product.is_active,
        product.active,
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        if (typeof candidate === 'boolean') return candidate;
        if (typeof candidate === 'number') return candidate !== 0;
        const normalized = String(candidate).trim().toLowerCase();
        if (!normalized) continue;
        if (['available', 'active', 'open', 'available for customer', 'ready', 'live'].includes(normalized)) return true;
        if (['1', 'true', 'yes', 'ok', 'ready', 'live'].includes(normalized)) return true;
        if (['close', 'closed', 'nonactive', 'non-active', 'inactive', 'off'].includes(normalized)) return false;
    }

    // Default to active to avoid disabling everything if provider sends an unknown token
    return true;
};

// Middleware sederhana untuk memeriksa peran admin
const isAdmin = (req, res, next) => {
    // Kita asumsikan middleware JWT global sudah mengisi req.user
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    res.status(403).json({ message: 'Forbidden: Access is restricted to administrators.' });
};

/**
 * [ADMIN] Menyinkronkan daftar produk dari Digiflazz ke tabel ppob_products.
 * Operasi ini menggunakan INSERT ... ON DUPLICATE KEY UPDATE agar aman dijalankan berkali-kali.
 */
router.post('/admin/sync', isAdmin, async (req, res) => {
    let connection;
    try {
        console.log('Starting Digiflazz product sync...');

        const fetchList = async (cmd) => {
            const data = await digiflazzService.getProductList(cmd);

            // Rate-limit atau error khusus Digiflazz (contoh rc 83)
            if (data && data.data && data.data.rc && !Array.isArray(data.data)) {
                const msg = data.data.message || 'Digiflazz error';
                throw new Error(`Digiflazz responded with rc=${data.data.rc}: ${msg}`);
            }

            if (!data || !Array.isArray(data.data)) {
                throw new Error(`Invalid product data structure from Digiflazz for cmd=${cmd}. Raw: ${JSON.stringify(data).slice(0,500)}`);
            }
            return data.data.map(p => ({ ...p, product_type: cmd === 'pasca' ? 'postpaid' : 'prepaid' }));
        };

        const prepaid = await fetchList('prepaid');
        let postpaid = [];
        try {
            postpaid = await fetchList('pasca');
        } catch (e) {
            console.warn('[PPOB Sync] Failed to fetch postpaid list:', e.message);
        }

        const products = [...prepaid, ...postpaid];
        console.log(`Received ${products.length} products from Digiflazz (prepaid: ${prepaid.length}, postpaid: ${postpaid.length}).`);

        if (products.length === 0) {
            return res.json({ message: 'Sync completed. No products found on Digiflazz to sync.' });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        let updatedCount = 0;
        let insertedCount = 0;
        let skippedCount = 0;
        let statusChangedCount = 0;

        for (const product of products) {
            const { buyer_sku_code, product_name, category, brand, price, desc, product_type } = product;

            if (!buyer_sku_code || !product_name) {
                skippedCount++;
                continue;
            }

            // Digiflazz postpaid kadang mengirim price null. Fallback ke fee/admin/0 agar tidak gagal NOT NULL.
            const rawPrice = price ?? product.selling_price ?? product.fee ?? product.admin ?? 0;
        const numericPrice = Number(rawPrice);
        if (!isFinite(numericPrice)) {
            skippedCount++;
            continue;
        }

        // Harga jual awal disamakan dengan harga modal. Admin bisa mengubahnya nanti.
        const sellingPrice = numericPrice;

        const isActive = isProductActiveFromProvider(product);

        const [result] = await connection.query(
            `INSERT INTO ppob_products (product_code, product_name, category, brand, price, selling_price, description, is_active, product_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                product_name = VALUES(product_name),
                category = VALUES(category),
                brand = VALUES(brand),
                price = VALUES(price),
                selling_price = VALUES(selling_price),
                description = VALUES(description),
                is_active = VALUES(is_active),
                product_type = VALUES(product_type)`,
            [buyer_sku_code, product_name, category, brand, numericPrice, sellingPrice, desc, isActive, product_type || 'prepaid']
        );

            if (result.affectedRows > 0) {
                // insertId > 0 berarti baris baru, jika tidak berarti update
                if (result.insertId > 0) {
                    insertedCount++;
                } else {
                    updatedCount++;
                }
            }

            if (result.affectedRows === 2 && !isActive) {
                statusChangedCount++;
            }
        }

        await connection.commit();
        console.log('Product sync completed.');
        res.json({ 
            message: 'Product sync with Digiflazz completed successfully.',
            inserted: insertedCount,
            updated: updatedCount,
            skipped: skippedCount,
            status_changed_to_inactive: statusChangedCount,
            total_from_digiflazz: products.length
        });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('PPOB Sync Error:', error);

            const msg = error.message || 'Unknown error';
            // Jika error berasal dari Digiflazz (misal rc=83 rate limit), kembalikan 429 supaya UI tahu untuk retry nanti
            if (msg.toLowerCase().includes('digiflazz')) {
                return res.status(429).json({ message: msg });
            }

            res.status(500).json({ message: `An error occurred during product sync: ${msg}` });
        } finally {
            if (connection) connection.release();
        }
    });

/**
 * [ADMIN] Mengambil semua produk dari database lokal (ppob_products).
 */
router.get('/admin/products', isAdmin, async (req, res) => {
    try {
        const [products] = await pool.query('SELECT * FROM ppob_products ORDER BY category, brand, price');
        res.json(products);
    } catch (error) {
        console.error('Error fetching PPOB products:', error);
        res.status(500).json({ message: 'Failed to fetch PPOB products.' });
    }
});

/**
 * [ADMIN] Ambil saldo Digiflazz admin.
 */
router.get('/admin/balance', isAdmin, async (req, res) => {
    try {
        const data = await digiflazzService.checkBalance();
        // Digiflazz balance response biasanya { data: { deposit, message, rc } } atau { deposit, message }
        const balance = data?.data?.deposit ?? data?.deposit ?? data?.data?.saldo ?? data?.saldo ?? null;
        res.json({ balance, raw: data });
    } catch (error) {
        console.error('Error fetching Digiflazz balance:', error.message || error);
        res.status(500).json({ message: error.message || 'Failed to fetch Digiflazz balance.' });
    }
});

/**
 * [ADMIN] Membuat tiket deposit ke Digiflazz.
 */
router.post('/admin/deposit', isAdmin, async (req, res) => {
    const { amount, bank, owner_name } = req.body;

    if (!amount || !bank || !owner_name) {
        return res.status(400).json({ message: 'Amount, bank, and owner_name are required.' });
    }

    try {
        const result = await digiflazzService.createDeposit(amount, bank, owner_name);
        res.json(result);
    } catch (error) {
        console.error('Error creating Digiflazz deposit ticket:', error);
        res.status(500).json({ message: error.message || 'Failed to create Digiflazz deposit ticket.' });
    }
});

/**
 * [ADMIN] Rekonsiliasi status transaksi PENDING dengan Digiflazz.
 * Opsional query ?limit=20 untuk batasi jumlah.
 */
router.post('/admin/reconcile', isAdmin, async (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const connection = await pool.getConnection();
    try {
        const [pending] = await connection.query('SELECT * FROM ppob_transactions WHERE status = ? ORDER BY created_at ASC LIMIT ?', ['PENDING', limit]);
        let successCount = 0, failedCount = 0, stillPending = 0;

        for (const tx of pending) {
            try {
                const result = await digiflazzService.checkStatus(tx.transaction_ref_id);
                const data = result?.data || {};
                const newStatus = normalizeStatus(data.status);
                const newMessage = data.message || tx.message || '';

                if (newStatus !== 'PENDING') {
                    await connection.query(
                        'UPDATE ppob_transactions SET status = ?, message = ?, updated_at = NOW() WHERE transaction_ref_id = ?',
                        [newStatus, newMessage, tx.transaction_ref_id]
                    );
                    if (newStatus === 'FAILED') {
                        await connection.query('UPDATE customers SET voucher_balance = voucher_balance + ? WHERE id = ?', [tx.selling_price, tx.customer_id]);
                        failedCount++;
                    } else {
                        successCount++;
                    }
                } else {
                    stillPending++;
                }
            } catch (err) {
                // Skip individual errors, continue others
                console.warn('[PPOB Reconcile] Failed to check status for', tx.transaction_ref_id, err.message);
            }
        }

        res.json({ success: true, reconciled: pending.length, successCount, failedCount, stillPending });
    } catch (error) {
        console.error('[PPOB Reconcile] Error:', error);
        res.status(500).json({ message: error.message || 'Failed to reconcile transactions.' });
    } finally {
        connection.release();
    }
});

/**
 * [ADMIN] Mengubah harga jual atau status aktif sebuah produk.
 */
router.put('/admin/products/:product_code', isAdmin, async (req, res) => {
    const { product_code } = req.params;
    const { selling_price, is_active } = req.body;

    if (selling_price === undefined && is_active === undefined) {
        return res.status(400).json({ message: 'Provide selling_price and/or is_active.' });
    }

    try {
        const fieldsToUpdate = {};
        if (selling_price !== undefined) fieldsToUpdate.selling_price = selling_price;
        if (is_active !== undefined) fieldsToUpdate.is_active = is_active;

        const [result] = await pool.query('UPDATE ppob_products SET ? WHERE product_code = ?', [fieldsToUpdate, product_code]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: `Product with code '${product_code}' not found.` });
        }

        res.json({ success: true, message: 'Product updated successfully.' });
    } catch (error) {
        console.error(`Error updating product ${product_code}:`, error);
        res.status(500).json({ message: `Failed to update product: ${error.message}` });
    }
});

/**
 * [ADMIN] Bulk delete PPOB products.
 */
router.post('/admin/products/bulk-delete', isAdmin, async (req, res) => {
    const { product_codes } = req.body || {};
    if (!Array.isArray(product_codes) || product_codes.length === 0) {
        return res.status(400).json({ message: 'product_codes array is required.' });
    }

    const codes = product_codes.map(code => String(code).trim()).filter(Boolean);
    if (codes.length === 0) {
        return res.status(400).json({ message: 'No valid product codes provided.' });
    }

    try {
        const [result] = await pool.query('DELETE FROM ppob_products WHERE product_code IN (?)', [codes]);
        res.json({
            success: true,
            deleted: result.affectedRows || 0,
            message: `Berhasil menghapus ${result.affectedRows || 0} produk.`,
        });
    } catch (error) {
        console.error('Error deleting PPOB products:', error);
        res.status(500).json({ message: 'Failed to delete PPOB products.' });
    }
});


// --- CUSTOMER FACING ROUTES ---

/**
 * [CUSTOMER] Fetches all active PPOB products, grouped by category.
 */
router.get('/products', async (req, res) => {
    try {
        const [products] = await pool.query(
            'SELECT product_code, product_name, category, brand, selling_price, description, product_type, is_active FROM ppob_products WHERE is_active = TRUE ORDER BY category, brand, selling_price'
        );

        // Group products by category AND type (prepaid/postpaid)
        const groupedProducts = products.reduce((acc, product) => {
            const category = product.category || 'Lainnya';
            const type = product.product_type || 'prepaid';
            if (!acc[type]) acc[type] = {};
            if (!acc[type][category]) acc[type][category] = [];
            acc[type][category].push(product);
            return acc;
        }, {});

        res.json(groupedProducts);
    } catch (error) {
        console.error('Error fetching active PPOB products:', error);
        res.status(500).json({ message: 'Failed to fetch PPOB products.' });
    }
});

/**
 * [CUSTOMER] Inquiry tagihan pascabayar (misal PLN pasca) sebelum pembayaran.
 */
router.post('/inquiry', async (req, res) => {
    const { product_code, customer_no } = req.body;
    if (!product_code || !customer_no) {
        return res.status(400).json({ message: 'Product code and customer number are required.' });
    }

    try {
        console.log('[PPOB Inquiry] PLN pascabayar request', { product_code, customer_no });
        const [[product]] = await pool.query('SELECT * FROM ppob_products WHERE product_code = ? AND is_active = TRUE', [product_code]);
        if (!product) return res.status(404).json({ message: 'Produk tidak ditemukan atau non-aktif.' });
        if (!isPostpaidType(product.product_type || product.category || '')) {
            return res.status(400).json({ message: 'Inquiry hanya tersedia untuk produk pascabayar.' });
        }

    const result = await digiflazzService.checkBill(product_code, customer_no);
    const data = result?.data || {};
        const status = (data.status || '').toUpperCase();
        if (status === 'FAILED' || status === 'GAGAL') {
            return res.status(400).json({ message: data.message || 'Inquiry gagal.' });
        }

        const amount = Number(data.selling_price ?? data.price ?? product.selling_price);
        res.json({
            success: true,
            status,
            message: data.message || 'Inquiry berhasil.',
            customer_name: data.customer_name || data.name || null,
            bill_amount: isFinite(amount) ? amount : null,
            raw: data,
        });
    } catch (error) {
        console.error('[PPOB Inquiry] Error:', error);
        res.status(500).json({ message: error.message || 'Gagal melakukan inquiry.' });
    }
});

/**
 * [CUSTOMER] Inquiry PLN prabayar untuk mendapatkan nama pelanggan/validasi nomor.
 */
router.post('/pln/prepaid-inquiry', async (req, res) => {
    const { customer_no } = req.body;
    if (!customer_no) {
        return res.status(400).json({ message: 'Customer number is required.' });
    }

    try {
        const result = await digiflazzService.inquiryPlnPrepaid(customer_no);
        const data = result?.data || {};
        const status = (data.status || '').toUpperCase();
        if (status === 'GAGAL' || status === 'FAILED') {
            return res.status(400).json({ message: data.message || 'Inquiry gagal.' });
        }

        res.json({
            success: true,
            customer_name: data.customer_name || data.nama || data.name || null,
            segment_power: data.segment_power || data.segmen || null,
            message: data.message || 'Inquiry berhasil.',
            raw: data,
        });
    } catch (error) {
        console.error('[PPOB PLN Prepaid Inquiry] Error:', error);
        res.status(500).json({ message: error.message || 'Gagal melakukan inquiry.' });
    }
});

/**
 * [CUSTOMER] Checks a postpaid bill (e.g. PLN pascabayar) and returns normalized fields.
 */
router.post('/check-bill', async (req, res) => {
    const { product_code, customer_no } = req.body;
    const amountFromClient = parseNumericValue(req.body?.amount ?? 0);

    if (!product_code || !customer_no) {
        return res.status(400).json({ message: 'Product code and customer number are required.' });
    }

    try {
        console.log('[PPOB Check-Bill] Request', { product_code, customer_no, amount: amountFromClient });
        // Pastikan produk pascabayar dan aktif
        const [[product]] = await pool.query('SELECT * FROM ppob_products WHERE product_code = ? AND is_active = TRUE', [product_code]);
        if (!product) return res.status(404).json({ message: 'Produk tidak ditemukan atau non-aktif.' });
        if (!isPostpaidType(product.product_type || product.category || '')) {
            return res.status(400).json({ message: 'Produk ini bukan pascabayar.' });
        }

        const result = await digiflazzService.checkBill(product_code, customer_no, amountFromClient > 0 ? amountFromClient : undefined);
        const data = result?.data || {};
        const status = (data.status || '').toUpperCase();

        if (status === 'GAGAL' || status === 'FAILED') {
             return res.status(400).json({ message: data.message || 'Failed to check bill.' });
        }

        const amountRaw = data.selling_price ?? data.price ?? data.amount ?? amountFromClient ?? product.selling_price ?? product.price;
        const parsedAmount = parseNumericValue(amountRaw);
        const bill_amount = parsedAmount > 0 ? parsedAmount : null;
        // Gunakan admin dari provider (admin/fee), fallback 0
        const providerAdmin = parseNumericValue(data.admin ?? data.fee ?? 0);
        const providerTotal = parseNumericValue(data.total_charge ?? data.totalcharge ?? data.total ?? data.tagihan ?? data.amount ?? 0);
        const total_charge = providerTotal > 0 ? providerTotal : (bill_amount ?? null);

        res.json({
            success: true,
            status,
            message: data.message || 'Inquiry berhasil.',
            customer_name: data.customer_name || data.name || null,
            bill_amount,
            admin: providerAdmin,
            total_charge,
            product_selling_price: product.selling_price ?? null,
            ref_id: data.ref_id || data.refid || null,
            data,
        });
    } catch (error) {
        console.error('[PPOB Check Bill] Error:', error);
        res.status(500).json({ message: `A server error occurred: ${error.message}` });
    }
});


/**
 * [CUSTOMER] Creates a new PPOB purchase.
 */
router.post('/purchase', async (req, res) => {
    const { product_code, customer_no, bill_ref_id, bill_selling_price, bill_total_charge, bill_admin } = req.body;
    const customer_id = req.user.id;

    if (!product_code || !customer_no) {
        return res.status(400).json({ message: 'Product code and customer number are required.' });
    }
    
    console.log(`[PPOB Purchase] Initiating for customer: ${customer_id}, product: ${product_code}`);

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        console.log(`[PPOB Purchase] DB transaction started.`);

        const [[product]] = await connection.query('SELECT * FROM ppob_products WHERE product_code = ? AND is_active = TRUE', [product_code]);
        if (!product) {
            await connection.rollback();
            return res.status(404).json({ message: 'Produk tidak ditemukan atau sedang tidak aktif.' });
        }

        const [[customer]] = await connection.query('SELECT * FROM customers WHERE id = ? FOR UPDATE', [customer_id]);
        if (!customer) {
            await connection.rollback();
            return res.status(404).json({ message: 'Customer not found.' });
        }

        let price = product.selling_price;
        let inquiryData = null;
        const isPostpaid = isPostpaidType(product.product_type || product.category || '');
        const hasClientBill = isPostpaid && bill_ref_id && Number(bill_total_charge) > 0;

        if (isPostpaid && !hasClientBill) {
            await connection.rollback();
            return res.status(400).json({ message: 'Informasi tagihan dari klien tidak lengkap atau tidak valid. Silakan coba lagi.' });
        }
        
        if (hasClientBill) {
            const parsedTotal = parseNumericValue(bill_total_charge);
            const parsedSelling = parseNumericValue(bill_selling_price ?? bill_total_charge);
            price = parsedTotal > 0 ? parsedTotal : parsedSelling > 0 ? parsedSelling : price;
            inquiryData = { ref_id: bill_ref_id, price, message: 'User-provided inquiry data' };
        }
        
        console.log(`[PPOB Purchase] Calculated price: ${price}. Customer balance: ${customer.voucher_balance}`);
        if (Number(customer.voucher_balance) < price) {
            await connection.rollback();
            console.log(`[PPOB Purchase] Rollback: Insufficient balance.`);
            return res.status(400).json({ message: `Saldo tidak cukup. Anda membutuhkan ${formatRupiah(price)}, namun saldo Anda hanya ${formatRupiah(customer.voucher_balance)}.` });
        }

        const transaction_ref_id = `PPOB-${customer_id.slice(-5)}-${Date.now()}`;
        
        let plnCustomerName = null;
        if (product.category?.toUpperCase().includes('PLN') && !isPostpaid) {
            try {
                const inquiryResult = await digiflazzService.inquiryPlnPrepaid(customer_no);
                if (inquiryResult?.data?.customer_name) {
                    plnCustomerName = inquiryResult.data.customer_name;
                    console.log(`[PPOB Purchase] PLN Inquiry success, found name: ${plnCustomerName}`);
                }
            } catch (inqError) {
                console.warn(`[PPOB Purchase] Optional PLN inquiry failed, proceeding without name: ${inqError.message}`);
            }
        }

        const [updateResult] = await connection.query('UPDATE customers SET voucher_balance = voucher_balance - ? WHERE id = ?', [price, customer_id]);
        console.log(`[PPOB Purchase] Balance update query result:`, updateResult);

        await connection.query(
            `INSERT INTO ppob_transactions (transaction_ref_id, customer_id, product_code, customer_no, status, selling_price, message)
             VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
            [transaction_ref_id, customer_id, product_code, customer_no, price, inquiryData?.message || 'Awaiting provider confirmation.']
        );
        console.log(`[PPOB Purchase] Inserted PENDING transaction ${transaction_ref_id}`);


        try {
            console.log(`[PPOB Purchase] Calling Digiflazz for ref_id: ${transaction_ref_id}`);
            const command = isPostpaid ? 'pay-pasca' : undefined;
            const paymentRefId = inquiryData?.ref_id || transaction_ref_id;
            const digiflazzResult = await digiflazzService.createTransaction(product_code, customer_no, paymentRefId, command);
            const digiData = digiflazzResult.data || {};
            const status = normalizeStatus(digiData.status, digiData.rc || digiData.code);
            console.log(`[PPOB Purchase] Digiflazz response status: ${status}`);
            const sn = digiData.sn ?? null;
            
            const messageObject = {
                text: digiData.message || 'Transaksi diproses.',
                rc: digiData.rc ?? null,
                status: digiData.status ?? null,
                customer_name: digiData.customer_name ?? plnCustomerName ?? null,
                sn: sn,
                periode: digiData.periode ?? null,
                desc: digiData.desc ?? null
            };
            const message = JSON.stringify(messageObject);

            if (status === 'FAILED') {
                await connection.rollback();
                console.log(`[PPOB Purchase] Rollback: Digiflazz returned FAILED status.`);
                await pool.query(
                    `INSERT INTO ppob_transactions (transaction_ref_id, customer_id, product_code, customer_no, status, selling_price, message, sn)
                     VALUES (?, ?, ?, ?, 'FAILED', ?, ?, ?)
                     ON DUPLICATE KEY UPDATE status='FAILED', message=VALUES(message), sn=VALUES(sn)`,
                    [transaction_ref_id, customer_id, product_code, customer_no, price, message, sn]
                );
                return res.status(400).json({ success: false, message: digiData.message || 'Produk sedang tidak tersedia' });
            }

            await connection.query(
                'UPDATE ppob_transactions SET status = ?, message = ?, sn = ? WHERE transaction_ref_id = ?',
                [status, message, sn, transaction_ref_id]
            );
            console.log(`[PPOB Purchase] Updated transaction ${transaction_ref_id} to status ${status}.`);

            await connection.commit();
            console.log(`[PPOB Purchase] COMMIT successful for ${transaction_ref_id}.`);
            res.json({ success: true, message: 'Transaksi berhasil diproses!', data: digiData });

        } catch (digiError) {
            await connection.rollback();
            console.log(`[PPOB Purchase] Rollback: Error during Digiflazz call.`, digiError.message);
            const providerMsg = (digiError.response?.data?.data?.message) || digiError.message || 'Terjadi kesalahan pada provider.';
            const failedMessage = JSON.stringify({ text: `API_ERROR: ${providerMsg}` });
            await pool.query(
                `INSERT INTO ppob_transactions (transaction_ref_id, customer_id, product_code, customer_no, status, selling_price, message)
                 VALUES (?, ?, ?, ?, 'FAILED', ?, ?)
                 ON DUPLICATE KEY UPDATE status='FAILED', message=VALUES(message)`,
                [transaction_ref_id, customer_id, product_code, customer_no, price, failedMessage]
            );
            console.error(`[PPOB Purchase] Digiflazz API Error for ${transaction_ref_id}:`, digiError.message);
            res.status(400).json({ success: false, message: `Transaksi gagal: ${providerMsg}` });
        }
    } catch (error) {
        if (connection) {
            await connection.rollback();
            console.log(`[PPOB Purchase] Rollback: Main transaction error.`, error.message);
        }
        console.error('[PPOB Purchase] Main transaction error:', error);
        res.status(500).json({ message: `A server error occurred: ${error.message}` });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * [CUSTOMER] Fetches the transaction history for the logged-in user.
 */
router.get('/transactions', async (req, res) => {
    const customer_id = req.user.id;
    try {
        console.log('Fetching PPOB transactions for customer_id:', customer_id);
        const [transactions] = await pool.query(
            `SELECT t.*, p.product_name, p.product_type 
             FROM ppob_transactions t
             LEFT JOIN ppob_products p ON t.product_code = p.product_code
             WHERE t.customer_id = ? 
             ORDER BY t.created_at DESC`,
            [customer_id]
        );
        console.log('Fetched transactions:', transactions);
        res.json(transactions.map(tx => ({ 
            ...tx, 
            ...extractRcInfoFromMessage(tx.message) 
        })));
    } catch (error) {
        console.error('Error fetching PPOB transactions:', error);
        res.status(500).json({ message: 'Failed to fetch transaction history.' });
    }
});

/**
 * [ADMIN] Ambil daftar transaksi PPOB (dengan info customer dan produk).
 */
router.get('/admin/transactions', isAdmin, async (req, res) => {
    try {
        const [transactions] = await pool.query(`
            SELECT 
                t.id,
                t.transaction_ref_id,
                t.customer_id,
                c.name AS customer_name,
                t.product_code,
                p.product_name,
                p.product_type,
                p.category,
                p.brand,
                t.customer_no,
                t.status,
                t.selling_price,
                t.message,
                t.created_at,
                t.updated_at
            FROM ppob_transactions t
            JOIN ppob_products p ON t.product_code = p.product_code
            LEFT JOIN customers c ON t.customer_id = c.id
            ORDER BY t.created_at DESC
        `);
        res.json(transactions.map(tx => ({ 
            ...tx, 
            ...extractRcInfoFromMessage(tx.message) 
        })));
    } catch (error) {
        console.error('Error fetching admin PPOB transactions:', error);
        res.status(500).json({ message: 'Failed to fetch transactions.' });
    }
});

/**
 * [ADMIN] Update status/message transaksi PPOB.
 */
router.put('/admin/transactions/:ref_id', isAdmin, async (req, res) => {
    const { ref_id } = req.params;
    const { status, message } = req.body;
    if (!status && !message) {
        return res.status(400).json({ message: 'Provide status and/or message.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [[tx]] = await connection.query('SELECT * FROM ppob_transactions WHERE transaction_ref_id = ? FOR UPDATE', [ref_id]);
        if (!tx) {
            await connection.rollback();
            return res.status(404).json({ message: 'Transaction not found.' });
        }

        const newStatus = status ? String(status).toUpperCase() : tx.status;
        const newMessage = typeof message !== 'undefined' ? message : tx.message;

        await connection.query(
            'UPDATE ppob_transactions SET status = ?, message = ? WHERE transaction_ref_id = ?',
            [newStatus, newMessage, ref_id]
        );

        // Refund jika diubah ke FAILED dari status lain
        if (newStatus === 'FAILED' && tx.status !== 'FAILED') {
            await connection.query(
                'UPDATE customers SET voucher_balance = voucher_balance + ? WHERE id = ?',
                [tx.selling_price, tx.customer_id]
            );
        }

        await connection.commit();
        res.json({ success: true, message: 'Transaction updated.' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating PPOB transaction:', error);
        res.status(500).json({ message: `Failed to update transaction: ${error.message}` });
    } finally {
        if (connection) connection.release();
    }
});

const refreshStatusHandler = async (req, res) => {
    const { ref_id } = req.params;
    const userId = req.user.id;
    const isAdminRequest = req.user?.role === 'admin';
    let connection;
    try {
        connection = await pool.getConnection();
        const [[tx]] = isAdminRequest
            ? await connection.query('SELECT * FROM ppob_transactions WHERE transaction_ref_id = ?', [ref_id])
            : await connection.query(
                  'SELECT * FROM ppob_transactions WHERE transaction_ref_id = ? AND customer_id = ?',
                  [ref_id, userId]
              );
        if (!tx) return res.status(404).json({ message: 'Transaction not found.' });

        const buyerSkuCode = tx.product_code;
        const customerNo = tx.customer_no;
        if (!buyerSkuCode || !customerNo) {
            return res.status(400).json({ message: 'Missing product_code or customer_no for this transaction.' });
        }

        const [[product]] = await connection.query(
            'SELECT product_type, category FROM ppob_products WHERE product_code = ?',
            [buyerSkuCode]
        );
        const isPostpaid = isPostpaidType(product?.product_type || product?.category || '');

        const result = await digiflazzService.checkStatus(ref_id, buyerSkuCode, customerNo, isPostpaid);
        const data = result?.data || {};
        const newStatus = normalizeStatus(data.status, data.rc || data.code);

        const sn = data.sn || null;
        let existingDetails = {};
        try {
            existingDetails = JSON.parse(tx.message);
            if(typeof existingDetails !== 'object' || existingDetails === null) existingDetails = { text: tx.message };
        } catch (e) {
            existingDetails = { text: tx.message || '' };
        }

        const updatedDetails = {
            ...existingDetails,
            text: data.message || existingDetails.text,
            status: data.status || existingDetails.status,
            rc: data.rc || existingDetails.rc,
            sn: sn || existingDetails.sn,
            customer_name: data.customer_name || existingDetails.customer_name,
        };
        const updatedMessage = JSON.stringify(updatedDetails);

        if (newStatus !== tx.status || tx.sn !== sn || tx.message !== updatedMessage) {
            await connection.query(
                'UPDATE ppob_transactions SET status = ?, message = ?, sn = ?, updated_at = NOW() WHERE transaction_ref_id = ?',
                [newStatus, updatedMessage, sn, ref_id]
            );
            if (newStatus === 'FAILED' && tx.status !== 'FAILED') {
                await connection.query('UPDATE customers SET voucher_balance = voucher_balance + ? WHERE id = ?', [tx.selling_price, tx.customer_id]);
            }
        }

        res.json({ success: true, status: newStatus, message: updatedMessage, raw: data });
    } catch (error) {
        console.error('[PPOB Refresh] Error:', error);
        res.status(500).json({ message: error.message || 'Failed to refresh status.' });
    } finally {
        if (connection) connection.release();
    }
};

router.post('/transactions/:ref_id/refresh', refreshStatusHandler);
router.get('/transactions/:ref_id/refresh', refreshStatusHandler);

/**
 * [ADMIN] Hapus transaksi PPOB.
 */
router.delete('/admin/transactions/:ref_id', isAdmin, async (req, res) => {
    const { ref_id } = req.params;
    try {
        const [result] = await pool.query('DELETE FROM ppob_transactions WHERE transaction_ref_id = ?', [ref_id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Transaction not found.' });
        }
        res.json({ success: true, message: 'Transaction deleted.' });
    } catch (error) {
        console.error('Error deleting PPOB transaction:', error);
        res.status(500).json({ message: `Failed to delete transaction: ${error.message}` });
    }
});

/**
 * [PUBLIC] Callback Digiflazz untuk update status transaksi.
 * Tambahkan pembatasan IP/signature sesuai kebutuhan di deployment.
 */
router.post('/callback', async (req, res) => {
    const payload = req.body?.data || req.body || {};
    const { ref_id, status, sign } = payload;

    if (!ref_id || !status) {
        return res.status(400).json({ message: 'ref_id and status are required.' });
    }

    try {
        if (sign) {
            const { username, apiKey } = await getDigiflazzCredentials();
            if (username && apiKey) {
                const base = `${username}${apiKey}${ref_id}`;
                const withStatus = `${base}${status || ''}`;
                const expected = crypto.createHash('md5').update(base).digest('hex');
                const expectedWithStatus = crypto.createHash('md5').update(withStatus).digest('hex');
                if (sign !== expected && sign !== expectedWithStatus) {
                    return res.status(401).json({ message: 'Invalid Digiflazz signature.' });
                }
            }
        }

        await handleDigiflazzStatusUpdate(payload);
        res.json({ success: true });
    } catch (error) {
        console.error('[PPOB Callback] Error:', error);
        res.status(500).json({ message: 'Failed to process callback.' });
    }
});

export default router;
