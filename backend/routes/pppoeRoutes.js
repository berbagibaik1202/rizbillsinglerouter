import express from 'express';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import pool from '../db.js';
import mikrotikApi from '../mikrotik-api.js';
import { dbDateToISO } from '../utils.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PPPoE_SYNC_WORKER_PATH = path.join(__dirname, '../jobs/pppoeSyncWorker.js');
const PPPoE_SYNC_JOB_POLL_INTERVAL_MS = 5000;
const PPPoE_SYNC_JOB_STATUSES = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

let pppoeSyncSchedulerStarted = false;
let pppoeSyncWorkerRunning = false;
const isLightweightRuntime = process.env.CPANEL_LIGHTWEIGHT === 'true'
    || process.env.DISABLE_BACKGROUND_SERVICES === 'true'
    || process.env.DISABLE_PPPoE_BACKGROUND_REFRESH === 'true';

const formatPppoeSyncJob = (job) => {
    if (!job) return null;
    return {
        ...job,
        processed_count: Number(job.processed_count || 0),
        progress_percent: Number(job.progress_percent || 0),
        created_at: job.created_at ? dbDateToISO(job.created_at) : null,
        updated_at: job.updated_at ? dbDateToISO(job.updated_at) : null,
        started_at: job.started_at ? dbDateToISO(job.started_at) : null,
        finished_at: job.finished_at ? dbDateToISO(job.finished_at) : null,
    };
};

const getPppoeSyncJobById = async (jobId) => {
    const [rows] = await pool.query(
        'SELECT * FROM pppoe_sync_jobs WHERE id = ? LIMIT 1',
        [jobId]
    );
    return rows.length > 0 ? rows[0] : null;
};

const getActivePppoeSyncJob = async () => {
    const [rows] = await pool.query(
        `SELECT * FROM pppoe_sync_jobs
         WHERE status IN (?, ?)
         ORDER BY created_at DESC
         LIMIT 1`,
        [PPPoE_SYNC_JOB_STATUSES.QUEUED, PPPoE_SYNC_JOB_STATUSES.RUNNING]
    );
    return rows.length > 0 ? rows[0] : null;
};

const getNextQueuedPppoeSyncJob = async () => {
    const [rows] = await pool.query(
        `SELECT * FROM pppoe_sync_jobs
         WHERE status = ?
         ORDER BY created_at ASC
         LIMIT 1`,
        [PPPoE_SYNC_JOB_STATUSES.QUEUED]
    );
    return rows.length > 0 ? rows[0] : null;
};

const createPppoeSyncJob = async () => {
    const id = randomUUID();
    await pool.query(
        `INSERT INTO pppoe_sync_jobs (id, status, processed_count, progress_percent, message)
         VALUES (?, ?, 0, 0, ?)`,
        [id, PPPoE_SYNC_JOB_STATUSES.QUEUED, 'Queued for processing']
    );
    return getPppoeSyncJobById(id);
};

const updatePppoeSyncJob = async (jobId, fields = {}) => {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;

    const assignments = keys.map((key) => `\`${key}\` = ?`).join(', ');
    const values = keys.map((key) => fields[key]);
    values.push(jobId);

    await pool.query(
        `UPDATE pppoe_sync_jobs SET ${assignments} WHERE id = ?`,
        values
    );
};

const claimPppoeSyncJob = async (jobId) => {
    const [result] = await pool.query(
        `UPDATE pppoe_sync_jobs
         SET status = ?, started_at = COALESCE(started_at, NOW()), message = ?, updated_at = NOW()
         WHERE id = ? AND status = ?`,
        [PPPoE_SYNC_JOB_STATUSES.RUNNING, 'PPPoE sync worker starting...', jobId, PPPoE_SYNC_JOB_STATUSES.QUEUED]
    );

    return result.affectedRows > 0;
};

const finalizePppoeSyncJob = async (jobId, status, fields = {}) => {
    await updatePppoeSyncJob(jobId, {
        status,
        progress_percent: status === PPPoE_SYNC_JOB_STATUSES.COMPLETED ? 100 : Number(fields.progress_percent || 0),
        finished_at: fields.finished_at || new Date(),
        updated_at: new Date(),
        ...fields,
    });
};

const launchPppoeSyncWorker = (jobId) => {
    const child = spawn(process.execPath, [PPPoE_SYNC_WORKER_PATH, jobId], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });

    child.unref();
    return child;
};

const processPppoeSyncQueue = async () => {
    const nextJob = await getNextQueuedPppoeSyncJob();
    if (!nextJob) {
        return;
    }

    try {
        const claimed = await claimPppoeSyncJob(nextJob.id);
        if (!claimed) {
            return;
        }

        launchPppoeSyncWorker(nextJob.id);
    } catch (error) {
        console.error('[PPPoE Job] Failed to launch sync worker:', error);
        await finalizePppoeSyncJob(nextJob.id, PPPoE_SYNC_JOB_STATUSES.FAILED, {
            error_message: error.message || 'Failed to launch PPPoE sync worker.',
            message: error.message || 'Failed to launch PPPoE sync worker.',
        });
    }
};

export const startPppoeSyncJobScheduler = () => {
    if (isLightweightRuntime) {
        console.warn('[PPPoE Job] PPPoE sync scheduler disabled by runtime flag.');
        return;
    }

    if (pppoeSyncSchedulerStarted) return;
    pppoeSyncSchedulerStarted = true;

    pool.query(
        `UPDATE pppoe_sync_jobs
         SET status = ?, message = ?, updated_at = NOW()
         WHERE status = ?`,
        [PPPoE_SYNC_JOB_STATUSES.QUEUED, 'Recovered after service restart', PPPoE_SYNC_JOB_STATUSES.RUNNING]
    ).catch((error) => {
        console.error('[PPPoE Job] Failed to recover running jobs on startup:', error);
    });

    const tick = () => {
        processPppoeSyncQueue().catch((error) => {
            console.error('[PPPoE Job] Scheduler tick failed:', error);
        });
    };

    tick();
    setInterval(tick, PPPoE_SYNC_JOB_POLL_INTERVAL_MS);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chunkArray = (items, size = 100) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
};

const formatActivePppoeUsers = (users) => {
    if (!Array.isArray(users)) return [];
    return users.map(user => ({
        id: user['.id'],
        name: user.name,
        service: user.service,
        callerId: user['caller-id'],
        address: user.address,
        uptime: user.uptime,
    }));
};

// --- PPPoE Active Connections (Live from Router) ---
router.get('/active', async (req, res) => {
    try {
        const activeUsers = await mikrotikApi.fetchActivePppoeConnections();
        res.json(formatActivePppoeUsers(activeUsers));
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch active PPPoE connections.' });
    }
});

router.post('/active/:id/kick', async (req, res) => {
    try {
        const activeId = decodeURIComponent(req.params.id || '');

        if (typeof mikrotikApi.removeActivePppoeConnection === 'function') {
            await mikrotikApi.removeActivePppoeConnection(activeId);
        } else {
            // Fallback for older runtime build: resolve session by id, then reconnect by username.
            const activeSessions = await mikrotikApi.fetchActivePppoeConnections();
            const session = Array.isArray(activeSessions)
                ? activeSessions.find(s => String(s['.id'] || s.id || '') === activeId)
                : null;

            if (!session?.name) {
                throw new Error('Active PPPoE session not found.');
            }

            await mikrotikApi.reconnectPppoeUser(session.name);
        }

        // Give router a moment to update its list
        await new Promise(resolve => setTimeout(resolve, 1000));
        const activeUsers = await mikrotikApi.fetchActivePppoeConnections();
        res.json(formatActivePppoeUsers(activeUsers));
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to kick user.' });
    }
});


// --- PPPoE Users (Cached in DB, actions are live) ---

// GET all users from the local database
router.get('/users', async (req, res) => {
    try {
        const includeActive = ['1', 'true', 'yes'].includes(String(req.query.includeActive || '').toLowerCase());

        // Keep the default route lightweight so pages that only need the cached
        // PPPoE list do not also trigger a live router lookup.
        const [dbUsers] = await pool.query(
            'SELECT id, name, password, service, profile, comment, disabled FROM pppoe_users ORDER BY name ASC'
        );

        if (!includeActive) {
            res.setHeader('X-Router-Online', 'unknown');
            return res.json(
                dbUsers.map(user => ({
                    ...user,
                    disabled: user.disabled === 1,
                }))
            );
        }

        const activeConnections = await mikrotikApi.fetchActivePppoeConnections();
        const activeUsernames = new Set(activeConnections.map(c => c.name));

        res.setHeader('X-Router-Online', activeConnections.length > 0 ? 'true' : 'false');
        return res.json(
            dbUsers.map(user => ({
                ...user,
                disabled: user.disabled === 1,
                active: activeUsernames.has(user.name)
            }))
        );
    } catch (error) {
        console.error("Get PPPoE Users from DB Error:", error);
        res.status(500).json({ message: error.message || 'Failed to fetch PPPoE users from database.' });
    }
});

// POST a new user (Router and DB)
router.post('/users', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const mikrotikResponse = await mikrotikApi.addPppoeUser(req.body);
        const newUserId = mikrotikResponse[0].ret;

        const newUser = {
            id: newUserId,
            name: req.body.name,
            password: req.body.password,
            service: 'pppoe',
            profile: req.body.profile,
            comment: req.body.comment || '',
            disabled: 0,
        };
        await connection.query('INSERT INTO pppoe_users SET ?', newUser);
        await connection.commit();
        
        const [allUsers] = await pool.query('SELECT * FROM pppoe_users');
        res.status(201).json(allUsers.map(u => ({ ...u, disabled: u.disabled === 1 })));
    } catch (error) {
        await connection.rollback();
        console.error("Add PPPoE User Error:", error);
        res.status(500).json({ message: error.message || 'Failed to add PPPoE user.' });
    } finally {
        connection.release();
    }
});

// PUT update a user (Router and DB)
router.put('/users/:id', async (req, res) => {
    try {
        await mikrotikApi.updatePppoeUser(req.params.id, req.body);
        const { name, password, profile, comment } = req.body;
        const fieldsToUpdate = { name, profile, comment };
        if (password) fieldsToUpdate.password = password;
        
        await pool.query('UPDATE pppoe_users SET ? WHERE id = ?', [fieldsToUpdate, req.params.id]);

        const [allUsers] = await pool.query('SELECT * FROM pppoe_users');
        res.json(allUsers.map(u => ({ ...u, disabled: u.disabled === 1 })));
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to update PPPoE user.' });
    }
});

// DELETE a single user (Router and DB)
router.delete('/users/:id', async (req, res) => {
    try {
        await mikrotikApi.deletePppoeUser(req.params.id);
        await pool.query('DELETE FROM pppoe_users WHERE id = ?', [req.params.id]);
        
        const [allUsers] = await pool.query('SELECT * FROM pppoe_users');
        res.json(allUsers.map(u => ({ ...u, disabled: u.disabled === 1 })));
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to delete PPPoE user.' });
    }
});


// POST reconnect a user (Router only, then refetch from DB)
router.post('/users/:username/reconnect', async (req, res) => {
    try {
        await mikrotikApi.reconnectPppoeUser(req.params.username);
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // After action, send back the updated state from the DB + Live status
        const [dbUsers] = await pool.query('SELECT * FROM pppoe_users');
        const activeConnections = await mikrotikApi.fetchActivePppoeConnections();
        const activeUsernames = new Set(activeConnections.map(c => c.name));
        const mergedUsers = dbUsers.map(user => ({
            ...user,
            disabled: user.disabled === 1,
            active: activeUsernames.has(user.name)
        }));
        res.json(mergedUsers);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to reconnect user.' });
    }
});


// POST enable/disable a single user (Router and DB)
router.post('/users/:id/:action(enable|disable)', async (req, res) => {
    const { id, action } = req.params;
    try {
        const isDisabled = action === 'disable';
        if (isDisabled) {
            await mikrotikApi.disablePppoeUser(id);
        } else if (action === 'enable') {
            await mikrotikApi.enablePppoeUser(id);
        } else {
            return res.status(400).json({ message: 'Invalid action.' });
        }
        await pool.query('UPDATE pppoe_users SET disabled = ? WHERE id = ?', [isDisabled ? 1 : 0, id]);
        
        const [allUsers] = await pool.query('SELECT * FROM pppoe_users');
        res.json(allUsers.map(u => ({ ...u, disabled: u.disabled === 1 })));
    } catch (error) {
        res.status(500).json({ message: error.message || `Failed to ${action} user.` });
    }
});


// POST bulk action (enable/disable on Router and DB)
router.post('/users/bulk-action', async (req, res) => {
    const { action, ids } = req.body;
    if (!['enable', 'disable'].includes(action) || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'A valid action and an array of user IDs are required.' });
    }
    try {
        const isDisabled = action === 'disable';
        for (const id of ids) {
            if (isDisabled) {
                await mikrotikApi.disablePppoeUser(id);
            } else {
                await mikrotikApi.enablePppoeUser(id);
            }
        }
        await pool.query('UPDATE pppoe_users SET disabled = ? WHERE id IN (?)', [isDisabled ? 1 : 0, ids]);
        
        const [allUsers] = await pool.query('SELECT * FROM pppoe_users');
        res.json(allUsers.map(u => ({ ...u, disabled: u.disabled === 1 })));
    } catch (error) {
        res.status(500).json({ message: error.message || `Failed to perform bulk ${action}.` });
    }
});

// POST for bulk-delete users (Router and DB)
router.post('/users/bulk-delete', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of user IDs is required for bulk deletion.' });
    }
    try {
        for (const id of ids) {
            await mikrotikApi.deletePppoeUser(id);
        }
        await pool.query('DELETE FROM pppoe_users WHERE id IN (?)', [ids]);
        
        const [allUsers] = await pool.query('SELECT * FROM pppoe_users');
        res.json(allUsers.map(u => ({ ...u, disabled: u.disabled === 1 })));
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to perform bulk delete.' });
    }
});

// --- Sync (The core of the new logic) ---
router.get('/sync/jobs/active', async (req, res) => {
    try {
        const job = await getActivePppoeSyncJob();
        if (!job) {
            return res.json({ success: true, job: null });
        }

        return res.json({ success: true, job: formatPppoeSyncJob(job) });
    } catch (error) {
        console.error('[PPPoE Sync] Error fetching active job:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch active PPPoE sync job.',
        });
    }
});

router.get('/sync/jobs/:jobId', async (req, res) => {
    try {
        const job = await getPppoeSyncJobById(req.params.jobId);
        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'PPPoE sync job not found.',
            });
        }

        return res.json({ success: true, job: formatPppoeSyncJob(job) });
    } catch (error) {
        console.error('[PPPoE Sync] Error fetching job status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch PPPoE sync job status.',
        });
    }
});

router.post('/sync', async (req, res) => {
    console.log('[PPPoE Sync] Enqueue sync job request...');
    try {
        const activeJob = await getActivePppoeSyncJob();
        if (activeJob) {
            return res.status(200).json({
                success: true,
                started: false,
                message: 'PPPoE sync job is already running.',
                job: formatPppoeSyncJob(activeJob),
            });
        }

        const job = await createPppoeSyncJob();

        setImmediate(() => {
            processPppoeSyncQueue().catch((err) => {
                console.error('[PPPoE Sync] Error while starting queued job:', err);
            });
        });

        return res.status(202).json({
            success: true,
            started: true,
            message: 'PPPoE sync job queued and will run in the background.',
            job: formatPppoeSyncJob(job),
        });
    } catch (error) {
        console.error('[PPPoE Sync] Fatal error while enqueueing sync job:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to enqueue PPPoE sync job.',
        });
    }
});

const runPppoeSyncJob = async () => {
    throw new Error('PPPoE sync execution has been moved to backend/jobs/pppoeSyncWorker.js.');
};

// --- PPPoE Profiles (These can remain live as they are small and rarely change) ---
router.get('/profiles', async (req, res) => {
    try {
        const profiles = await mikrotikApi.fetchPppoeProfiles();
        res.json(profiles);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch PPPoE profiles.' });
    }
});

router.post('/profiles', async (req, res) => {
    try {
        await mikrotikApi.addPppoeProfile(req.body);
        res.status(201).json(await mikrotikApi.fetchPppoeProfiles());
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.put('/profiles/:id', async (req, res) => {
    try {
        await mikrotikApi.updatePppoeProfile(req.params.id, req.body);
        res.json(await mikrotikApi.fetchPppoeProfiles());
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.delete('/profiles/:id', async (req, res) => {
    try {
        await mikrotikApi.deletePppoeProfile(req.params.id);
        res.json(await mikrotikApi.fetchPppoeProfiles());
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


export default router;
