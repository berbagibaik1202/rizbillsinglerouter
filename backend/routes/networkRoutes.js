// backend/routes/networkRoutes.js

import express from 'express';
import pool from '../db.js';
import mikrotikApi from '../mikrotik-api.js';

const router = express.Router();

const ROUTE_CACHE_TTL_MS = 60 * 60 * 1000;
const routeCache = new Map();
let routeOverridesTableReady = false;

const clampCoordPrecision = (value) => Number(Number(value).toFixed(6));
const buildRouteCacheKey = (startLat, startLng, endLat, endLng) => (
    `${clampCoordPrecision(startLat)},${clampCoordPrecision(startLng)}:${clampCoordPrecision(endLat)},${clampCoordPrecision(endLng)}`
);

const readRouteCache = (key) => {
    const cached = routeCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.ts > ROUTE_CACHE_TTL_MS) {
        routeCache.delete(key);
        return null;
    }
    return cached.path;
};

const writeRouteCache = (key, path) => {
    if (!Array.isArray(path) || path.length < 2) return;
    routeCache.set(key, { ts: Date.now(), path });
};

const straightLinePath = (startLat, startLng, endLat, endLng) => ([
    { lat: startLat, lng: startLng },
    { lat: endLat, lng: endLng },
]);

const toRad = (deg) => (deg * Math.PI) / 180;
const haversineDistanceKm = (a, b) => {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const x = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return R * c;
};

const pathDistanceKm = (path) => {
    if (!Array.isArray(path) || path.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < path.length; i += 1) {
        total += haversineDistanceKm(path[i - 1], path[i]);
    }
    return total;
};

const ensureRouteOverridesTable = async () => {
    if (routeOverridesTableReady) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS network_route_overrides (
            edge_key VARCHAR(255) PRIMARY KEY,
            path JSON NOT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    routeOverridesTableReady = true;
};

const normalizePathPayload = (path) => {
    if (!Array.isArray(path) || path.length < 2) return null;
    const normalized = path
        .map((point) => ({
            lat: Number(point?.lat),
            lng: Number(point?.lng),
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    return normalized.length >= 2 ? normalized : null;
};

const parseStoredJson = (value, fallback = null, context = 'unknown') => {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;

    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (error) {
            console.warn(`[Network] Failed to parse JSON for ${context}:`, value);
            console.warn(error?.stack || error);
            return fallback;
        }
    }

    return fallback;
};


// --- ODCs ---
router.get('/odcs', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM odcs');
        const formattedRows = rows.map(o => ({
            ...o,
            location: parseStoredJson(o.location, null, `odcs.${o.id}.location`),
        }));
        res.json(formattedRows);
    } catch (e) {
        console.error('Error reading ODC data:', e);
        res.status(500).json({ message: 'Error reading ODC data' });
    }
});

router.post('/odcs', async (req, res) => {
    try {
        const newOdc = { ...req.body, id: `ODC-${Date.now()}`, location: req.body.location ? JSON.stringify(req.body.location) : null };
        await pool.query('INSERT INTO odcs SET ?', newOdc);
        res.status(201).json(newOdc);
    } catch (e) {
        console.error("Error creating ODC:", e);
        res.status(500).send('Error creating ODC');
    }
});

router.put('/odcs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const odcData = { ...req.body, location: req.body.location ? JSON.stringify(req.body.location) : null };
        delete odcData.id;
        await pool.query('UPDATE odcs SET ? WHERE id = ?', [odcData, id]);
        res.json({ ...odcData, id });
    } catch (e) {
        console.error("Error updating ODC:", e);
        res.status(500).send('Error updating ODC');
    }
});

router.delete('/odcs/:id', async (req, res) => {
    try {
        // Cek apakah ada ODP yang menjadikan ODC ini sebagai parent
        const [odps] = await pool.query('SELECT COUNT(*) as count FROM odps WHERE parentId = ?', [req.params.id]);
        if (odps[0].count > 0) {
            return res.status(400).json({ message: `Cannot delete ODC as it is a parent to ${odps[0].count} ODP(s).` });
        }
        // Cek apakah ada ODC lain yang menjadikan ODC ini sebagai parent
        const [odcs] = await pool.query('SELECT COUNT(*) as count FROM odcs WHERE parentId = ?', [req.params.id]);
        if (odcs[0].count > 0) {
            return res.status(400).json({ message: `Cannot delete ODC as it is a parent to ${odcs[0].count} other ODC(s).` });
        }
        await pool.query('DELETE FROM odcs WHERE id = ?', [req.params.id]);
        res.status(204).send();
    } catch (e) {
        console.error("Error deleting ODC:", e);
        res.status(500).send('Error deleting ODC');
    }
});


// --- ODPs ---
router.get('/odps', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM odps');
        const formattedRows = rows.map(o => ({
            ...o,
            location: parseStoredJson(o.location, null, `odps.${o.id}.location`),
        }));
        res.json(formattedRows);
    } catch (e) {
        console.error('Error reading ODP data:', e);
        res.status(500).json({ message: 'Error reading ODP data' });
    }
});

router.post('/odps', async (req, res) => {
    try {
        const newOdp = { ...req.body, id: `ODP-${Date.now()}`, location: req.body.location ? JSON.stringify(req.body.location) : null };
        await pool.query('INSERT INTO odps SET ?', newOdp);
        res.status(201).json(newOdp);
    } catch (e) { 
        console.error("Error creating ODP:", e);
        res.status(500).send('Error creating ODP'); 
    }
});

router.put('/odps/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const odpData = { ...req.body, location: req.body.location ? JSON.stringify(req.body.location) : null };
        delete odpData.id;
        await pool.query('UPDATE odps SET ? WHERE id = ?', [odpData, id]);
        res.json({ ...odpData, id });
    } catch (e) { 
        console.error("Error updating ODP:", e);
        res.status(500).send('Error updating ODP'); 
    }
});

router.delete('/odps/:id', async (req, res) => {
    try {
        const [customers] = await pool.query('SELECT COUNT(*) as count FROM customers WHERE odpId = ?', [req.params.id]);
        if (customers[0].count > 0) {
            return res.status(400).json({ message: `Cannot delete ODP as it is linked to ${customers[0].count} customer(s).` });
        }
        await pool.query('DELETE FROM odps WHERE id = ?', [req.params.id]);
        res.status(204).send();
    } catch (e) { 
        console.error("Error deleting ODP:", e);
        res.status(500).send('Error deleting ODP'); 
    }
});


// --- Packages ---
router.get('/packages', async (req, res) => {
    try {
        const { role, id: customerId } = req.user; // User's JWT payload
        
        let query = 'SELECT * FROM packages';
        const params = [];

        if (role === 'customer') {
            // Fetch the customer's current packageId to ensure it's included
            const [[customer]] = await pool.query('SELECT packageId FROM customers WHERE id = ?', [customerId]);
            const customerPackageId = customer ? customer.packageId : null;

            if (customerPackageId) {
                // Fetch all taxable packages OR the customer's own specific package
                query += ' WHERE useTax = 1 OR id = ?';
                params.push(customerPackageId);
            } else {
                // If customer has no package, just fetch the taxable ones for selection
                query += ' WHERE useTax = 1';
            }
        }

        query += ' ORDER BY price ASC';

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (e) { 
        console.error("Error fetching packages:", e);
        res.status(500).send('Error reading packages data'); 
    }
});

router.post('/packages', async (req, res) => {
    try {
        const newPackage = req.body;
        const [result] = await pool.query('INSERT INTO packages SET ?', newPackage);
        res.status(201).json({ id: result.insertId, ...newPackage });
    } catch (e) { res.status(500).send('Error creating package'); }
});

router.put('/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const packageData = req.body;
        delete packageData.id;
        await pool.query('UPDATE packages SET ? WHERE id = ?', [packageData, id]);
        res.json({ id: parseInt(id), ...packageData });
    } catch (e) { res.status(500).send('Error updating package'); }
});

router.delete('/packages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [customers] = await pool.query('SELECT COUNT(*) as count FROM customers WHERE packageId = ?', [id]);
        if (customers[0].count > 0) {
            return res.status(400).json({ message: `Cannot delete package as it is in use by ${customers[0].count} customer(s).` });
        }
        await pool.query('DELETE FROM packages WHERE id = ?', [id]);
        res.status(204).send();
    } catch (e) { res.status(500).send('Error deleting package'); }
});


// --- Real Snap-to-Road Endpoint (using OSRM) ---
router.get('/get-road-path', async (req, res) => {
    const { startLat, startLng, endLat, endLng, mode, maxDetourRatio, edgeKey } = req.query;

    if (!startLat || !startLng || !endLat || !endLng) {
        return res.status(400).json({ message: 'Missing required location parameters.' });
    }

    const startLatNum = Number(startLat);
    const startLngNum = Number(startLng);
    const endLatNum = Number(endLat);
    const endLngNum = Number(endLng);

    if (![startLatNum, startLngNum, endLatNum, endLngNum].every(Number.isFinite)) {
        return res.status(400).json({ message: 'Invalid location parameters.' });
    }

    if (startLatNum === endLatNum && startLngNum === endLngNum) {
        return res.json(straightLinePath(startLatNum, startLngNum, endLatNum, endLngNum));
    }

    const normalizedMode = String(mode || 'auto').trim().toLowerCase();
    if (normalizedMode === 'straight') {
        return res.json(straightLinePath(startLatNum, startLngNum, endLatNum, endLngNum));
    }

    const normalizedEdgeKey = String(edgeKey || '').trim();
    if (normalizedEdgeKey) {
        try {
            await ensureRouteOverridesTable();
            const [[overrideRow]] = await pool.query(
                'SELECT path FROM network_route_overrides WHERE edge_key = ? LIMIT 1',
                [normalizedEdgeKey]
            );
            if (overrideRow?.path) {
                let parsed = overrideRow.path;
                if (typeof parsed === 'string') {
                    parsed = JSON.parse(parsed);
                }
                const overridePath = normalizePathPayload(parsed);
                if (overridePath) {
                    return res.json(overridePath);
                }
            }
        } catch (overrideError) {
            console.warn('[Map Route] Failed to read route override:', overrideError.message);
        }
    }

    const parsedMaxDetourRatio = Number(maxDetourRatio);
    const detourRatioLimit = Number.isFinite(parsedMaxDetourRatio) && parsedMaxDetourRatio > 1
        ? parsedMaxDetourRatio
        : 3;

    const cacheKey = buildRouteCacheKey(startLatNum, startLngNum, endLatNum, endLngNum);
    const cachedPath = readRouteCache(cacheKey);
    if (cachedPath) {
        return res.json(cachedPath);
    }

    try {
        const profiles = normalizedMode === 'driving' || normalizedMode === 'bike' || normalizedMode === 'foot'
            ? [normalizedMode]
            : ['driving', 'bike', 'foot'];

        const directDistance = haversineDistanceKm(
            { lat: startLatNum, lng: startLngNum },
            { lat: endLatNum, lng: endLngNum }
        );

        for (const profile of profiles) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
                const url = `https://router.project-osrm.org/route/v1/${profile}/${startLngNum},${startLatNum};${endLngNum},${endLatNum}?overview=full&geometries=geojson`;
                const response = await fetch(url, { signal: controller.signal });
                if (!response.ok) continue;

                const data = await response.json();
                const coords = data?.routes?.[0]?.geometry?.coordinates;
                if (!Array.isArray(coords) || coords.length < 2) {
                    continue;
                }

                const snappedPath = coords
                    .map((point) => ({ lat: Number(point?.[1]), lng: Number(point?.[0]) }))
                    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

                if (snappedPath.length >= 2) {
                    const snappedDistance = pathDistanceKm(snappedPath);
                    const detourRatio = directDistance > 0 ? snappedDistance / directDistance : 1;

                    if (detourRatio > detourRatioLimit) {
                        console.warn(
                            `[Map Route] Detour too large (${detourRatio.toFixed(2)}x, limit ${detourRatioLimit}x). Falling back to straight line.`
                        );
                        return res.json(straightLinePath(startLatNum, startLngNum, endLatNum, endLngNum));
                    }

                    writeRouteCache(cacheKey, snappedPath);
                    return res.json(snappedPath);
                }
            } finally {
                clearTimeout(timeout);
            }
        }

        console.warn('[Map Route] No valid OSRM profile result. Falling back to straight line.');
        return res.json(straightLinePath(startLatNum, startLngNum, endLatNum, endLngNum));

    } catch (error) {
        console.error('[Map Route] Error calling OSRM API:', error);
        return res.json(straightLinePath(startLatNum, startLngNum, endLatNum, endLngNum));
    }
});

router.put('/route-overrides/:edgeKey', async (req, res) => {
    const edgeKey = decodeURIComponent(req.params.edgeKey || '').trim();
    const normalizedPath = normalizePathPayload(req.body?.path);

    if (!edgeKey) {
        return res.status(400).json({ message: 'edgeKey is required.' });
    }
    if (!normalizedPath) {
        return res.status(400).json({ message: 'A valid path with at least 2 points is required.' });
    }

    try {
        await ensureRouteOverridesTable();
        await pool.query(
            `INSERT INTO network_route_overrides (edge_key, path)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE path = VALUES(path)`,
            [edgeKey, JSON.stringify(normalizedPath)]
        );

        routeCache.clear();
        res.json({ success: true, edgeKey, path: normalizedPath });
    } catch (error) {
        console.error('[Map Route] Failed to save route override:', error);
        res.status(500).json({ message: error.message || 'Failed to save route override.' });
    }
});

router.delete('/route-overrides/:edgeKey', async (req, res) => {
    const edgeKey = decodeURIComponent(req.params.edgeKey || '').trim();
    if (!edgeKey) {
        return res.status(400).json({ message: 'edgeKey is required.' });
    }

    try {
        await ensureRouteOverridesTable();
        await pool.query('DELETE FROM network_route_overrides WHERE edge_key = ?', [edgeKey]);
        routeCache.clear();
        res.json({ success: true, edgeKey });
    } catch (error) {
        console.error('[Map Route] Failed to delete route override:', error);
        res.status(500).json({ message: error.message || 'Failed to delete route override.' });
    }
});


// --- Mikrotik Test Connection ---
router.post('/test-connection', async (req, res) => {
    try {
        await mikrotikApi.testMikrotikConnection();
        res.json({ success: true, message: 'Connection successful!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- Interface Traffic Monitoring ---
router.get('/interfaces', async (req, res) => {
    try {
        const interfaces = await mikrotikApi.fetchInterfaces();
        res.json(interfaces);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch interfaces.' });
    }
});

router.get('/interfaces/traffic/:interfaceName', async (req, res) => {
    try {
        const traffic = await mikrotikApi.monitorInterfaceTraffic(req.params.interfaceName);
        res.json(traffic);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch traffic data.' });
    }
});

// --- Simple Queue Traffic Monitoring ---
router.get('/queues/simple', async (req, res) => {
    try {
        const queues = await mikrotikApi.fetchSimpleQueues();
        res.json(queues);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch simple queues.' });
    }
});

router.get('/queues/simple/traffic/:id', async (req, res) => {
    try {
        const traffic = await mikrotikApi.monitorQueueTraffic(req.params.id);
        res.json(traffic);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch queue traffic data.' });
    }
});

// --- Dynamic NAT for Remote ONT ---
router.post('/update-remote-nat-target', async (req, res) => {
    const { targetIp } = req.body;
    if (!targetIp) {
        return res.status(400).json({ message: 'Target IP address is required.' });
    }
    try {
        await mikrotikApi.updateRemoteOntNatTarget(targetIp);
        res.json({ success: true, message: `NAT rule updated to target ${targetIp}` });
    } catch (error) {
        console.error("Error updating NAT rule:", error);
        res.status(500).json({ message: error.message || 'Failed to update NAT rule on router.' });
    }
});


export default router;
