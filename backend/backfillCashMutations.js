import './env.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import pool from './db.js';
import { recordCashMutation } from './cashMutationService.js';
import { dateToYMD } from './utils.js';

const getMonthBoundary = (timezone = 'Asia/Jakarta', offsetMonths = 0) => {
    const currentMonthKey = dateToYMD(new Date(), timezone).slice(0, 7);
    const [year, month] = currentMonthKey.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, (month - 1) + offsetMonths, 1, 12, 0, 0));
    const nextMonthDate = new Date(Date.UTC(year, (month - 1) + offsetMonths + 1, 1, 12, 0, 0));

    return {
        start: `${dateToYMD(startDate, timezone)} 00:00:00`,
        endExclusive: `${dateToYMD(nextMonthDate, timezone)} 00:00:00`,
    };
};

const categorizePayment = (payment) => {
    const invoiceId = String(payment.invoiceId || '').trim();

    if (invoiceId.startsWith('Voucher:')) {
        return {
            category: 'voucher_sale',
            description: `Penjualan voucher ${invoiceId.replace('Voucher: ', '')}`,
            customer_id: null,
            user_id: payment.sold_by_user_id || null,
        };
    }

    if (invoiceId === 'Affiliate Top Up (Tripay)' || invoiceId === 'Affiliate Top Up (Admin)') {
        return {
            category: 'affiliate_topup',
            description: `Top up saldo affiliate ${invoiceId}`,
            customer_id: payment.customerId || null,
            user_id: payment.sold_by_user_id || null,
        };
    }

    if (invoiceId === 'Reseller Top Up (Tripay)' || invoiceId === 'Balance Top Up' || invoiceId === 'Balance Top Up (Admin)') {
        return {
            category: 'reseller_topup',
            description: `Top up saldo reseller ${invoiceId}`,
            customer_id: payment.customerId || null,
            user_id: payment.sold_by_user_id || null,
        };
    }

    return {
        category: 'invoice_payment',
        description: `Pembayaran invoice ${invoiceId || payment.id}`,
        customer_id: payment.customerId || null,
        user_id: payment.sold_by_user_id || null,
    };
};

const ensureCashMutationTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cash_mutations (
            id VARCHAR(255) PRIMARY KEY,
            date DATETIME NOT NULL,
            direction ENUM('in','out') NOT NULL,
            category VARCHAR(100) NOT NULL,
            amount DECIMAL(15,2) NOT NULL,
            method VARCHAR(100) NULL,
            description TEXT NULL,
            reference_type VARCHAR(50) NULL,
            reference_id VARCHAR(255) NULL,
            customer_id VARCHAR(255) NULL,
            user_id VARCHAR(255) NULL,
            created_by VARCHAR(255) NULL,
            source ENUM('system','manual') NOT NULL DEFAULT 'system',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
};

const main = async () => {
    const dryRun = process.argv.includes('--dry-run');
    const includeAllHistory = process.argv.includes('--all');
    let inserted = 0;

    try {
        await ensureCashMutationTable();
        const timezone = process.env.APP_TIMEZONE || 'Asia/Jakarta';
        const currentMonth = getMonthBoundary(timezone, 0);

        const query = `
            SELECT id, invoiceId, customerId, date, amount, method, sold_by_user_id
            FROM payments
            ${includeAllHistory ? '' : 'WHERE date >= ? AND date < ?'}
            ORDER BY date ASC, id ASC
        `;

        const [payments] = await pool.query(query, includeAllHistory ? [] : [currentMonth.start, currentMonth.endExclusive]);

        console.log(`[Backfill] Found ${payments.length} payment rows to inspect.${includeAllHistory ? ' Mode: all history.' : ' Mode: current month only.'}`);

        for (const payment of payments) {
            const metadata = categorizePayment(payment);

            if (dryRun) {
                console.log(`[Dry Run] payment=${payment.id} category=${metadata.category} amount=${payment.amount}`);
                continue;
            }

            const [existingRows] = await pool.query(
                'SELECT id FROM cash_mutations WHERE reference_type = ? AND reference_id = ? LIMIT 1',
                ['payment', payment.id]
            );

            if (existingRows.length > 0) {
                continue;
            }

            const mutation = await recordCashMutation(pool, {
                date: payment.date,
                direction: 'in',
                category: metadata.category,
                amount: payment.amount,
                method: payment.method,
                description: metadata.description,
                reference_type: 'payment',
                reference_id: payment.id,
                customer_id: metadata.customer_id,
                user_id: metadata.user_id,
                source: 'system',
            });

            if (mutation?.id) {
                inserted += 1;
            }
        }

        if (dryRun) {
            console.log('[Backfill] Dry run selesai. Tidak ada data yang ditulis.');
        } else {
            const [[summary]] = await pool.query(
                `SELECT COUNT(*) AS total FROM cash_mutations WHERE reference_type = 'payment'`
            );
            console.log(`[Backfill] Selesai. ${inserted} mutasi baru ditambahkan. Ledger pembayaran yang tersedia: ${summary.total}.`);
        }
    } catch (error) {
        console.error('[Backfill] Gagal melakukan backfill cash mutations:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

await main();
