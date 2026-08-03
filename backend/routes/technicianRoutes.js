
import express from 'express';
import pool from '../db.js';
import { getSettings, generateNewCustomerId, dbDateTimeToLocalISO } from '../utils.js';
import mikrotikApi from '../mikrotik-api.js';
import { getCustomerDeviceDetails, pushCustomerPppoeToAcs, updateCustomerWlan } from '../services.js';

const router = express.Router();

// Middleware: Memastikan hanya admin atau teknisi yang dapat mengakses rute ini
router.use((req, res, next) => {
    const allowedRoles = ['admin', 'technician'];
    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Forbidden: Access denied for this role.' });
    }
    next();
});

// --- Rute Pelanggan untuk Teknisi (Akses Terbatas) ---

// GET /api/technician/customers - Lihat semua pelanggan
router.get('/customers', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM customers WHERE status = ? ORDER BY activeDate DESC', ['Unregister']);
        const formattedRows = rows.map(c => ({
            ...c,
            location: c.location ? JSON.parse(c.location) : null,
            activeDate: dbDateTimeToLocalISO(c.activeDate),
        }));
        res.json(formattedRows);
    } catch (e) {
        console.error("Error reading customers data for technician:", e);
        res.status(500).json({ message: 'Error reading customers data' });
    }
});

// POST /api/technician/customers - Buat pelanggan baru
router.post('/customers', async (req, res) => {
    try {
        const { createNewPppoe, newPppoeUsername, newPppoePassword, ...customerData } = req.body;
        
        const settings = await getSettings();
        const prefix = settings.app.customerIdPrefix || 'CUS';
        const newId = generateNewCustomerId(prefix);

        let pppoeUsernameToSave = customerData.pppoeUsername || null;

        if (createNewPppoe) {
            if (!newPppoeUsername || !newPppoePassword) {
                return res.status(400).json({ message: 'New PPPoE username and password are required.' });
            }

            const [[pkg]] = await pool.query('SELECT pppoeProfile FROM packages WHERE id = ?', [customerData.packageId]);
            if (!pkg) return res.status(400).json({ message: 'Selected package not found.' });
            if (!pkg.pppoeProfile) return res.status(400).json({ message: 'The selected package does not have a linked PPPoE profile.' });

            await mikrotikApi.addPppoeUser({
                name: newPppoeUsername,
                password: newPppoePassword,
                profile: pkg.pppoeProfile,
                comment: newId,
            });
            pppoeUsernameToSave = newPppoeUsername;
        } else if (pppoeUsernameToSave) {
            await mikrotikApi.updatePppoeUserCommentByName(pppoeUsernameToSave, newId);
        }

        const customerToSave = {
            id: newId,
            name: customerData.name,
            address: customerData.address,
            phone: customerData.phone,
            email: customerData.email,
            packageId: customerData.packageId,
            status: customerData.status,
            location: customerData.location ? JSON.stringify(customerData.location) : null,
            odpId: customerData.odpId || null,
            activeDate: customerData.activeDate ? customerData.activeDate.replace('T', ' ') : new Date(),
            pppoeUsername: pppoeUsernameToSave,
            acsSerialNumber: customerData.acsSerialNumber || null,
        };

        await pool.query('INSERT INTO customers SET ?', customerToSave);

        let acsPppoeSync = null;
        if (createNewPppoe) {
            acsPppoeSync = await pushCustomerPppoeToAcs({
                customerId: newId,
                pppoeUsername: newPppoeUsername,
                pppoePassword: newPppoePassword,
            });
            if (!acsPppoeSync.success && !acsPppoeSync.skipped) {
                console.warn(`[Technician Create] ACS PPPoE push failed for ${newId}:`, acsPppoeSync);
            }
        }

        res.status(201).json({ ...customerToSave, acsPppoeSync });
    } catch (e) {
        console.error("Error creating customer by technician:", e);
        res.status(500).json({ message: e.message || 'Error creating customer' });
    }
});

// PUT /api/technician/customers/:id - Perbarui pelanggan
router.put('/customers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { createNewPppoe, newPppoeUsername, newPppoePassword, ...customerData } = req.body;
        let acsPppoeSync = null;

        const [[oldCustomer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
        if (!oldCustomer) return res.status(404).send('Customer not found');
        
        const oldStatus = oldCustomer.status;
        const newStatus = customerData.status;

        let pppoeUsernameToSave = customerData.pppoeUsername || null;

        if (createNewPppoe) {
            if (!newPppoeUsername || !newPppoePassword) {
                return res.status(400).json({ message: 'New PPPoE username and password are required.' });
            }

            const [[pkg]] = await pool.query('SELECT pppoeProfile FROM packages WHERE id = ?', [customerData.packageId]);
            if (!pkg) return res.status(400).json({ message: 'Selected package not found.' });
            if (!pkg.pppoeProfile) return res.status(400).json({ message: 'The selected package does not have a linked PPPoE profile.' });

            await mikrotikApi.addPppoeUser({
                name: newPppoeUsername,
                password: newPppoePassword,
                profile: pkg.pppoeProfile,
                comment: id,
            });
            pppoeUsernameToSave = newPppoeUsername;
        }
        
        if (pppoeUsernameToSave !== oldCustomer.pppoeUsername) {
            if (oldCustomer.pppoeUsername) {
                await mikrotikApi.updatePppoeUserCommentByName(oldCustomer.pppoeUsername, '');
            }
            if (pppoeUsernameToSave) {
                const [[otherCustomer]] = await pool.query('SELECT id FROM customers WHERE pppoeUsername = ? AND id != ?', [pppoeUsernameToSave, id]);
                if (otherCustomer) {
                    await pool.query('UPDATE customers SET pppoeUsername = NULL WHERE id = ?', [otherCustomer.id]);
                }
                await mikrotikApi.updatePppoeUserCommentByName(pppoeUsernameToSave, id);
            }
        }

        const packageChanged = customerData.packageId && customerData.packageId !== oldCustomer.packageId;
        if (packageChanged && oldCustomer.pppoeUsername) {
            try {
                const [[newPackage]] = await pool.query('SELECT pppoeProfile FROM packages WHERE id = ?', [customerData.packageId]);
                if (newPackage && newPackage.pppoeProfile) {
                    const pppoeUsers = await mikrotikApi.fetchPppoeUsers();
                    const pppoeUserOnRouter = pppoeUsers.find(u => u.name === oldCustomer.pppoeUsername);

                    if (pppoeUserOnRouter) {
                        await mikrotikApi.updatePppoeUser(pppoeUserOnRouter.id, { profile: newPackage.pppoeProfile });
                        await mikrotikApi.reconnectPppoeUser(oldCustomer.pppoeUsername);
                    }
                }
            } catch (mikrotikError) {
                console.error(`[Technician Update] Failed to update MikroTik profile during package change for customer ${id}:`, mikrotikError);
            }
        }

        const customerToUpdate = {
            name: customerData.name,
            address: customerData.address,
            phone: customerData.phone,
            email: customerData.email,
            packageId: customerData.packageId,
            status: customerData.status,
            location: customerData.location ? JSON.stringify(customerData.location) : null,
            odpId: customerData.odpId || null,
            pppoeUsername: pppoeUsernameToSave,
            activeDate: customerData.activeDate ? customerData.activeDate.replace('T', ' ') : new Date(),
            acsSerialNumber: customerData.acsSerialNumber || null,
        };
        
        await pool.query('UPDATE customers SET ? WHERE id = ?', [customerToUpdate, id]);
        if (createNewPppoe) {
            acsPppoeSync = await pushCustomerPppoeToAcs({
                customerId: id,
                pppoeUsername: newPppoeUsername,
                pppoePassword: newPppoePassword,
            });
            if (!acsPppoeSync.success && !acsPppoeSync.skipped) {
                console.warn(`[Technician Update] ACS PPPoE push failed for ${id}:`, acsPppoeSync);
            }
        }

        if (newStatus && newStatus !== oldStatus) {
            try {
                const settings = await getSettings();
                const suspensionProfile = settings.billing.suspensionProfileName;
                const pppoeUserOnRouter = oldCustomer.pppoeUsername ? (await mikrotikApi.fetchPppoeUsers()).find(u => u.name === oldCustomer.pppoeUsername) : null;

                if (pppoeUserOnRouter) {
                    if (newStatus === 'Inactive') {
                        await mikrotikApi.disablePppoeUser(pppoeUserOnRouter.id);
                        await pool.query('UPDATE customers SET previousPppoeProfile = ? WHERE id = ?', [pppoeUserOnRouter.profile, id]);
                    } 
                    else if (newStatus === 'Suspended') {
                        if (!suspensionProfile) throw new Error('Suspension profile name is not configured in settings.');
                        await mikrotikApi.enablePppoeUser(pppoeUserOnRouter.id);
                        await pool.query('UPDATE customers SET previousPppoeProfile = ? WHERE id = ?', [pppoeUserOnRouter.profile, id]);
                        await mikrotikApi.updatePppoeUser(pppoeUserOnRouter.id, { profile: suspensionProfile });
                        await mikrotikApi.reconnectPppoeUser(oldCustomer.pppoeUsername);
                    } 
                    else if (newStatus === 'Active') {
                        await mikrotikApi.enablePppoeUser(pppoeUserOnRouter.id);
                        if (oldCustomer.previousPppoeProfile) {
                            await mikrotikApi.updatePppoeUser(pppoeUserOnRouter.id, { profile: oldCustomer.previousPppoeProfile });
                            await pool.query('UPDATE customers SET previousPppoeProfile = NULL WHERE id = ?', [id]);
                        }
                        await mikrotikApi.reconnectPppoeUser(oldCustomer.pppoeUsername);
                    }
                }
            } catch (sideEffectError) {
                console.error(`[Technician Update] Side-effect error for customer ${id}:`, sideEffectError);
            }
        }
        
        res.json({ ...customerToUpdate, id, acsPppoeSync });
    } catch (e) {
        console.error("Error updating customer by technician:", e);
        res.status(500).json({ message: e.message || 'Error updating customer' });
    }
});

// Endpoint baru untuk memperbarui ID pelanggan (kunci primer) - Akses Teknisi
router.put('/customers/:id/update-id', async (req, res) => {
    const { id: oldId } = req.params;
    const { newId } = req.body;
    let connection;

    if (!newId || newId.trim() === '') {
        return res.status(400).json({ message: 'New Customer ID cannot be empty.' });
    }

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [[existingCustomer]] = await connection.query('SELECT id FROM customers WHERE id = ?', [newId]);
        if (existingCustomer) {
            throw new Error(`Customer ID "${newId}" already exists.`);
        }

        const [[customerToUpdate]] = await connection.query('SELECT pppoeUsername FROM customers WHERE id = ?', [oldId]);

        // Nonaktifkan sementara pemeriksaan foreign key untuk memungkinkan pembaruan kunci primer
        await connection.query('SET FOREIGN_KEY_CHECKS=0');

        // Perbarui semua tabel anak terlebih dahulu
        await connection.query('UPDATE invoices SET customerId = ? WHERE customerId = ?', [newId, oldId]);
        await connection.query('UPDATE payments SET customerId = ? WHERE customerId = ?', [newId, oldId]);
        await connection.query('UPDATE complaints SET customerId = ? WHERE customerId = ?', [newId, oldId]);
        await connection.query('UPDATE whatsapp_logs SET customer_id = ? WHERE customer_id = ?', [newId, oldId]);
        await connection.query('UPDATE package_changes SET customer_id = ? WHERE customer_id = ?', [newId, oldId]);

        // Perbarui tabel pelanggan utama
        await connection.query('UPDATE customers SET id = ? WHERE id = ?', [newId, oldId]);

        // Perbarui komentar di MikroTik dan tabel pppoe_users jika ada
        if (customerToUpdate && customerToUpdate.pppoeUsername) {
            await connection.query('UPDATE pppoe_users SET comment = ? WHERE comment = ?', [newId, oldId]);
            await mikrotikApi.updatePppoeUserCommentByName(customerToUpdate.pppoeUsername, newId);
        }

        // Aktifkan kembali pemeriksaan foreign key
        await connection.query('SET FOREIGN_KEY_CHECKS=1');

        await connection.commit();
        res.json({ success: true, message: `Customer ID successfully updated from ${oldId} to ${newId}.` });

    } catch (error) {
        if (connection) {
            await connection.query('SET FOREIGN_KEY_CHECKS=1'); // Pastikan untuk mengaktifkan kembali jika terjadi kesalahan
            await connection.rollback();
        }
        console.error("Error updating customer ID by technician:", error);
        res.status(500).json({ message: error.message || 'An internal server error occurred.' });
    } finally {
        if (connection) connection.release();
    }
});


// --- Rute Tugas untuk Teknisi ---

// GET /api/technician/tasks - Dapatkan tugas untuk teknisi tertentu
router.get('/tasks', async (req, res) => {
    try {
        const { technicianId } = req.query;
        if (!technicianId) {
            return res.status(400).json({ message: 'Technician ID is required.' });
        }
        
        // Ambil tugas instalasi baru (pelanggan dengan status 'Unregister' dan 'In Progress')
        const [installationTasks] = await pool.query(
            'SELECT * FROM customers WHERE status IN (?, ?)',
            ['Unregister', 'In Progress']
        );
        
        // Ambil tugas perbaikan (keluhan yang ditugaskan kepada teknisi ini dan belum selesai)
        const [repairTasks] = await pool.query(
            `SELECT c.*, cust.id as customer_id, cust.name as customer_name, cust.address as customer_address, cust.phone as customer_phone, cust.location as customer_location
             FROM complaints c
             JOIN customers cust ON c.customerId = cust.id
             WHERE c.assignedTo = ? AND c.status IN (?, ?)`,
            [technicianId, 'Pending', 'In Progress']
        );

        const formattedInstallations = installationTasks.map(customer => ({
            id: customer.id, // Gunakan ID pelanggan sebagai ID tugas
            type: 'Installation',
            status: customer.status,
            customer: customer,
            date: customer.activeDate
        }));

        const formattedRepairs = repairTasks.map(complaint => ({
            id: complaint.id, // Gunakan ID keluhan sebagai ID tugas
            type: 'Repair',
            status: complaint.status,
            customer: {
                id: complaint.customerId,
                name: complaint.customerName,
                address: complaint.customer_address,
                phone: complaint.customer_phone,
                location: complaint.customer_location ? JSON.parse(complaint.customer_location) : null,
            },
            complaint: complaint,
            date: complaint.dateSubmitted,
        }));

        const allTasks = [...formattedInstallations, ...formattedRepairs]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        res.json(allTasks);

    } catch (error) {
        console.error('Failed to fetch technician tasks:', error);
        res.status(500).json({ message: 'Failed to fetch tasks.' });
    }
});

// GET /api/technician/tasks/:id - Dapatkan detail tugas
router.get('/tasks/:id', async (req, res) => {
    const { id } = req.params;
    try {
        let taskData;
        // Cek apakah ini tugas instalasi (cocok dengan ID pelanggan)
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ? AND status IN (?, ?)', [id, 'Unregister', 'In Progress']);
        if (customer) {
            taskData = {
                id: customer.id,
                type: 'Installation',
                status: customer.status,
                customer: { ...customer, location: customer.location ? JSON.parse(customer.location) : null }
            };
        } else {
            // Cek apakah ini tugas perbaikan (cocok dengan ID keluhan)
            const [[complaint]] = await pool.query(
                `SELECT c.*, cust.id as customer_id, cust.name as customer_name, cust.address as customer_address, cust.phone as customer_phone, cust.location as customer_location
                 FROM complaints c
                 JOIN customers cust ON c.customerId = cust.id
                 WHERE c.id = ?`,
                [id]
            );
            if (!complaint) return res.status(404).json({ message: 'Task not found.' });

            taskData = {
                id: complaint.id,
                type: 'Repair',
                status: complaint.status,
                customer: {
                    id: complaint.customerId,
                    name: complaint.customerName,
                    address: complaint.customer_address,
                    phone: complaint.customer_phone,
                    location: complaint.customer_location ? JSON.parse(complaint.customer_location) : null
                },
                complaint: { ...complaint, replies: complaint.replies ? JSON.parse(complaint.replies) : [] },
            };
        }
        res.json(taskData);
    } catch (error) {
        console.error('Failed to fetch task detail:', error);
        res.status(500).json({ message: 'Failed to fetch task detail.' });
    }
});

// POST /api/technician/tasks/:id/status - Perbarui status tugas
router.post('/tasks/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // misal, 'In Progress', 'Resolved', 'Active'
    
    try {
        // Ini adalah tugas perbaikan (keluhan)
        if (id.startsWith('TICKET-')) {
            await pool.query('UPDATE complaints SET status = ? WHERE id = ?', [status, id]);
        }
        // Ini adalah tugas instalasi (pelanggan)
        else {
            await pool.query('UPDATE customers SET status = ? WHERE id = ?', [status, id]);
        }
        res.json({ success: true, message: 'Status updated.' });
    } catch (error) {
        console.error('Failed to update task status:', error);
        res.status(500).json({ message: 'Failed to update task status.' });
    }
});

// --- Rute Manajemen Perangkat untuk Teknisi ---

// GET /api/technician/customers/:customerId/device-details
router.get('/customers/:customerId/device-details', async (req, res) => {
    try {
        const details = await getCustomerDeviceDetails(req.params.customerId);
        res.json(details);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch device details.' });
    }
});

// POST /api/technician/customers/:customerId/update-wlan
router.post('/customers/:customerId/update-wlan', async (req, res) => {
    try {
        const { ssid, key } = req.body;
        const result = await updateCustomerWlan(req.params.customerId, { ssid, key });
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to update WLAN settings.' });
    }
});


export default router;
