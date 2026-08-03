import fs from 'fs/promises';
import path from 'path';
import pool, { createRestoreConnection } from '../db.js';
import { normalizeSqlDumpContent, splitSqlStatements } from '../utils/sqlDump.js';

const RESTORE_JOB_STATUSES = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

const jobId = String(process.argv[2] || '').trim();

const getDatabaseRestoreJobById = async (id) => {
    const [rows] = await pool.query(
        'SELECT * FROM database_restore_jobs WHERE id = ? LIMIT 1',
        [id]
    );
    return rows.length > 0 ? rows[0] : null;
};

const updateDatabaseRestoreJob = async (id, fields = {}) => {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;

    const assignments = keys.map((key) => `\`${key}\` = ?`).join(', ');
    const values = keys.map((key) => fields[key]);
    values.push(id);

    await pool.query(
        `UPDATE database_restore_jobs SET ${assignments} WHERE id = ?`,
        values
    );
};

const finalizeDatabaseRestoreJob = async (id, status, fields = {}) => {
    await updateDatabaseRestoreJob(id, {
        status,
        progress_percent: status === RESTORE_JOB_STATUSES.COMPLETED ? 100 : Number(fields.progress_percent || 0),
        finished_at: fields.finished_at || new Date(),
        updated_at: new Date(),
        worker_pid: null,
        ...fields,
    });
};

const cleanupBackupFiles = async (backupPath) => {
    if (!backupPath) return;
    try {
        await fs.unlink(backupPath);
    } catch {
        // Ignore cleanup errors.
    }
};

const RESTORE_BATCH_SIZE = 50;
const RESTORE_BATCH_MAX_BYTES = 512 * 1024;
const RESTORE_BATCH_PAUSE_MS = Math.max(0, Number(process.env.DATABASE_RESTORE_BATCH_PAUSE_MS || 10));
const RESTORE_PROGRESS_UPDATE_EVERY_STATEMENTS = Math.max(1, Number(process.env.DATABASE_RESTORE_PROGRESS_UPDATE_EVERY_STATEMENTS || 10));
const RESTORE_PROGRESS_UPDATE_INTERVAL_MS = Math.max(1000, Number(process.env.DATABASE_RESTORE_PROGRESS_UPDATE_INTERVAL_MS || 5000));
const INTERNAL_RESTORE_TABLES = new Set(['database_restore_jobs']);

const shouldSkipStatement = (statement) => {
    const normalized = String(statement || '').trim();
    if (!normalized) {
        return true;
    }

    const lower = normalized.toLowerCase();
    const targetsInternalTable = [...INTERNAL_RESTORE_TABLES].some((table) => lower.includes(table));
    if (!targetsInternalTable) {
        return false;
    }

    return /^(create|drop|alter|truncate|insert\s+into|replace\s+into|delete\s+from|lock\s+tables|unlock\s+tables)\b/i.test(normalized);
};

const ensureRestoreStillActive = async () => {
    const currentJob = await getDatabaseRestoreJobById(jobId);
    if (!currentJob) {
        const error = new Error('Restore job was removed.');
        error.code = 'RESTORE_CANCELLED';
        throw error;
    }

    if (currentJob.status === RESTORE_JOB_STATUSES.CANCELED) {
        const error = new Error('Restore job was canceled.');
        error.code = 'RESTORE_CANCELLED';
        throw error;
    }

    if (![
        RESTORE_JOB_STATUSES.QUEUED,
        RESTORE_JOB_STATUSES.RUNNING,
    ].includes(currentJob.status)) {
        const error = new Error(`Restore job is no longer active (${currentJob.status}).`);
        error.code = 'RESTORE_CANCELLED';
        throw error;
    }
};

const main = async () => {
    if (!jobId) {
        throw new Error('Missing database restore job ID.');
    }

    const job = await getDatabaseRestoreJobById(jobId);
    if (!job) {
        throw new Error('Database restore job not found.');
    }

    if (![RESTORE_JOB_STATUSES.QUEUED, RESTORE_JOB_STATUSES.RUNNING].includes(job.status)) {
        console.log(`[Database Restore Worker] Job ${jobId} already finished with status ${job.status}.`);
        return;
    }

    const backupPath = String(job.backup_path || '').trim();
    if (!backupPath) {
        throw new Error('Database restore job does not have a backup path.');
    }

    await updateDatabaseRestoreJob(jobId, {
        status: RESTORE_JOB_STATUSES.RUNNING,
        started_at: job.started_at || new Date(),
        processed_count: Number(job.processed_count || 0),
        error_message: null,
        message: 'Preparing restore file...',
        updated_at: new Date(),
    });

    let connection = null;

    try {
        connection = await createRestoreConnection();
        const rawSqlContent = await fs.readFile(backupPath, 'utf8');
        const normalizedSqlContent = normalizeSqlDumpContent(rawSqlContent);
        const statements = splitSqlStatements(normalizedSqlContent);

        if (statements.length === 0) {
            throw new Error('Backup file does not contain any SQL statements.');
        }

        const restoreStatements = statements.filter((statement) => !shouldSkipStatement(statement));

        if (restoreStatements.length === 0) {
            throw new Error('Backup file does not contain any restorable SQL statements.');
        }

        await updateDatabaseRestoreJob(jobId, {
            total_statements: restoreStatements.length,
            processed_count: 0,
            progress_percent: 1,
            message: `Parsed ${restoreStatements.length} SQL statement(s). Starting restore...`,
            updated_at: new Date(),
        });

        let processedCount = 0;
        let currentProgressPercent = 1;
        let batch = [];
        let batchBytes = 0;
        const skippedInternalStatements = statements.length - restoreStatements.length;
        let lastProgressUpdateAt = Date.now();

        await connection.query('SET FOREIGN_KEY_CHECKS=0;');

        const flushBatch = async () => {
            if (batch.length === 0) {
                return;
            }

            await ensureRestoreStillActive();
            const batchSql = `${batch.join(';\n')};`;
            await connection.query(batchSql);
            if (RESTORE_BATCH_PAUSE_MS > 0) {
                await new Promise((resolve) => setTimeout(resolve, RESTORE_BATCH_PAUSE_MS));
            }
            batch = [];
            batchBytes = 0;
        };

        for (const trimmedStatement of restoreStatements) {
            processedCount += 1;
            batch.push(trimmedStatement);
            batchBytes += Buffer.byteLength(trimmedStatement, 'utf8') + 2;

            const now = Date.now();
            const progressPercent = Math.min(
                99,
                Math.max(1, Math.round((processedCount / restoreStatements.length) * 100))
            );
            const shouldReportProgress = (
                processedCount === 1
                || processedCount === restoreStatements.length
                || processedCount % RESTORE_PROGRESS_UPDATE_EVERY_STATEMENTS === 0
                || now - lastProgressUpdateAt >= RESTORE_PROGRESS_UPDATE_INTERVAL_MS
            );

            if (shouldReportProgress && (progressPercent !== currentProgressPercent || now - lastProgressUpdateAt >= RESTORE_PROGRESS_UPDATE_INTERVAL_MS || processedCount === 1 || processedCount === restoreStatements.length)) {
                currentProgressPercent = progressPercent;
                lastProgressUpdateAt = now;
                await updateDatabaseRestoreJob(jobId, {
                    processed_count: processedCount,
                    progress_percent: progressPercent,
                    message: `Restoring database: ${processedCount}/${restoreStatements.length} SQL statement(s) processed.`,
                    updated_at: new Date(),
                });
            }

            const shouldFlush = batch.length >= RESTORE_BATCH_SIZE || batchBytes >= RESTORE_BATCH_MAX_BYTES;
            if (!shouldFlush && processedCount !== restoreStatements.length) {
                continue;
            }

            await flushBatch();
            const flushedProgressPercent = Math.min(
                99,
                Math.max(1, Math.round((processedCount / restoreStatements.length) * 100))
            );

            if (flushedProgressPercent !== currentProgressPercent || processedCount === restoreStatements.length) {
                currentProgressPercent = flushedProgressPercent;
                lastProgressUpdateAt = Date.now();
                await updateDatabaseRestoreJob(jobId, {
                    processed_count: processedCount,
                    progress_percent: flushedProgressPercent,
                    message: `Processed ${processedCount}/${restoreStatements.length} SQL statement(s).`,
                    updated_at: new Date(),
                });
            }
        }

        await flushBatch();
        await connection.query('SET FOREIGN_KEY_CHECKS=1;');

        await finalizeDatabaseRestoreJob(jobId, RESTORE_JOB_STATUSES.COMPLETED, {
            processed_count: processedCount,
            progress_percent: 100,
            message: skippedInternalStatements > 0
                ? `Database restored successfully from ${path.basename(backupPath)}. Skipped ${skippedInternalStatements} internal statement(s).`
                : `Database restored successfully from ${path.basename(backupPath)}.`,
        });

        await cleanupBackupFiles(backupPath);
        console.log(`[Database Restore Worker] Restore complete for job ${jobId}.`);
    } catch (error) {
        if (error?.code === 'RESTORE_CANCELLED') {
            console.warn(`[Database Restore Worker] Restore canceled for job ${jobId}.`);
            try {
                await cleanupBackupFiles(backupPath);
            } catch {
                // Ignore cleanup failures on cancel.
            }
            return;
        }

        if (connection) {
            try {
                await connection.query('SET FOREIGN_KEY_CHECKS=1;');
            } catch {
                // Ignore cleanup query failure.
            }
        }

        console.error('[Database Restore Worker] Restore failed:', error);
        await finalizeDatabaseRestoreJob(jobId, RESTORE_JOB_STATUSES.FAILED, {
            error_message: error.message || 'Unknown database restore job error',
            message: error.message || 'Database restore job failed.',
        });
        await cleanupBackupFiles(backupPath);
    } finally {
        if (connection) {
            await connection.end().catch(() => {});
        }
        await pool.end().catch(() => {});
    }
};

main().catch(async (error) => {
    console.error('[Database Restore Worker] Fatal error:', error);
    if (jobId) {
        try {
            await finalizeDatabaseRestoreJob(jobId, RESTORE_JOB_STATUSES.FAILED, {
                error_message: error.message || 'Unknown fatal database restore error',
                message: error.message || 'Database restore job failed.',
            });
        } catch (finalizeError) {
            console.error('[Database Restore Worker] Failed to finalize job after fatal error:', finalizeError);
        }
    }

    await pool.end().catch(() => {});
    process.exit(1);
});
