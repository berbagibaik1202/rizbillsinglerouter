import './env.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import pool from './db.js';
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

const main = async () => {
    const dryRun = process.argv.includes('--dry-run');
    const includeCurrentMonth = process.argv.includes('--include-current-month');

    try {
        const timezone = process.env.APP_TIMEZONE || 'Asia/Jakarta';
        const currentMonth = getMonthBoundary(timezone, 0);
        const whereClause = `
            source = 'system'
            AND reference_type = 'payment'
            AND direction = 'in'
            ${includeCurrentMonth ? '' : 'AND NOT (date >= ? AND date < ?)'}
        `;

        const [rows] = await pool.query(`
            SELECT id, date, category, amount, reference_id
            FROM cash_mutations
            WHERE ${whereClause}
            ORDER BY date ASC, id ASC
        `, includeCurrentMonth ? [] : [currentMonth.start, currentMonth.endExclusive]);

        console.log(
            `[Cleanup] Found ${rows.length} cash mutation rows to ${dryRun ? 'inspect' : 'delete'}.` +
            `${includeCurrentMonth ? ' Mode: include current month.' : ' Mode: outside current month only.'}`
        );

        if (rows.length > 0) {
            for (const row of rows.slice(0, 20)) {
                console.log(
                    `[Cleanup] ${row.id} date=${row.date} category=${row.category} amount=${row.amount} reference=${row.reference_id}`
                );
            }
            if (rows.length > 20) {
                console.log(`[Cleanup] ...and ${rows.length - 20} more rows.`);
            }
        }

        if (dryRun) {
            console.log('[Cleanup] Dry run selesai. Tidak ada data yang dihapus.');
            return;
        }

        const ids = rows.map((row) => row.id);
        if (ids.length === 0) {
            console.log('[Cleanup] Tidak ada data yang perlu dihapus.');
            return;
        }

        const [result] = await pool.query('DELETE FROM cash_mutations WHERE id IN (?)', [ids]);
        console.log(`[Cleanup] Selesai. ${result.affectedRows} cash mutation(s) dihapus.`);
    } catch (error) {
        console.error('[Cleanup] Gagal membersihkan cash mutations hasil backfill:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

await main();
