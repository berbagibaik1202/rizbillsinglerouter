import '../env.js';
import { fileURLToPath } from 'url';
import path from 'path';
import pool from '../db.js';
import mikrotikApi from '../mikrotik-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PPPoE_SYNC_JOB_STATUSES = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

const jobId = String(process.argv[2] || '').trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chunkArray = (items, size = 100) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
};

const getUserPriorityScore = (u) => {
    let score = 0;
    // Prefer entries with a valid router ID
    if (u.id && String(u.id).trim()) score += 5000;
    // Prefer enabled over disabled
    if (!u.disabled) score += 1000;
    // Prefer specific 'pppoe' service over 'any' or other services
    const service = String(u.service || '').toLowerCase().trim();
    if (service === 'pppoe') score += 100;
    else if (service === 'any') score += 50;
    // Prefer specific profile over default or empty
    const profile = String(u.profile || '').toLowerCase().trim();
    if (profile && profile !== 'default') score += 20;
    // Prefer entries with a comment (often contains customer link/code)
    if (u.comment && String(u.comment).trim()) score += 10;
    // Prefer entries with a password
    if (u.password && String(u.password).trim()) score += 5;
    return score;
};

export const deduplicateRouterUsers = (routerUsers) => {
    if (!Array.isArray(routerUsers)) return { uniqueUsers: [], duplicateCount: 0 };

    const userMap = new Map();
    let duplicateCount = 0;

    for (const user of routerUsers) {
        if (!user || typeof user !== 'object') continue;
        const rawName = String(user.name || '').trim();
        if (!rawName) {
            console.warn('[PPPoE Sync Worker] Skipping user with empty or invalid name:', user);
            continue;
        }

        // MySQL unique constraint on VARCHAR with _ci collation is case-insensitive
        const normalizedKey = rawName.toLowerCase();
        const existing = userMap.get(normalizedKey);

        if (!existing) {
            userMap.set(normalizedKey, { ...user, name: rawName });
        } else {
            duplicateCount++;
            const existingScore = getUserPriorityScore(existing);
            const currentScore = getUserPriorityScore(user);

            console.warn(
                `[PPPoE Sync Worker] Duplicate username '${rawName}' found on router (IDs: '${existing.id}', '${user.id}'). ` +
                `Prioritizing based on score (existing: ${existingScore}, incoming: ${currentScore}).`
            );

            if (currentScore > existingScore) {
                userMap.set(normalizedKey, { ...user, name: rawName });
            }
        }
    }

    // Ensure IDs are also unique and non-empty
    const uniqueUsers = [];
    const seenIds = new Set();
    for (const user of userMap.values()) {
        const rawId = String(user.id || '').trim();
        if (!rawId) {
            console.warn(`[PPPoE Sync Worker] Skipping user '${user.name}' due to missing router ID.`);
            continue;
        }
        if (seenIds.has(rawId)) {
            console.warn(`[PPPoE Sync Worker] Skipping user '${user.name}' due to duplicate router ID: ${rawId}`);
            continue;
        }
        seenIds.add(rawId);
        uniqueUsers.push(user);
    }

    return { uniqueUsers, duplicateCount };
};

const getPppoeSyncJobById = async (id) => {
    const [rows] = await pool.query(
        'SELECT * FROM pppoe_sync_jobs WHERE id = ? LIMIT 1',
        [id]
    );
    return rows.length > 0 ? rows[0] : null;
};

const updatePppoeSyncJob = async (id, fields = {}) => {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;

    const assignments = keys.map((key) => `\`${key}\` = ?`).join(', ');
    const values = keys.map((key) => fields[key]);
    values.push(id);

    await pool.query(
        `UPDATE pppoe_sync_jobs SET ${assignments} WHERE id = ?`,
        values
    );
};

const finalizePppoeSyncJob = async (id, status, fields = {}) => {
    await updatePppoeSyncJob(id, {
        status,
        progress_percent: status === PPPoE_SYNC_JOB_STATUSES.COMPLETED ? 100 : Number(fields.progress_percent || 0),
        finished_at: fields.finished_at || new Date(),
        updated_at: new Date(),
        ...fields,
    });
};

const main = async () => {
    if (!jobId) {
        throw new Error('Missing PPPoE sync job ID.');
    }

    const job = await getPppoeSyncJobById(jobId);
    if (!job) {
        throw new Error('PPPoE sync job not found.');
    }

    if (![PPPoE_SYNC_JOB_STATUSES.QUEUED, PPPoE_SYNC_JOB_STATUSES.RUNNING].includes(job.status)) {
        console.log(`[PPPoE Sync Worker] Job ${jobId} already finished with status ${job.status}.`);
        return;
    }

    await updatePppoeSyncJob(jobId, {
        status: PPPoE_SYNC_JOB_STATUSES.RUNNING,
        started_at: job.started_at || new Date(),
        processed_count: Number(job.processed_count || 0),
        error_message: null,
        message: 'Fetching PPPoE users from router...',
        updated_at: new Date(),
    });

    const connection = await pool.getConnection();

    try {
        const routerUsers = await mikrotikApi.fetchPppoeUsers({ includeActive: false });
        if (!Array.isArray(routerUsers)) {
            throw new Error('Failed to fetch a valid PPPoE user list from the router.');
        }

        const { uniqueUsers, duplicateCount } = deduplicateRouterUsers(routerUsers);
        const totalUsers = uniqueUsers.length;
        let processedCount = 0;
        const batchSize = 100;
        const chunks = chunkArray(uniqueUsers, batchSize);

        await connection.beginTransaction();
        await connection.query('DELETE FROM pppoe_users');

        if (totalUsers > 0) {
            for (let i = 0; i < chunks.length; i++) {
                const batch = chunks[i];
                const usersToInsert = batch.map((u) => ({
                    id: String(u.id || '').trim(),
                    name: String(u.name || '').trim(),
                    password: u.password !== undefined && u.password !== null ? String(u.password) : '',
                    service: String(u.service || 'pppoe').trim(),
                    profile: String(u.profile || '').trim(),
                    comment: u.comment !== undefined && u.comment !== null ? String(u.comment) : '',
                    disabled: u.disabled ? 1 : 0,
                }));

                const columns = Object.keys(usersToInsert[0]);
                const values = usersToInsert.map((item) => columns.map((col) => item[col]));
                await connection.query(`INSERT IGNORE INTO pppoe_users (${columns.join(',')}) VALUES ?`, [values]);

                processedCount += batch.length;
                const progressPercent = Math.max(1, Math.min(99, Math.round((processedCount / totalUsers) * 100)));
                await updatePppoeSyncJob(jobId, {
                    processed_count: processedCount,
                    progress_percent: progressPercent,
                    message: duplicateCount > 0
                        ? `Processed ${processedCount}/${totalUsers} user(s) (${duplicateCount} duplicate(s) resolved).`
                        : `Processed ${processedCount}/${totalUsers} user(s).`,
                    updated_at: new Date(),
                });

                if (i < chunks.length - 1) {
                    await sleep(0);
                }
            }
        }

        await connection.commit();

        const finishMessage = duplicateCount > 0
            ? `Synced ${totalUsers} PPPoE user(s) successfully (${duplicateCount} duplicate router entry/entries resolved).`
            : `Synced ${totalUsers} PPPoE user(s) successfully.`;

        await finalizePppoeSyncJob(jobId, PPPoE_SYNC_JOB_STATUSES.COMPLETED, {
            processed_count: totalUsers,
            progress_percent: 100,
            message: finishMessage,
        });

        console.log(`[PPPoE Sync Worker] Sync complete. Synced ${totalUsers} users (${duplicateCount} duplicate(s) resolved).`);
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error('[PPPoE Sync Worker] Rollback failed:', rollbackError);
        }

        console.error('[PPPoE Sync Worker] Sync failed:', error);
        await finalizePppoeSyncJob(jobId, PPPoE_SYNC_JOB_STATUSES.FAILED, {
            error_message: error.message || 'Unknown PPPoE sync job error',
            message: error.message || 'PPPoE sync job failed.',
        });
    } finally {
        connection.release();
        await pool.end().catch(() => {});
    }
};

const isDirectRun = Boolean(process.argv[1] && path.resolve(process.argv[1]) === __filename);

if (isDirectRun) {
    main().catch(async (error) => {
        console.error('[PPPoE Sync Worker] Fatal error:', error);
        if (jobId) {
            try {
                await finalizePppoeSyncJob(jobId, PPPoE_SYNC_JOB_STATUSES.FAILED, {
                    error_message: error.message || 'Unknown fatal PPPoE sync error',
                    message: error.message || 'PPPoE sync job failed.',
                });
            } catch (finalizeError) {
                console.error('[PPPoE Sync Worker] Failed to finalize job after fatal error:', finalizeError);
            }
        }

        await pool.end().catch(() => {});
        process.exit(1);
    });
}
