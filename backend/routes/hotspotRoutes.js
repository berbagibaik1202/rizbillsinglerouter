

import express from 'express';
import pool from '../db.js';
import mikrotikApi from '../mikrotik-api.js';
import { v4 as uuidv4 } from 'uuid';
import { dbDateToISO, toMySQLDatetime, getSettings } from '../utils.js';

const router = express.Router();

// Helper to format active users from the router
const formatActiveUsers = (users) => {
    if (!Array.isArray(users)) return [];
    // Explicitly map properties to match the frontend `HotspotActiveUser` type.
    // This solves issues with MikroTik's `.id` and `kebab-case` properties.
    return users.map(user => ({
        id: user['.id'], // Correctly map the ID from '.id'
        user: user.user,
        address: user.address,
        uptime: user.uptime,
        bytesIn: parseInt(user['bytes-in'], 10) || 0, // Correctly access 'bytes-in'
        bytesOut: parseInt(user['bytes-out'], 10) || 0, // Correctly access 'bytes-out'
    }));
};

// Helper to keep router calls from hanging forever. Returns fallback on timeout/error.
const withTimeoutFallback = async (promise, fallback, timeoutMs = 7000, label = 'router-call') => {
    let timedOut = false;
    const timeoutPromise = new Promise(resolve => setTimeout(() => {
        timedOut = true;
        console.warn(`[Hotspot Users] ${label} timed out after ${timeoutMs}ms; returning fallback.`);
        resolve(fallback);
    }, timeoutMs));

    try {
        const data = await Promise.race([promise, timeoutPromise]);
        return { data, timedOut, hadError: false };
    } catch (err) {
        console.warn(`[Hotspot Users] ${label} failed:`, err?.message || err);
        return { data: fallback, timedOut, hadError: true };
    }
};


// --- Hotspot Users ---
router.get('/users', async (req, res) => {
    try {
        // Bound router calls so "unlucky" MikroTik instances don't hang the whole request.
        const [routerUsersResult, activeConnectionsResult] = await Promise.all([
            withTimeoutFallback(mikrotikApi.fetchHotspotUsers(), [], 7000, 'fetchHotspotUsers'),
            withTimeoutFallback(mikrotikApi.fetchActiveHotspotConnections(), [], 7000, 'fetchActiveHotspotConnections')
        ]);

        const routerUsers = routerUsersResult.data || [];
        const activeConnections = activeConnectionsResult.data || [];
        const routerOnline = !(
            routerUsersResult.timedOut ||
            activeConnectionsResult.timedOut ||
            routerUsersResult.hadError ||
            activeConnectionsResult.hadError
        );

        if (!routerOnline) {
            console.warn('[Hotspot Users] Router offline or unstable. Serving empty/partial user list.');
        }

        const activeUsernames = new Set(activeConnections.map(c => c.user));
        const users = routerUsers.map(u => ({ ...u, active: activeUsernames.has(u.name) }));

        res.setHeader('X-Router-Online', routerOnline ? 'true' : 'false').json(users);
    } catch (error) {
        console.error('[Hotspot Users] Unexpected error:', error);
        res.status(200).json([]);
    }
});

router.post('/users/bulk-delete', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of user IDs is required.' });
    }

    try {
        for (const id of ids) {
            await mikrotikApi.deleteHotspotUser(id);
        }

        // Fetch the updated list to send back
        const [routerUsers, activeConnections] = await Promise.all([
            mikrotikApi.fetchHotspotUsers(),
            mikrotikApi.fetchActiveHotspotConnections()
        ]);
        const activeUsernames = new Set(activeConnections.map(c => c.user));
        const users = routerUsers.map(u => ({ ...u, active: activeUsernames.has(u.name) }));
        
        res.json(users);
    } catch (error) {
        console.error('Hotspot Bulk Delete Error:', error);
        res.status(500).json({ message: error.message || 'Failed to perform bulk delete.' });
    }
});


router.post('/users/:id/:action', async (req, res) => {
    const { id, action } = req.params;
    try {
        if (action === 'enable') {
            await mikrotikApi.enableHotspotUser(id);
        } else if (action === 'disable') {
            await mikrotikApi.disableHotspotUser(id);
        } else {
            return res.status(400).json({ message: 'Invalid action.' });
        }
        
        const [routerUsers, activeConnections] = await Promise.all([
            mikrotikApi.fetchHotspotUsers(),
            mikrotikApi.fetchActiveHotspotConnections()
        ]);
        const activeUsernames = new Set(activeConnections.map(c => c.user));
        const users = routerUsers.map(u => ({ ...u, active: activeUsernames.has(u.name) }));
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: error.message || `Failed to ${action} user.` });
    }
});


// --- Hotspot Profiles ---
// Fast, DB-only fetch for initial page load
router.get('/profiles', async (req, res) => {
    try {
        const [profiles] = await pool.query(`
            SELECT hp.id, hp.name, hp.rateLimit, hp.sharedUsers, hp.price, hp.sellingPrice, hp.duration_minutes, COUNT(hu.id) as userCount 
            FROM hotspot_profiles hp 
            LEFT JOIN hotspot_users hu ON hp.name = hu.profile 
            GROUP BY hp.id, hp.name, hp.rateLimit, hp.sharedUsers, hp.price, hp.sellingPrice, hp.duration_minutes
            ORDER BY hp.name
        `);
        res.json(profiles);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch Hotspot profiles from database.' });
    }
});

// Slow, manual sync with router
router.post('/profiles/sync', async (req, res) => {
    try {
        const [dbProfiles] = await pool.query('SELECT name, price, sellingPrice, duration_minutes FROM hotspot_profiles');
        const priceMap = dbProfiles.reduce((acc, p) => {
            acc[p.name] = { price: p.price, sellingPrice: p.sellingPrice, duration_minutes: p.duration_minutes };
            return acc;
        }, {});

        const routerProfiles = await mikrotikApi.fetchHotspotProfiles();
        
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            const routerProfileNames = new Set(routerProfiles.map(p => p.name));
            const [dbProfilesForDeletion] = await connection.query('SELECT name FROM hotspot_profiles');
            for (const dbProfile of dbProfilesForDeletion) {
                if (!routerProfileNames.has(dbProfile.name)) {
                    await connection.query('DELETE FROM hotspot_profiles WHERE name = ?', [dbProfile.name]);
                }
            }
            
            if (routerProfiles.length > 0) {
                for (const profile of routerProfiles) {
                    const localData = priceMap[profile.name] || { price: 0, sellingPrice: 0, duration_minutes: null };
                    await connection.query(
                        `INSERT INTO hotspot_profiles (id, name, rateLimit, sharedUsers, price, sellingPrice, duration_minutes) 
                         VALUES (?, ?, ?, ?, ?, ?, ?) 
                         ON DUPLICATE KEY UPDATE 
                         id = VALUES(id),
                         rateLimit = VALUES(rateLimit), 
                         sharedUsers = VALUES(sharedUsers)`,
                        [profile.id, profile.name, profile.rateLimit, profile.sharedUsers, localData.price, localData.sellingPrice, localData.duration_minutes]
                    );
                }
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        
        const [profiles] = await pool.query(`
            SELECT hp.id, hp.name, hp.rateLimit, hp.sharedUsers, hp.price, hp.sellingPrice, hp.duration_minutes, COUNT(hu.id) as userCount 
            FROM hotspot_profiles hp 
            LEFT JOIN hotspot_users hu ON hp.name = hu.profile 
            GROUP BY hp.id, hp.name, hp.rateLimit, hp.sharedUsers, hp.price, hp.sellingPrice, hp.duration_minutes
            ORDER BY hp.name
        `);
        res.json(profiles);

    } catch (error) {
        console.error('Hotspot Profile Sync Error:', error);
        res.status(500).json({ message: error.message || 'Failed to sync profiles with router.' });
    }
});


router.post('/profiles', async (req, res) => {
    try {
        const { name, rateLimit, sharedUsers, price, sellingPrice, duration_minutes } = req.body;
        await mikrotikApi.addHotspotProfile(req.body);
        
        const allRouterProfiles = await mikrotikApi.fetchHotspotProfiles();
        const newProfileOnRouter = allRouterProfiles.find(p => p.name === name);
        if (!newProfileOnRouter) {
            throw new Error("Could not find newly created profile on router. It might have failed silently.");
        }

        await pool.query(
            'INSERT INTO hotspot_profiles (id, name, rateLimit, sharedUsers, price, sellingPrice, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newProfileOnRouter.id, name, rateLimit || '', sharedUsers || 1, price || 0, sellingPrice || 0, duration_minutes || null]
        );
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.put('/profiles/:id', async (req, res) => {
    try {
        const profilesBeforeUpdate = await mikrotikApi.fetchHotspotProfiles();
        const profileToUpdate = profilesBeforeUpdate.find(p => p.id === req.params.id);
        if (!profileToUpdate) {
            return res.status(404).json({ message: 'Profile not found on router.' });
        }

        await mikrotikApi.updateHotspotProfile(req.params.id, req.body);
        
        const { price, sellingPrice, rateLimit, sharedUsers, duration_minutes } = req.body;
        await pool.query(
            'UPDATE hotspot_profiles SET price = ?, sellingPrice = ?, rateLimit = ?, sharedUsers = ?, duration_minutes = ? WHERE name = ?',
            [price || 0, sellingPrice || 0, rateLimit || '', sharedUsers || 1, duration_minutes || null, profileToUpdate.name]
        );
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.delete('/profiles/:id', async (req, res) => {
    try {
        const profilesBeforeDelete = await mikrotikApi.fetchHotspotProfiles();
        const profileToDelete = profilesBeforeDelete.find(p => p.id === req.params.id);
        
        await mikrotikApi.deleteHotspotProfile(req.params.id);

        if (profileToDelete) {
            await pool.query('DELETE FROM hotspot_profiles WHERE name = ?', [profileToDelete.name]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


// --- Hotspot Active Users ---
router.get('/active', async (req, res) => {
    try {
        const activeUsers = await mikrotikApi.fetchActiveHotspotConnections();
        res.json(formatActiveUsers(activeUsers));
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch active users.' });
    }
});

router.post('/active/:id/kick', async (req, res) => {
    try {
        await mikrotikApi.removeActiveHotspotUser(req.params.id);
        // Give router a moment to update its list of active users
        await new Promise(resolve => setTimeout(resolve, 1000));
        const activeUsers = await mikrotikApi.fetchActiveHotspotConnections();
        res.json(formatActiveUsers(activeUsers));
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to kick user.' });
    }
});


// --- Hotspot Vouchers ---
router.get('/vouchers', async (req, res) => {
    try {
        const [vouchersFromDb] = await pool.query('SELECT * FROM hotspot_vouchers ORDER BY created_at DESC');
        const formattedVouchers = vouchersFromDb.map(voucher => ({
            ...voucher,
            created_at: dbDateToISO(voucher.created_at),
            first_used_at: dbDateToISO(voucher.first_used_at),
            expires_at: dbDateToISO(voucher.expires_at),
            active: false,
            uptime: null,
            totalUptime: null,
        }));
        res.json(formattedVouchers);
    } catch (error) {
        console.error("Error fetching hotspot vouchers:", error);
        res.status(500).json({ message: error.message || 'Failed to fetch vouchers.' });
    }
});

router.get('/vouchers/live-status', async (req, res) => {
    try {
        // 1. Get live data from router
        const [activeConnections, routerUsers] = await Promise.all([
            mikrotikApi.fetchActiveHotspotConnections(),
            mikrotikApi.fetchHotspotUsers(),
        ]);

        const liveDataMap = {};
        // Map totalUptime from router user list
        for (const routerUser of routerUsers) {
            if (!liveDataMap[routerUser.name]) liveDataMap[routerUser.name] = {};
            liveDataMap[routerUser.name].totalUptime = routerUser.totalUptime;
        }
        // Map active status and session uptime from active connections list
        for (const activeUser of activeConnections) {
            if (!liveDataMap[activeUser.user]) liveDataMap[activeUser.user] = {};
            liveDataMap[activeUser.user].active = true;
            liveDataMap[activeUser.user].uptime = activeUser.uptime;
        }

        // 2. Get all vouchers from DB
        const [vouchersFromDb] = await pool.query('SELECT * FROM hotspot_vouchers ORDER BY created_at DESC');

        // Fetch settings to determine timezone
        const settings = await getSettings();
        const timezone = settings.app.timezone;

        // 3. Merge and format
        const mergedVouchers = [];
        for (const voucher of vouchersFromDb) {
            const liveData = liveDataMap[voucher.username];
            let updatedVoucher = { ...voucher };

            // Fallback for missed webhook: If router says a 'new' voucher is active, activate it in the DB.
            if (liveData?.active && voucher.status === 'new' && !voucher.first_used_at) {
                console.log(`[Live Status Sync] Activating voucher ${voucher.username} (webhook fallback).`);
                
                // Use fixed time calculation in NodeJS to be timezone agnostic regarding DB server
                const now = new Date();
                const expiresAt = new Date(now.getTime() + voucher.duration_minutes * 60000);
                
                const nowStr = toMySQLDatetime(now, timezone);
                const expiresAtStr = toMySQLDatetime(expiresAt, timezone);

                await pool.query(
                    "UPDATE hotspot_vouchers SET status = 'active', first_used_at = ?, expires_at = ? WHERE id = ?", 
                    [nowStr, expiresAtStr, voucher.id]
                );

                // Update the local object before proceeding
                updatedVoucher.status = 'active';
                updatedVoucher.first_used_at = nowStr;
                updatedVoucher.expires_at = expiresAtStr;
            }

            const finalVoucherData = {
                ...updatedVoucher,
                created_at: dbDateToISO(voucher.created_at),
                first_used_at: dbDateToISO(updatedVoucher.first_used_at),
                expires_at: dbDateToISO(updatedVoucher.expires_at),
                active: liveData?.active || false,
                uptime: liveData?.uptime || null,
                totalUptime: liveData?.totalUptime || voucher.totalUptime || null,
            };
            
            // Re-apply expiration logic on the server to ensure consistency
            if (finalVoucherData.status === 'active' && finalVoucherData.expires_at && new Date(finalVoucherData.expires_at) <= new Date()) {
                finalVoucherData.status = 'expired';
                 if (voucher.status !== 'expired') {
                    await pool.query("UPDATE hotspot_vouchers SET status = 'expired' WHERE id = ?", [voucher.id]);
                }
            }
            
            mergedVouchers.push(finalVoucherData);
        }

        res.json(mergedVouchers);
    } catch (error) {
        console.error("Error fetching hotspot live status:", error);
        res.status(500).json({ message: error.message || 'Failed to fetch live status.' });
    }
});

// New endpoint for fetching total uptime for a single user
router.get('/vouchers/:username/total-uptime', async (req, res) => {
    const { username } = req.params;
    if (!username) {
        return res.status(400).json({ message: "Username is required." });
    }
    try {
        const routerUsers = await mikrotikApi.fetchHotspotUsers();
        const user = routerUsers.find(u => u.name === username);
        res.json({ totalUptime: user?.totalUptime || '0s' });
    } catch (error) {
        console.error(`Error fetching total uptime for ${username}:`, error);
        res.status(500).json({ message: error.message || 'Failed to fetch total uptime.' });
    }
});


router.post('/vouchers/generate', async (req, res) => {
    const { count, profile, durationMinutes, usernameLength, prefix } = req.body;
    try {
        const settings = await getSettings();
        const timezone = settings.app.timezone;

        const generatedVouchers = [];
        for (let i = 0; i < count; i++) {
            const randomPart = uuidv4().replace(/-/g, '');
            const username = (prefix || '') + randomPart.substring(0, usernameLength);
            const password = username;
            
            const createdAt = new Date();
            const createdAtStr = toMySQLDatetime(createdAt, timezone);

            const mikrotikUser = {
                name: username, password, profile,
                comment: `Voucher - ${Math.round(durationMinutes)}min`,
            };
            const result = await mikrotikApi.addHotspotUser(mikrotikUser);
            
            const [dbResult] = await pool.query(
                'INSERT INTO hotspot_vouchers (username, password, profile, duration_minutes, status, created_at, mikrotik_id) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                [username, password, profile, durationMinutes, 'new', createdAtStr, result.id]
            );
            
            generatedVouchers.push({
                id: dbResult.insertId, username, password, profile, duration_minutes: durationMinutes,
                status: 'new', created_at: createdAt.toISOString(), mikrotik_id: result.id,
                first_used_at: null, expires_at: null, active: false
            });
        }
        res.status(201).json(generatedVouchers);
    } catch (error) {
        console.error("Error generating vouchers:", error);
        res.status(500).json({ message: error.message || 'Failed to generate vouchers.' });
    }
});

router.post('/vouchers/bulk-reseller', async (req, res) => {
    const { profileName, quantity, soldByUserId } = req.body;
    if (!profileName || !quantity || !soldByUserId) {
        return res.status(400).json({ message: 'Profile, quantity, and seller ID are required.' });
    }
    if (quantity <= 0 || quantity > 100) {
        return res.status(400).json({ message: 'Quantity must be between 1 and 100.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const settings = await getSettings();
        const timezone = settings.app.timezone;

        const [[reseller]] = await connection.query('SELECT balance FROM users WHERE id = ? AND role = "reseller" FOR UPDATE', [soldByUserId]);
        if (!reseller) {
            await connection.rollback();
            return res.status(404).json({ message: 'Reseller not found.' });
        }

        const [[profileData]] = await connection.query('SELECT price, sellingPrice, duration_minutes FROM hotspot_profiles WHERE name = ?', [profileName]);
        if (!profileData || profileData.price === null || profileData.sellingPrice === null) {
            await connection.rollback();
            return res.status(400).json({ message: 'This profile is not configured for sale.' });
        }
        
        const basePrice = Number(profileData.price);
        const sellingPrice = Number(profileData.sellingPrice);
        const totalCost = basePrice * quantity;

        if (Number(reseller.balance) < totalCost) {
            await connection.rollback();
            return res.status(400).json({ message: `Insufficient balance. Required: ${totalCost}, Available: ${reseller.balance}` });
        }
        
        const finalDuration = profileData.duration_minutes;
        const newlyCreatedVouchers = [];

        for (let i = 0; i < quantity; i++) {
            const username = uuidv4().replace(/-/g, '').substring(0, 8);
            const password = username;
            const createdAt = new Date();
            const createdAtStr = toMySQLDatetime(createdAt, timezone);

            const mikrotikUser = { 
                name: username, 
                password, 
                profile: profileName, 
                comment: `Resold by ${soldByUserId} (${finalDuration}m)` 
            };
            const result = await mikrotikApi.addHotspotUser(mikrotikUser);

            const newVoucherData = {
                username, password, profile: profileName, duration_minutes: finalDuration,
                status: 'new', created_at: createdAtStr, mikrotik_id: result.id,
                sold_by_user_id: soldByUserId
            };
            const [dbResult] = await connection.query('INSERT INTO hotspot_vouchers SET ?', newVoucherData);

            await connection.query('INSERT INTO payments SET ?', {
                id: `PAY-V-${Date.now()}-${i}`,
                invoiceId: `Voucher: ${username}`,
                customerId: null,
                date: createdAtStr,
                amount: sellingPrice,
                method: 'Cash',
                sold_by_user_id: soldByUserId
            });

            newlyCreatedVouchers.push({
                id: dbResult.insertId,
                username, password, profile: profileName, duration_minutes: finalDuration,
                status: 'new', created_at: createdAt.toISOString(), mikrotik_id: result.id,
                first_used_at: null, expires_at: null, active: false,
                sold_by_user_id: soldByUserId
            });
        }
        
        await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [totalCost, soldByUserId]);

        await connection.commit();

        res.status(201).json(newlyCreatedVouchers);
    } catch (error) {
        await connection.rollback();
        console.error("Error creating bulk reseller vouchers:", error);
        res.status(500).json({ message: error.message || 'Failed to create reseller vouchers.' });
    } finally {
        connection.release();
    }
});

router.post('/vouchers/manual', async (req, res) => {
    const { username, password, profile, durationMinutes } = req.body;
    if (!username || !password || !profile || !durationMinutes) {
        return res.status(400).json({ message: 'Username, password, profile, and duration are required.' });
    }

    try {
        const settings = await getSettings();
        const timezone = settings.app.timezone;

        const [[profileData]] = await pool.query('SELECT sellingPrice FROM hotspot_profiles WHERE name = ?', [profile]);
        const sellingPrice = profileData ? profileData.sellingPrice : 0;
        
        const routerUsers = await mikrotikApi.fetchHotspotUsers();
        if (routerUsers.some(u => u.name === username)) {
            return res.status(409).json({ message: `Username "${username}" already exists on the router.` });
        }
        const [[existingDbVoucher]] = await pool.query('SELECT id FROM hotspot_vouchers WHERE username = ?', [username]);
        if (existingDbVoucher) {
            return res.status(409).json({ message: `Username "${username}" already exists in the local database.` });
        }

        const createdAt = new Date();
        const createdAtStr = toMySQLDatetime(createdAt, timezone);

        const mikrotikUser = {
            name: username, password, profile,
            comment: `Voucher (Manual) - ${durationMinutes}min`,
        };
        const result = await mikrotikApi.addHotspotUser(mikrotikUser);

        const newVoucherData = {
            username, password, profile, duration_minutes: durationMinutes,
            status: 'new', created_at: createdAtStr, mikrotik_id: result.id
        };

        const [dbResult] = await pool.query('INSERT INTO hotspot_vouchers SET ?', newVoucherData);
        
        if (sellingPrice > 0) {
            await pool.query('INSERT INTO payments SET ?', {
                id: `PAY-V-${Date.now()}`,
                invoiceId: `Voucher: ${username}`,
                customerId: null,
                date: createdAtStr,
                amount: sellingPrice,
                method: 'Cash'
            });
        }

        const responseVoucher = {
            id: dbResult.insertId, ...newVoucherData,
            created_at: createdAt.toISOString(), active: false
        };
        
        res.status(201).json(responseVoucher);
    } catch (error) {
        console.error("Error creating manual voucher:", error);
        res.status(500).json({ message: error.message || 'Failed to create manual voucher.' });
    }
});

router.post('/vouchers/manual-reseller', async (req, res) => {
    const { profile, durationMinutes, soldByUserId } = req.body;
    if (!profile || !durationMinutes || !soldByUserId) {
        return res.status(400).json({ message: 'Profile, duration, and seller ID are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const settings = await getSettings();
        const timezone = settings.app.timezone;

        const [[reseller]] = await connection.query('SELECT balance FROM users WHERE id = ? AND role = "reseller" FOR UPDATE', [soldByUserId]);
        if (!reseller) {
            await connection.rollback();
            return res.status(404).json({ message: 'Reseller not found.' });
        }

        const [[profileData]] = await connection.query('SELECT price, sellingPrice FROM hotspot_profiles WHERE name = ?', [profile]);
        if (!profileData || profileData.price === null || profileData.sellingPrice === null) {
            await connection.rollback();
            return res.status(400).json({ message: 'This profile is not configured for sale.' });
        }

        const basePrice = profileData.price;
        const sellingPrice = profileData.sellingPrice;

        if (Number(reseller.balance) < Number(basePrice)) {
            await connection.rollback();
            return res.status(400).json({ message: `Insufficient balance. Required: ${basePrice}, Available: ${reseller.balance}` });
        }

        const username = uuidv4().slice(0, 8);
        const password = username;
        const createdAt = new Date();
        const createdAtStr = toMySQLDatetime(createdAt, timezone);

        const mikrotikUser = { name: username, password, profile, comment: `Resold by ${soldByUserId}` };
        const result = await mikrotikApi.addHotspotUser(mikrotikUser);

        const newVoucherData = {
            username, password, profile, duration_minutes: durationMinutes,
            status: 'new', created_at: createdAtStr, mikrotik_id: result.id
        };
        const [dbResult] = await connection.query('INSERT INTO hotspot_vouchers SET ?', newVoucherData);

        await connection.query('INSERT INTO payments SET ?', {
            id: `PAY-V-${Date.now()}`,
            invoiceId: `Voucher: ${username}`,
            customerId: null,
            date: createdAtStr,
            amount: sellingPrice,
            method: 'Cash',
            sold_by_user_id: soldByUserId
        });

        await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [basePrice, soldByUserId]);

        await connection.commit();
        
        const responseVoucher = {
            id: dbResult.insertId,
            username, password, profile, duration_minutes: durationMinutes,
            status: 'new', created_at: createdAt.toISOString(), mikrotik_id: result.id,
            first_used_at: null, expires_at: null, active: false
        };

        res.status(201).json(responseVoucher);
    } catch (error) {
        await connection.rollback();
        console.error("Error creating reseller voucher:", error);
        res.status(500).json({ message: error.message || 'Failed to create reseller voucher.' });
    }
});


router.delete('/vouchers/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [[voucher]] = await pool.query('SELECT * FROM hotspot_vouchers WHERE id = ?', [id]);
        if (!voucher) return res.status(404).json({ message: 'Voucher not found in DB.' });
        
        if (voucher.mikrotik_id) {
            try {
                await mikrotikApi.deleteHotspotUser(voucher.mikrotik_id);
            } catch (e) {
                console.warn(`Could not delete user ${voucher.mikrotik_id} from router (may already be deleted): ${e.message}`);
            }
        }
        await pool.query('DELETE FROM hotspot_vouchers WHERE id = ?', [id]);
        
        const [vouchersFromDb] = await pool.query('SELECT * FROM hotspot_vouchers ORDER BY created_at DESC');
        const formattedVouchers = vouchersFromDb.map(v => ({...v, created_at: dbDateToISO(v.created_at)}));
        res.json(formattedVouchers);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post('/vouchers/bulk-delete', async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of voucher IDs is required.' });
    }
    try {
        const [vouchers] = await pool.query('SELECT * FROM hotspot_vouchers WHERE id IN (?)', [ids]);
        for (const voucher of vouchers) {
            if (voucher.mikrotik_id) {
                try {
                    await mikrotikApi.deleteHotspotUser(voucher.mikrotik_id);
                } catch(e) {
                     console.warn(`Could not delete user ${voucher.mikrotik_id} from router (may already be deleted): ${e.message}`);
                }
            }
        }
        await pool.query('DELETE FROM hotspot_vouchers WHERE id IN (?)', [ids]);
        const [vouchersFromDb] = await pool.query('SELECT * FROM hotspot_vouchers ORDER BY created_at DESC');
        const formattedVouchers = vouchersFromDb.map(v => ({...v, created_at: dbDateToISO(v.created_at)}));
        res.json(formattedVouchers);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- Sync Hotspot Users and Profiles with DB (optional, good for consistency) ---
router.post('/sync', async (req, res) => {
    try {
        // Sync Users
        const routerUsers = await mikrotikApi.fetchHotspotUsers();

        // FIX: De-duplicate users coming from the router before inserting
        const uniqueUsers = [];
        const seenNames = new Set();
        for (const user of routerUsers) {
            if (!seenNames.has(user.name)) {
                uniqueUsers.push(user);
                seenNames.add(user.name);
            } else {
                console.warn(`[Hotspot Sync] Duplicate username '${user.name}' found on router. Skipping subsequent entry.`);
            }
        }

        await pool.query('TRUNCATE TABLE hotspot_users');
        if (uniqueUsers.length > 0) {
            const usersToInsert = uniqueUsers.map(u => [u.id, u.name, u.password, u.profile, u.comment, u.disabled ? 1 : 0]);
            await pool.query('INSERT INTO hotspot_users (id, name, password, profile, comment, disabled) VALUES ?', [usersToInsert]);
        }
        
        // Sync Profiles but preserve prices
        const [dbProfiles] = await pool.query('SELECT name, price, sellingPrice, duration_minutes FROM hotspot_profiles');
        const priceMap = dbProfiles.reduce((acc, p) => ({ ...acc, [p.name]: { price: p.price, sellingPrice: p.sellingPrice, duration_minutes: p.duration_minutes } }), {});

        const routerProfiles = await mikrotikApi.fetchHotspotProfiles();
        if (routerProfiles.length > 0) {
            for(const profile of routerProfiles) {
                const localData = priceMap[profile.name] || { price: 0, sellingPrice: 0, duration_minutes: null };
                await pool.query(
                    `INSERT INTO hotspot_profiles (id, name, rateLimit, sharedUsers, price, sellingPrice, duration_minutes) 
                     VALUES (?, ?, ?, ?, ?, ?, ?) 
                     ON DUPLICATE KEY UPDATE 
                     id = VALUES(id),
                     rateLimit = VALUES(rateLimit), 
                     sharedUsers = VALUES(sharedUsers)`,
                    [profile.id, profile.name, profile.rateLimit, profile.sharedUsers, localData.price, localData.sellingPrice, localData.duration_minutes]
                );
            }
        }
        res.json({ success: true, message: `Synced ${uniqueUsers.length} users and ${routerProfiles.length} profiles.` });
    } catch (error) {
        console.error("Hotspot Sync Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/webhook', async (req, res) => {
    const { event, username } = req.body;
    console.log(`[Hotspot Webhook] Received payload:`, req.body);

    if (event !== 'login' || !username) {
        return res.status(200).send('Webhook processed (event ignored).');
    }

    try {
        const settings = await getSettings();
        const timezone = settings.app.timezone;
        const [[voucher]] = await pool.query("SELECT * FROM hotspot_vouchers WHERE username = ?", [username]);

        if (!voucher) {
            console.log(`[Hotspot Webhook] Login event for non-voucher user: ${username}. No action taken.`);
            return res.status(200).send('Webhook processed (non-voucher).');
        }

        // KONDISI BARU: Validasi "Just-In-Time" untuk voucher yang kadaluarsa
        // Ini menangani kasus di mana cron job gagal menonaktifkan voucher di MikroTik.
        if (voucher.status === 'expired' || (voucher.expires_at && new Date(voucher.expires_at) <= new Date())) {
            console.warn(`[Hotspot Webhook] EXPIRED voucher ${username} attempted login. Executing disable and kick.`);

            // Amankan dengan menonaktifkan dan menendang pengguna dari router
            if (voucher.mikrotik_id) {
                try {
                    await mikrotikApi.disableHotspotUser(voucher.mikrotik_id);
                    console.log(`[Hotspot Webhook] User ${username} (Mikrotik ID: ${voucher.mikrotik_id}) disabled on router.`);
                } catch (e) {
                    console.error(`[Hotspot Webhook] Failed to disable user ${username} via mikrotik_id ${voucher.mikrotik_id}:`, e.message);
                }
            }

            const activeSessions = await mikrotikApi.fetchActiveHotspotConnections();
            const session = activeSessions.find(s => s.user === username);

            if (session) {
                try {
                    await mikrotikApi.removeActiveHotspotUser(session['.id']);
                    console.log(`[Hotspot Webhook] Active session for ${username} (ID: ${session['.id']}) removed (kicked).`);
                } catch (e) {
                    console.error(`[Hotspot Webhook] Failed to kick session for ${username}:`, e.message);
                }
            }
            
            // Pastikan status DB adalah 'expired'
            if (voucher.status !== 'expired') {
                await pool.query("UPDATE hotspot_vouchers SET status = 'expired' WHERE id = ?", [voucher.id]);
            }
        
        // KONDISI 1: Voucher baru digunakan pertama kali
        } else if (voucher.status === 'new' && !voucher.first_used_at) {
            console.log(`[Hotspot Webhook] First use detected for voucher: ${username}. Activating now.`);
            const now = new Date();
            const expiresAt = new Date(now.getTime() + voucher.duration_minutes * 60000);
            const nowStr = toMySQLDatetime(now, timezone);
            const expiresAtStr = toMySQLDatetime(expiresAt, timezone);

            await pool.query(
                "UPDATE hotspot_vouchers SET status = 'active', first_used_at = ?, expires_at = ? WHERE id = ?", 
                [nowStr, expiresAtStr, voucher.id]
            );
            console.log(`[Hotspot Webhook] Voucher ${username} activated. Expires at ${expiresAtStr}.`);
        
        // KONDISI 3: Voucher aktif dan belum kadaluarsa
        } else if (voucher.status === 'active') {
             console.log(`[Hotspot Webhook] Login event for active (and valid) voucher: ${username}. No action needed.`);
        }

        res.status(200).send('Webhook processed.');
    } catch (error) {
        console.error('[Hotspot Webhook] Error processing login event:', error);
        res.status(500).send('Internal Server Error');
    }
});


export default router;
