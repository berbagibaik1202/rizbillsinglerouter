import pool from './db.js';
import { toMySQLDatetime, dateToYMD } from './utils.js';

const normalizeMutationDirection = (value) => (String(value || '').trim().toLowerCase() === 'out' ? 'out' : 'in');
const normalizeMutationSource = (value) => (String(value || '').trim().toLowerCase() === 'manual' ? 'manual' : 'system');

export const generateCashMutationId = () => `CM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

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

export const recordCashMutation = async (querier, payload) => {
    const db = querier || pool;
    const direction = normalizeMutationDirection(payload.direction);
    const source = normalizeMutationSource(payload.source);
    const amount = Number(payload.amount || 0);

    if (!amount || amount <= 0) {
        throw new Error('Cash mutation amount must be greater than zero.');
    }

    if (payload.reference_type && payload.reference_id) {
        const [existingRows] = await db.query(
            `SELECT id
             FROM cash_mutations
             WHERE reference_type = ?
               AND reference_id = ?
               AND direction = ?
               AND category = ?
             LIMIT 1`,
            [payload.reference_type, payload.reference_id, direction, payload.category || null]
        );

        if (existingRows.length > 0) {
            return existingRows[0];
        }
    }

    const mutation = {
        id: payload.id || generateCashMutationId(),
        date: payload.date || toMySQLDatetime(new Date(), payload.timezone),
        direction,
        category: payload.category || (direction === 'in' ? 'other_income' : 'other_expense'),
        amount,
        method: payload.method || null,
        description: payload.description || null,
        reference_type: payload.reference_type || null,
        reference_id: payload.reference_id || null,
        customer_id: payload.customer_id || null,
        user_id: payload.user_id || null,
        created_by: payload.created_by || null,
        source,
    };

    await db.query('INSERT INTO cash_mutations SET ?', mutation);
    return mutation;
};

export const getCashSummary = async (querier, timezone = 'Asia/Jakarta') => {
    const db = querier || pool;
    const currentMonth = getMonthBoundary(timezone, 0);
    const previousMonth = getMonthBoundary(timezone, -1);
    const [rows] = await db.query(`
        SELECT
            COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS total_in,
            COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS total_out,
            COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS balance,
            COALESCE(SUM(CASE WHEN direction = 'in' AND date >= ? AND date < ? THEN amount ELSE 0 END), 0) AS current_month_in,
            COALESCE(SUM(CASE WHEN direction = 'out' AND date >= ? AND date < ? THEN amount ELSE 0 END), 0) AS current_month_out,
            COALESCE(SUM(CASE WHEN direction = 'in' AND date >= ? AND date < ? THEN amount ELSE 0 END), 0) AS previous_month_in,
            COALESCE(SUM(CASE WHEN direction = 'out' AND date >= ? AND date < ? THEN amount ELSE 0 END), 0) AS previous_month_out
        FROM cash_mutations
    `, [
        currentMonth.start, currentMonth.endExclusive,
        currentMonth.start, currentMonth.endExclusive,
        previousMonth.start, previousMonth.endExclusive,
        previousMonth.start, previousMonth.endExclusive,
    ]);

    const row = rows[0] || {};
    return {
        totalIn: Number(row.total_in || 0),
        totalOut: Number(row.total_out || 0),
        balance: Number(row.balance || 0),
        currentMonthIn: Number(row.current_month_in || 0),
        currentMonthOut: Number(row.current_month_out || 0),
        previousMonthIn: Number(row.previous_month_in || 0),
        previousMonthOut: Number(row.previous_month_out || 0),
    };
};
