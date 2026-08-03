import pool from '../db.js';
import { runAcsSyncJob } from '../routes/acsRoutes.js';

const jobId = String(process.argv[2] || '').trim();

try {
    if (typeof process.setPriority === 'function') {
        process.setPriority(process.pid, 10);
    }
} catch (error) {
    console.warn('[ACS Sync Worker] Failed to lower process priority:', error?.message || error);
}

const main = async () => {
    if (!jobId) {
        throw new Error('Missing ACS sync job ID.');
    }

    await runAcsSyncJob(jobId);
};

main()
    .then(async () => {
        await pool.end().catch(() => {});
        process.exit(0);
    })
    .catch(async (error) => {
        console.error('[ACS Sync Worker] Fatal error:', error);
        await pool.end().catch(() => {});
        process.exit(1);
    });
