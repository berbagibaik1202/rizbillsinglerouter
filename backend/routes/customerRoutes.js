

import express from 'express';
import pool from '../db.js';
import { getSettings, replacePlaceholders, generateNewCustomerId, dbDateTimeToLocalISO, formatRupiah, formatBillingPeriod, formatDateDisplay, dbDateToISO, toMySQLDatetime, dateToYMD } from '../utils.js';
import mikrotikApi from '../mikrotik-api.js';
import whatsappService from '../whatsappService.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import tripayService from '../tripayService.js';
import { recordCashMutation } from '../cashMutationService.js';
import { pushCustomerPppoeToAcs } from '../services.js';


const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Konfigurasi Multer untuk penyimpanan file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Ensure the directory exists
        if (!fs.existsSync(UPLOADS_DIR)) {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// GET /me - Get current logged in customer's full data
router.get('/me', async (req, res) => {
    const customerId = req.user.id;
    try {
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [customerId]);
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }
        res.json(customer);
    } catch (e) {
        console.error("Error fetching current customer data:", e);
        res.status(500).json({ message: 'Failed to fetch customer data.' });
    }
});


// Temporary in-memory store for OTPs. In production, use Redis or a database table.
const otpStore = {};

function normalizeBillingType(value) {
    return value === 'fixed' ? 'fixed' : 'postpaid';
}

function normalizeNextBillingStart(value, billingType) {
    if (billingType !== 'fixed' || !value) {
        return null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        return trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
    }

    return value;
}

const normalizePppoeUsername = (value) => {
    const normalized = String(value || '').trim();
    return normalized || null;
};

const normalizeCustomerId = (value) => {
    const normalized = String(value || '').trim();
    return normalized || null;
};

const normalizeOltMapping = (data, fallback = {}) => {
    const keys = ['oltDeviceId', 'oltFrame', 'oltSlot', 'oltPort', 'oltOnuId'];
    const supplied = keys.some(key => Object.prototype.hasOwnProperty.call(data, key));
    if (!supplied) return Object.fromEntries(keys.map(key => [key, fallback[key] ?? null]));
    const deviceId = String(data.oltDeviceId || '').trim() || null;
    const numbers = Object.fromEntries(keys.slice(1).map(key => [key, data[key] === '' || data[key] == null ? null : Number(data[key])]));
    if (!deviceId && Object.values(numbers).every(value => value == null)) return { oltDeviceId: null, ...numbers };
    if (!deviceId || Object.values(numbers).some(value => !Number.isInteger(value) || value < 0)) {
        throw new Error('Mapping OLT harus berisi perangkat, frame, slot, port, dan ID ONU yang valid.');
    }
    return { oltDeviceId: deviceId, ...numbers };
};

async function syncPppoeCacheComment(queryable, username, comment) {
    const normalizedUsername = normalizePppoeUsername(username);
    if (!normalizedUsername) return;
    await queryable.query('UPDATE pppoe_users SET comment = ? WHERE name = ?', [comment || '', normalizedUsername]);
}

async function syncPppoeCacheProfile(queryable, username, profile) {
    const normalizedUsername = normalizePppoeUsername(username);
    if (!normalizedUsername || !profile) return;
    await queryable.query('UPDATE pppoe_users SET profile = ? WHERE name = ?', [profile, normalizedUsername]);
}

async function resolveCustomerPppoeLink(connection, customer, preloadedRouterUsers = null) {
    const customerId = normalizeCustomerId(customer?.id);
    const configuredUsername = normalizePppoeUsername(customer?.pppoeUsername);
    const routerUsers = preloadedRouterUsers || await mikrotikApi.fetchPppoeUsers();

    let routerUser = null;
    if (configuredUsername) {
        routerUser = routerUsers.find((u) => normalizePppoeUsername(u.name) === configuredUsername) || null;
    }
    if (!routerUser && customerId) {
        routerUser = routerUsers.find((u) => normalizeCustomerId(u.comment) === customerId) || null;
    }

    if (!routerUser) {
        return { username: configuredUsername, routerUser: null, routerUsers };
    }

    const resolvedUsername = normalizePppoeUsername(routerUser.name);
    const resolvedComment = normalizeCustomerId(routerUser.comment);
    if (resolvedUsername && resolvedUsername !== configuredUsername && customerId) {
        await connection.query('UPDATE customers SET pppoeUsername = ? WHERE id = ?', [resolvedUsername, customerId]);
    }

    if (customerId && resolvedUsername && resolvedComment !== customerId) {
        await mikrotikApi.updatePppoeUserCommentByName(resolvedUsername, customerId);
        await syncPppoeCacheComment(connection, resolvedUsername, customerId);
        routerUser = { ...routerUser, comment: customerId };
    }

    return { username: resolvedUsername, routerUser, routerUsers };
}


/**
 * Synchronizes a customer's bonus voucher status based on their package eligibility and account status.
 * This is the single source of truth for voucher state.
 * @param {object} customer - The customer object (must include id, status, packageId).
 * @param {object} settings - The application settings object.
 */
async function syncBonusVoucher(customer, settings) {
    const bonusProfile = settings.billing.bonusVoucherProfile;
    if (!bonusProfile) {
        return; // Bonus feature is off.
    }

    const eligiblePackages = settings.billing.bonusVoucherPackageIds || [];
    // FIX: Pastikan packageId diperlakukan sebagai angka untuk pemeriksaan .includes().
    const isPackageEligible = eligiblePackages.length === 0 || eligiblePackages.includes(Number(customer.packageId));

    const voucherPrefix = settings.billing.bonusVoucherPrefix || 'bonus-';
    const bonusUsername = `${voucherPrefix}${customer.id.slice(-4)}`;
    
    const routerUsers = await mikrotikApi.fetchHotspotUsers();
    const bonusUser = routerUsers.find(u => u.name === bonusUsername);

    if (isPackageEligible && (customer.status || '').trim() === 'Active') {
        // Customer should have an active voucher
        if (bonusUser) {
            if (bonusUser.disabled) {
                await mikrotikApi.enableHotspotUser(bonusUser.id);
                console.log(`[Sync Voucher] Enabled bonus user ${bonusUsername} for active eligible customer ${customer.id}.`);
            }
        } else {
            await mikrotikApi.addHotspotUser({
                name: bonusUsername,
                password: bonusUsername,
                profile: bonusProfile,
                comment: `Bonus for ${customer.id}`,
                disabled: 'no'
            });
            console.log(`[Sync Voucher] Created and enabled bonus user ${bonusUsername} for active eligible customer ${customer.id}.`);
        }
    } else {
        // Customer should have a disabled or non-existent voucher
        if (bonusUser && !bonusUser.disabled) {
            await mikrotikApi.disableHotspotUser(bonusUser.id);
            console.log(`[Sync Voucher] Disabled bonus user ${bonusUsername} for inactive/ineligible customer ${customer.id}.`);
        }
    }
}


// --- NEW AFFILIATE ROUTES ---

router.post('/affiliate/request-topup', async (req, res) => {
    const customerId = req.user.id;
    const { amount, method } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Invalid top-up amount.' });
    }
    if (!method) {
        return res.status(400).json({ message: 'Payment method is required.' });
    }


    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const topupId = `TOPUP-${Date.now()}`;
        const newTopupRequest = {
            id: topupId,
            customer_id: customerId,
            user_id: null, // Ensure user_id is null for customers
            amount: amount,
            status: 'pending',
        };
        await connection.query('INSERT INTO topup_requests SET ?', newTopupRequest);
        
        const [[customer]] = await connection.query('SELECT * FROM customers WHERE id = ?', [customerId]);
        if (!customer) throw new Error('Customer not found.');

        const settings = await getSettings();
        const returnUrl = `${settings.app.baseUrl.replace(/\/$/, '')}/#portal`;

        const dummyInvoice = {
            id: topupId,
            amount: amount,
        };

        const tripayResponse = await tripayService.createTransaction(dummyInvoice, customer, returnUrl, method);

        await connection.query('UPDATE topup_requests SET tripay_reference = ? WHERE id = ?', [tripayResponse.reference, topupId]);
        
        await connection.commit();
        
        res.json({ paymentUrl: tripayResponse.checkout_url });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error requesting top-up:", error);
        res.status(500).json({ message: error.message || 'Failed to request top-up.' });
    } finally {
        if (connection) connection.release();
    }
});

router.post('/affiliate/sell-voucher', async (req, res) => {
    const customerId = req.user.id;
    const { profileId } = req.body;
    
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [[customer]] = await connection.query('SELECT * FROM customers WHERE id = ? FOR UPDATE', [customerId]);
        if (!customer) throw new Error("Customer not found.");
        
        const [[profile]] = await connection.query('SELECT * FROM hotspot_profiles WHERE id = ?', [profileId]);
        if (!profile) throw new Error("Voucher profile not found.");

        const sellingPrice = Number(profile.sellingPrice) || 0;
        const costPrice = Number(profile.price) || 0;
        const profit = sellingPrice - costPrice;
        
        if (Number(customer.voucher_balance) < sellingPrice) {
            throw new Error(`Insufficient balance. You need ${formatRupiah(sellingPrice)}, but you only have ${formatRupiah(customer.voucher_balance)}.`);
        }
        
        const newBalance = Number(customer.voucher_balance) - sellingPrice;

        // Generate voucher where username and password are the same
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const username = code;
        const password = code;
        
        const routerResponse = await mikrotikApi.addHotspotUser({ name: username, password, profile: profile.name });
        
        const newVoucher = {
            username,
            password,
            profile: profile.name,
            duration_minutes: profile.duration_minutes,
            status: 'new',
            created_at: new Date(),
            mikrotik_id: routerResponse.id,
            sold_by_customer_id: customerId,
        };
        const [voucherInsertResult] = await connection.query('INSERT INTO hotspot_vouchers SET ?', newVoucher);
        const newVoucherId = voucherInsertResult.insertId;

        // Create commission record
        const newCommission = {
            customer_id: customerId,
            voucher_id: newVoucherId,
            profit_amount: profit,
            status: 'pending',
        };
        await connection.query('INSERT INTO customer_commissions SET ?', newCommission);

        // Update customer balance
        await connection.query('UPDATE customers SET voucher_balance = ? WHERE id = ?', [newBalance, customerId]);

        await connection.commit();
        
        // Return the full voucher details for printing
        res.status(201).json({ ...newVoucher, id: newVoucherId });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error selling voucher:", error);
        res.status(500).json({ message: error.message || 'Failed to sell voucher.' });
    } finally {
        if (connection) connection.release();
    }
});


// GET /:id/affiliate-data
router.get('/:id/affiliate-data', async (req, res) => {
    const { id } = req.params;
    try {
        const [[customer]] = await pool.query('SELECT voucher_balance FROM customers WHERE id = ?', [id]);
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }

        const [sellableProfiles] = await pool.query('SELECT id, name, rateLimit, sharedUsers, price, sellingPrice, duration_minutes FROM hotspot_profiles WHERE sellingPrice > 0 ORDER BY sellingPrice ASC');
        
        const [commissions] = await pool.query(`
            SELECT 
                cc.id, 
                cc.customer_id, 
                cc.voucher_id, 
                cc.profit_amount, 
                cc.status, 
                cc.created_at, 
                cc.applied_to_invoice_id, 
                hv.username as voucher_username 
            FROM customer_commissions cc 
            LEFT JOIN hotspot_vouchers hv ON cc.voucher_id = hv.id
            WHERE cc.customer_id = ?
        `, [id]);
        
        const [topups] = await pool.query('SELECT id, customer_id, amount, status, created_at, paid_at, tripay_reference FROM topup_requests WHERE customer_id = ?', [id]);

        const transactions = [...commissions, ...topups].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        res.json({
            balance: customer.voucher_balance || 0,
            sellableProfiles,
            transactions,
        });
    } catch (e) {
        console.error("Error fetching affiliate data:", e);
        res.status(500).json({ message: 'Failed to fetch affiliate data.' });
    }
});

// Admin endpoint to add balance to a customer's affiliate account
router.post('/:id/add-balance', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden: Only admins can perform this action.' });
    }

    const { id: customerId } = req.params;
    const { amount } = req.body;
    const adminUserId = req.user.id; // The admin performing the action

    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: 'A valid positive amount is required.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [[customer]] = await connection.query('SELECT * FROM customers WHERE id = ? FOR UPDATE', [customerId]);
        if (!customer) {
            throw new Error('Customer not found.');
        }
        
        const settings = await getSettings();

        const currentBalance = Number(customer.voucher_balance) || 0;
        const newBalance = currentBalance + amount;

        await connection.query('UPDATE customers SET voucher_balance = ? WHERE id = ?', [newBalance, customerId]);

        // Log this action as a payment record for traceability
        const paymentRecord = {
            id: `PAY-TOPUP-ADMIN-${Date.now()}`,
            invoiceId: 'Affiliate Top Up (Admin)',
            customerId: customerId,
            date: toMySQLDatetime(new Date(), settings.app.timezone),
            amount: amount,
            method: 'Admin Grant',
            sold_by_user_id: adminUserId,
        };
        await connection.query('INSERT INTO payments SET ?', paymentRecord);
        await recordCashMutation(connection, {
            date: paymentRecord.date,
            direction: 'in',
            category: 'affiliate_topup',
            amount,
            method: paymentRecord.method,
            description: `Top up saldo affiliate admin untuk ${customer.name}`,
            reference_type: 'payment',
            reference_id: paymentRecord.id,
            customer_id: customerId,
            user_id: adminUserId,
            created_by: adminUserId,
            source: 'system',
            timezone: settings.app.timezone,
        });

        await connection.commit();

        // Optionally send a notification (outside the transaction)
        try {
            // const settings = await getSettings(); // Already fetched
            if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp?.affiliateTopupSuccess && customer.phone) {
                const message = replacePlaceholders(settings.whatsapp.affiliateTopupSuccess, {
                    customerName: customer.name,
                    amount: formatRupiah(amount),
                    newBalance: formatRupiah(newBalance)
                });
                whatsappService.sendMessage(customer.phone, message);
            }
        } catch (notificationError) {
            console.error("Failed to send top-up notification, but balance was added successfully:", notificationError);
        }

        res.json({ success: true, newBalance });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error adding affiliate balance by admin:", error);
        res.status(500).json({ message: error.message || 'Failed to add balance.' });
    } finally {
        if (connection) connection.release();
    }
});


// --- Customers CRUD ---
router.get('/', async (req, res) => {
    try {
        const settings = await getSettings();
        const timezone = settings.app?.timezone || 'Asia/Jakarta';
        const currentMonthKey = dateToYMD(new Date(), timezone).slice(0, 7);

        const [[rows], [invoiceRows]] = await Promise.all([
            pool.query(`
                SELECT
                    id,
                    name,
                    nik,
                    address,
                    phone,
                    email,
                    packageId,
                    status,
                    location,
                    odpId,
                    pppoeUsername,
                    activeDate,
                    nextBillingStart,
                    previousPppoeProfile,
                    acsSerialNumber,
                    oltDeviceId,
                    oltFrame,
                    oltSlot,
                    oltPort,
                    oltOnuId,
                    voucher_balance,
                    billing_type
                FROM customers
                ORDER BY activeDate DESC
            `),
            pool.query(
                `SELECT customerId, status, dueDate, issueDate
                 FROM invoices
                 WHERE DATE_FORMAT(dueDate, '%Y-%m') = ?
                 ORDER BY dueDate DESC, issueDate DESC`,
                [currentMonthKey]
            )
        ]);

        const statusPriority = { Overdue: 3, Unpaid: 2, Paid: 1 };
        const invoiceStatusByCustomer = new Map();

        for (const invoice of invoiceRows) {
            const existing = invoiceStatusByCustomer.get(invoice.customerId);
            if (!existing) {
                invoiceStatusByCustomer.set(invoice.customerId, invoice);
                continue;
            }

            const existingDueDate = existing.dueDate ? new Date(existing.dueDate).getTime() : 0;
            const currentDueDate = invoice.dueDate ? new Date(invoice.dueDate).getTime() : 0;

            if (currentDueDate > existingDueDate) {
                invoiceStatusByCustomer.set(invoice.customerId, invoice);
                continue;
            }

            if (currentDueDate === existingDueDate) {
                const existingPriority = statusPriority[existing.status] || 0;
                const currentPriority = statusPriority[invoice.status] || 0;
                if (currentPriority > existingPriority) {
                    invoiceStatusByCustomer.set(invoice.customerId, invoice);
                }
            }
        }

        const formattedRows = rows.map(c => {
            let parsedLocation = null;
            if (c.location) {
                try {
                    // Only parse if it's a string that looks like an object
                    if (typeof c.location === 'string' && c.location.trim().startsWith('{')) {
                        parsedLocation = JSON.parse(c.location);
                    } else if (typeof c.location === 'object' && c.location !== null) {
                        // If it's already an object (though it should be a string from DB), use it
                        parsedLocation = c.location;
                    }
                } catch (parseError) {
                    console.error(`[Customer Route] Failed to parse location JSON for customer ID ${c.id}. Value:`, c.location, parseError);
                    // Keep parsedLocation as null on error
                }
            }
            return {
                ...c,
                currentMonthInvoiceStatus: invoiceStatusByCustomer.get(c.id)?.status || null,
                location: parsedLocation,
                activeDate: dbDateTimeToLocalISO(c.activeDate),
            };
        });
        res.json(formattedRows);
    } catch (e) {
        console.error("Error reading customers data:", e);
        res.status(500).json({ message: 'Error reading customers data' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { createNewPppoe, newPppoeUsername, newPppoePassword, ...customerData } = req.body;
        
        const settings = await getSettings();
        const prefix = settings.app.customerIdPrefix || 'CUS';
        
        const newId = generateNewCustomerId(prefix);

        let pppoeUsernameToSave = normalizePppoeUsername(customerData.pppoeUsername);

        if (createNewPppoe) {
            if (!newPppoeUsername || !newPppoePassword) {
                return res.status(400).json({ message: 'New PPPoE username and password are required.' });
            }

            const [[pkg]] = await pool.query('SELECT pppoeProfile FROM packages WHERE id = ?', [customerData.packageId]);
            if (!pkg) return res.status(400).json({ message: 'Selected package not found.' });
            if (!pkg.pppoeProfile) return res.status(400).json({ message: 'The selected package does not have a linked PPPoE profile.' });

            const normalizedNewPppoeUsername = normalizePppoeUsername(newPppoeUsername);
            await mikrotikApi.addPppoeUser({
                name: newPppoeUsername,
                password: newPppoePassword,
                profile: pkg.pppoeProfile,
                comment: newId,
            });
            pppoeUsernameToSave = normalizedNewPppoeUsername;
            await syncPppoeCacheComment(pool, pppoeUsernameToSave, newId);
            await syncPppoeCacheProfile(pool, pppoeUsernameToSave, pkg.pppoeProfile);
        } else if (pppoeUsernameToSave) {
            await mikrotikApi.updatePppoeUserCommentByName(pppoeUsernameToSave, newId);
            await syncPppoeCacheComment(pool, pppoeUsernameToSave, newId);
        }

        if (pppoeUsernameToSave) {
            const [[otherCustomer]] = await pool.query('SELECT id FROM customers WHERE pppoeUsername = ?', [pppoeUsernameToSave]);
            if (otherCustomer) {
                await pool.query('UPDATE customers SET pppoeUsername = NULL WHERE id = ?', [otherCustomer.id]);
            }
        }

        const customerToSave = {
            id: newId,
            name: customerData.name,
            nik: customerData.nik || null,
            address: customerData.address,
            phone: customerData.phone,
            email: customerData.email,
            packageId: customerData.packageId,
            status: customerData.status,
            location: customerData.location ? JSON.stringify(customerData.location) : null,
            odpId: customerData.odpId || null, // FIX: Ensure empty string becomes NULL
            // Store the "wall time" string from the form directly, formatted for MySQL DATETIME.
            // This prevents timezone conversions on the server.
            activeDate: customerData.activeDate ? customerData.activeDate.replace('T', ' ') : new Date(),
            pppoeUsername: pppoeUsernameToSave,
            acsSerialNumber: customerData.acsSerialNumber || null,
            ...normalizeOltMapping(customerData),
            billing_type: normalizeBillingType(customerData.billing_type),
            nextBillingStart: normalizeNextBillingStart(customerData.nextBillingStart, normalizeBillingType(customerData.billing_type)),
        };

        await pool.query('INSERT INTO customers SET ?', customerToSave);
        
        // Sync bonus voucher status after creation
        await syncBonusVoucher({ ...customerToSave, id: newId }, settings);

        let acsPppoeSync = null;
        if (createNewPppoe) {
            acsPppoeSync = await pushCustomerPppoeToAcs({
                customerId: newId,
                pppoeUsername: newPppoeUsername,
                pppoePassword: newPppoePassword,
            });
            if (!acsPppoeSync.success && !acsPppoeSync.skipped) {
                console.warn(`[Customer Create] ACS PPPoE push failed for ${newId}:`, acsPppoeSync);
            }
        }

        res.status(201).json({ ...customerToSave, acsPppoeSync });
    } catch (e) {
        console.error("Error creating customer:", e);
        res.status(500).json({ message: e.message || 'Error creating customer' });
    }
});

router.put('/:id', async (req, res) => {
    const { id } = req.params;
    let connection;
    let acsPppoeSync = null;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { createNewPppoe, newPppoeUsername, newPppoePassword, ...customerData } = req.body;

        const [[oldCustomer]] = await connection.query('SELECT * FROM customers WHERE id = ? FOR UPDATE', [id]);
        if (!oldCustomer) {
            throw new Error('Customer not found');
        }
        
        let pppoeUsernameToSave = normalizePppoeUsername(customerData.pppoeUsername);

        if (createNewPppoe) {
            // ... (logika pembuatan pengguna PPPoE baru seperti sebelumnya)
             if (!newPppoeUsername || !newPppoePassword) {
                throw new Error('New PPPoE username and password are required.');
            }
            const [[pkg]] = await connection.query('SELECT pppoeProfile FROM packages WHERE id = ?', [customerData.packageId]);
            if (!pkg || !pkg.pppoeProfile) throw new Error('Selected package or its PPPoE profile not found.');
            const normalizedNewPppoeUsername = normalizePppoeUsername(newPppoeUsername);
            await mikrotikApi.addPppoeUser({ name: newPppoeUsername, password: newPppoePassword, profile: pkg.pppoeProfile, comment: id });
            pppoeUsernameToSave = normalizedNewPppoeUsername;
            await syncPppoeCacheComment(connection, pppoeUsernameToSave, id);
            await syncPppoeCacheProfile(connection, pppoeUsernameToSave, pkg.pppoeProfile);
        }
        
        if (pppoeUsernameToSave !== oldCustomer.pppoeUsername) {
            if (oldCustomer.pppoeUsername) {
                await mikrotikApi.updatePppoeUserCommentByName(oldCustomer.pppoeUsername, '');
                await syncPppoeCacheComment(connection, oldCustomer.pppoeUsername, '');
            }
            if (pppoeUsernameToSave) {
                const [[otherCustomer]] = await connection.query('SELECT id FROM customers WHERE pppoeUsername = ? AND id != ?', [pppoeUsernameToSave, id]);
                if (otherCustomer) await connection.query('UPDATE customers SET pppoeUsername = NULL WHERE id = ?', [otherCustomer.id]);
                await mikrotikApi.updatePppoeUserCommentByName(pppoeUsernameToSave, id);
                await syncPppoeCacheComment(connection, pppoeUsernameToSave, id);
            }
        } else if (pppoeUsernameToSave) {
            await mikrotikApi.updatePppoeUserCommentByName(pppoeUsernameToSave, id);
            await syncPppoeCacheComment(connection, pppoeUsernameToSave, id);
        }

        const packageChanged = customerData.packageId && customerData.packageId !== oldCustomer.packageId;
        if (packageChanged && pppoeUsernameToSave) {
            console.log(`[Customer Update] Package changed for customer ${id}. Updating MikroTik profile.`);
            const [[newPackage]] = await connection.query('SELECT pppoeProfile FROM packages WHERE id = ?', [customerData.packageId]);
            if (newPackage && newPackage.pppoeProfile) {
                const pppoeUsers = await mikrotikApi.fetchPppoeUsers();
                const pppoeUserOnRouter = pppoeUsers.find(u => normalizePppoeUsername(u.name) === pppoeUsernameToSave);
                if (pppoeUserOnRouter) {
                    await mikrotikApi.updatePppoeUser(pppoeUserOnRouter.id, { profile: newPackage.pppoeProfile });
                    await syncPppoeCacheProfile(connection, pppoeUsernameToSave, newPackage.pppoeProfile);
                    await mikrotikApi.reconnectPppoeUser(pppoeUsernameToSave);
                } else {
                    console.warn(`[Customer Update] Could not find PPPoE user ${pppoeUsernameToSave} on router.`);
                }
            }
        }

        const normalizedBillingType = normalizeBillingType(customerData.billing_type ?? oldCustomer.billing_type);
        const nextBillingStart = Object.prototype.hasOwnProperty.call(customerData, 'nextBillingStart')
            ? normalizeNextBillingStart(customerData.nextBillingStart, normalizedBillingType)
            : oldCustomer.nextBillingStart;

        const customerToUpdate = {
            name: customerData.name,
            nik: customerData.nik || null,
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
            ...normalizeOltMapping(customerData, oldCustomer),
            billing_type: normalizedBillingType,
            nextBillingStart: nextBillingStart,
        };
        
        await connection.query('UPDATE customers SET ? WHERE id = ?', [customerToUpdate, id]);
        
        const settings = await getSettings();
        await syncBonusVoucher({ ...customerToUpdate, id }, settings);
        
        const oldStatus = (oldCustomer.status || '').trim();
        const newStatus = (customerData.status || '').trim();

        if (newStatus && newStatus !== oldStatus) {
            const suspensionProfile = settings.billing.suspensionProfileName;
            const { username: linkedPppoeUsername, routerUser: pppoeUserOnRouter } = await resolveCustomerPppoeLink(
                connection,
                { id, pppoeUsername: pppoeUsernameToSave }
            );
            if (pppoeUserOnRouter) {
                 if (newStatus === 'Inactive') {
                    await mikrotikApi.disablePppoeUser(pppoeUserOnRouter.id);
                    await connection.query('UPDATE customers SET previousPppoeProfile = ? WHERE id = ?', [pppoeUserOnRouter.profile, id]);
                } else if (newStatus === 'Suspended') {
                    if (!suspensionProfile) throw new Error('Suspension profile name is not configured in settings.');
                    await mikrotikApi.enablePppoeUser(pppoeUserOnRouter.id);
                    await connection.query('UPDATE customers SET previousPppoeProfile = ? WHERE id = ?', [pppoeUserOnRouter.profile, id]);
                    await mikrotikApi.updatePppoeUser(pppoeUserOnRouter.id, { profile: suspensionProfile });
                    await syncPppoeCacheProfile(connection, linkedPppoeUsername, suspensionProfile);
                    await mikrotikApi.reconnectPppoeUser(linkedPppoeUsername);
                } else if (newStatus === 'Active') {
                    await mikrotikApi.enablePppoeUser(pppoeUserOnRouter.id);
                    let targetProfile = String(oldCustomer.previousPppoeProfile || '').trim();
                    if (!targetProfile) {
                        const [[pkgForRestore]] = await connection.query('SELECT pppoeProfile FROM packages WHERE id = ?', [customerData.packageId || oldCustomer.packageId]);
                        targetProfile = String(pkgForRestore?.pppoeProfile || '').trim();
                    }
                    if (targetProfile) {
                        await mikrotikApi.updatePppoeUser(pppoeUserOnRouter.id, { profile: targetProfile });
                        await syncPppoeCacheProfile(connection, linkedPppoeUsername, targetProfile);
                    }
                    await connection.query('UPDATE customers SET previousPppoeProfile = NULL WHERE id = ?', [id]);
                    await mikrotikApi.reconnectPppoeUser(linkedPppoeUsername);
                }
            }
        }

        await connection.commit();
        if (createNewPppoe) {
            acsPppoeSync = await pushCustomerPppoeToAcs({
                customerId: id,
                pppoeUsername: newPppoeUsername,
                pppoePassword: newPppoePassword,
            });
            if (!acsPppoeSync.success && !acsPppoeSync.skipped) {
                console.warn(`[Customer Update] ACS PPPoE push failed for ${id}:`, acsPppoeSync);
            }
        }

        if (newStatus && newStatus !== oldStatus) {
            if (settings.billing.whatsappNotificationsEnabled && customerToUpdate.phone) {
                let template = null; let logType = '';
                if (newStatus === 'Active' && (oldStatus === 'Suspended' || oldStatus === 'Inactive')) { template = settings.whatsapp.accountReactivated; logType = 'Account Reactivated (Manual)'; }
                else if (newStatus === 'Suspended') { template = settings.whatsapp.accountSuspended; logType = 'Account Suspended (Manual)'; }
                else if (newStatus === 'Inactive') { template = settings.whatsapp.accountDeactivated; logType = 'Account Deactivated (Manual)'; }
                if (template) {
                    const [[pkg]] = await pool.query('SELECT name FROM packages WHERE id = ?', [customerToUpdate.packageId]);
                    const message = replacePlaceholders(template, { customerName: customerToUpdate.name, customerId: id, packageName: pkg?.name || 'N/A' });
                    const waResult = await whatsappService.sendMessage(customerToUpdate.phone, message);
                    await pool.query('INSERT INTO whatsapp_logs SET ?', { recipient_number: customerToUpdate.phone, customer_id: id, message_body: message, status: waResult.success ? 'sent' : 'failed', type: logType, error_message: waResult.error || null });
                }
            }
        }

        res.json({ ...customerToUpdate, id, acsPppoeSync });

    } catch (e) {
        if (connection) await connection.rollback();
        console.error("Error updating customer:", e);
        res.status(500).json({ message: e.message || 'Error updating customer' });
    } finally {
        if (connection) connection.release();
    }
});


router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [[customer]] = await pool.query('SELECT pppoeUsername FROM customers WHERE id = ?', [id]);
        if (customer && customer.pppoeUsername) {
            await mikrotikApi.updatePppoeUserCommentByName(customer.pppoeUsername, '');
            await syncPppoeCacheComment(pool, customer.pppoeUsername, '');
        }

        // --- Delete Bonus Hotspot User ---
        const settings = await getSettings();
        if (settings.billing.bonusVoucherProfile) {
            const voucherPrefix = settings.billing.bonusVoucherPrefix || 'bonus-';
            const bonusUsername = `${voucherPrefix}${id.slice(-4)}`;
            
            try {
                const routerHotspotUsers = await mikrotikApi.fetchHotspotUsers();
                const bonusUser = routerHotspotUsers.find(u => u.name === bonusUsername);
                if (bonusUser) {
                    await mikrotikApi.deleteHotspotUser(bonusUser.id);
                    console.log(`[Customer Delete] Deleted bonus hotspot user ${bonusUsername}.`);
                }
            } catch (mikrotikError) {
                console.warn(`[Customer Delete] Could not delete bonus voucher ${bonusUsername} from router. It may not exist or the router may be offline. Error: ${mikrotikError.message}`);
            }
        }


        await pool.query('DELETE FROM customers WHERE id = ?', [id]);
        res.status(204).send();
    } catch (e) {
        console.error("Error deleting customer:", e);
        res.status(500).json({ message: e.message || 'Error deleting customer' });
    }
});

// Endpoint baru untuk memperbarui ID pelanggan (kunci primer)
router.put('/:id/update-id', async (req, res) => {
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
            await syncPppoeCacheComment(connection, customerToUpdate.pppoeUsername, newId);
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
        console.error("Error updating customer ID:", error);
        res.status(500).json({ message: error.message || 'An internal server error occurred.' });
    } finally {
        if (connection) connection.release();
    }
});


// --- NEW ENDPOINT for customer to edit their own profile ---
router.put('/:id/profile', async (req, res) => {
    const { id } = req.params;
    const { phone, address, location } = req.body;
    
    // Basic validation
    if (!phone || !address) {
        return res.status(400).json({ message: 'Phone and address are required.' });
    }

    // Security check: Make sure the logged-in user can only edit their own profile.
    // The user ID from the JWT should match the ID in the URL parameter.
    if (req.user.role === 'customer' && req.user.id !== id) {
        return res.status(403).json({ message: 'Forbidden: You can only edit your own profile.' });
    }

    try {
        const profileData = {
            phone,
            address,
            location: location ? JSON.stringify(location) : null,
        };

        const [result] = await pool.query('UPDATE customers SET ? WHERE id = ?', [profileData, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Customer not found.' });
        }
        
        // After updating, fetch the complete customer data to create a new token
        const [[updatedCustomer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
        if (!updatedCustomer) {
            return res.status(404).json({ message: 'Could not retrieve updated customer data.' });
        }

        // Create the payload for the new JWT
        const customerPayload = {
            id: updatedCustomer.id,
            name: updatedCustomer.name,
            address: updatedCustomer.address,
            phone: updatedCustomer.phone,
            email: updatedCustomer.email,
            packageId: updatedCustomer.packageId,
            status: updatedCustomer.status,
            pppoeUsername: updatedCustomer.pppoeUsername,
            acsSerialNumber: updatedCustomer.acsSerialNumber,
            role: 'customer'
        };

        // Sign the new token
        const token = jwt.sign(customerPayload, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        // Send the new token back to the frontend
        res.json({ success: true, message: 'Profile updated successfully.', token: token });

    } catch (error) {
        console.error(`Error updating profile for customer ${id}:`, error);
        res.status(500).json({ message: 'An internal server error occurred while updating your profile.' });
    }
});


// --- Package Change Endpoints ---
router.get('/:id/package-change', async (req, res) => {
    try {
        const [[pendingChange]] = await pool.query(
            `SELECT 
                pc.id, 
                pc.customer_id, 
                pc.new_package_id, 
                pc.status, 
                pc.created_at, 
                pc.processed_at, 
                p.name AS new_package_name 
             FROM package_changes pc 
             JOIN packages p ON pc.new_package_id = p.id 
             WHERE pc.customer_id = ? AND pc.status = 'pending' LIMIT 1`,
            [req.params.id]
        );
        res.json(pendingChange || null);
    } catch (e) {
        console.error("Error fetching pending package change:", e);
        res.status(500).json({ message: 'Error fetching package change status.' });
    }
});

router.post('/:id/package-change', async (req, res) => {
    try {
        const { id: customer_id } = req.params;
        const { new_package_id } = req.body;
        
        const [[customer]] = await pool.query('SELECT packageId FROM customers WHERE id = ?', [customer_id]);
        if (!customer) return res.status(404).json({ message: 'Customer not found.' });
        if (customer.packageId == new_package_id) return res.status(400).json({ message: 'You are already subscribed to this package.' });

        // Using INSERT ... ON DUPLICATE KEY UPDATE to handle existing pending requests atomically
        // This requires a UNIQUE key on (customer_id, status)
        await pool.query(
            `INSERT INTO package_changes (customer_id, new_package_id, status) 
             VALUES (?, ?, 'pending') 
             ON DUPLICATE KEY UPDATE new_package_id = VALUES(new_package_id)`,
            [customer_id, new_package_id]
        );
        
        res.status(201).json({ success: true, message: 'Package change scheduled successfully.' });
    } catch (e) {
        console.error("Error scheduling package change:", e);
        res.status(500).json({ message: 'Error scheduling package change.' });
    }
});

router.delete('/:id/package-change', async (req, res) => {
    try {
        const { id: customer_id } = req.params;
        // FIX: Delete the pending request instead of updating its status to 'cancelled'.
        // This avoids a unique key constraint violation if a 'cancelled' record for the customer already exists.
        const [result] = await pool.query(
            "DELETE FROM package_changes WHERE customer_id = ? AND status = 'pending'",
            [customer_id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'No pending package change found to cancel.' });
        }
        res.json({ success: true, message: 'Your package change request has been cancelled.' });
    } catch (e) {
        console.error("Error cancelling package change:", e);
        res.status(500).json({ message: 'Error cancelling package change.' });
    }
});


// --- Complaints ---
router.get('/complaints', async (req, res) => {
    try {
        const { customerId } = req.query;
        let query = 'SELECT * FROM complaints';
        const params = [];

        if (customerId) {
            query += ' WHERE customerId = ?';
            params.push(customerId);
        }
        query += ' ORDER BY dateSubmitted DESC';

        const [rows] = await pool.query(query, params);
        const formattedRows = rows.map(c => {
            const parseJsonField = (jsonString) => {
                if (!jsonString) return [];
                try {
                    const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
                    return Array.isArray(parsed) ? parsed : [];
                } catch (e) {
                    console.error(`Failed to parse JSON field for complaint ${c.id}:`, e);
                    return [];
                }
            }

            return {
                ...c,
                dateSubmitted: dbDateToISO(c.dateSubmitted),
                replies: parseJsonField(c.replies).map(r => ({ ...r, createdAt: dbDateToISO(r.createdAt) })),
                photos: parseJsonField(c.photos),
            };
        });
        res.json(formattedRows);
    } catch (e) {
        console.error(`Error in GET /complaints:`, e);
        res.status(500).send('Error reading complaints data');
    }
});

router.post('/complaints', upload.single('photo'), async (req, res) => {
    try {
        const { customerId, type, description } = req.body;
        const photoFile = req.file;

        const [[customer]] = await pool.query('SELECT c.name, c.phone, p.name as packageName FROM customers c LEFT JOIN packages p ON c.packageId = p.id WHERE c.id = ?', [customerId]);
        if (!customer) {
            if (photoFile) fs.unlinkSync(photoFile.path);
            return res.status(404).json({ message: 'Submitting customer not found.' });
        }
        
        const settings = await getSettings();
        let photos = [];
        if (photoFile) {
            // The URL path should be relative to how it's served by the server
            const photoUrl = `/uploads/${photoFile.filename}`;
            photos.push(photoUrl);
        }

        const newComplaint = {
            id: `TICKET-${Date.now()}`,
            customerId,
            customerName: customer.name,
            dateSubmitted: toMySQLDatetime(new Date(), settings.app.timezone),
            type,
            description,
            status: 'Pending',
            replies: '[]',
            photos: JSON.stringify(photos),
        };

        await pool.query('INSERT INTO complaints SET ?', newComplaint);
        
        // const settings = await getSettings(); // Already fetched
        if (settings.whatsapp?.adminPhoneNumber && settings.whatsapp?.newComplaintNotification) {
            const message = replacePlaceholders(settings.whatsapp.newComplaintNotification, {
                customerName: newComplaint.customerName,
                customerId: newComplaint.customerId,
                customerPhone: customer.phone,
                packageName: customer.packageName || 'N/A',
                complaintType: newComplaint.type,
                description: newComplaint.description,
            });
            const result = await whatsappService.sendMessage(settings.whatsapp.adminPhoneNumber, message);
            await pool.query('INSERT INTO whatsapp_logs SET ?', {
                recipient_number: settings.whatsapp.adminPhoneNumber,
                customer_id: newComplaint.customerId,
                message_body: message,
                status: result.success ? 'sent' : 'failed',
                type: 'Admin Complaint Notification',
                error_message: result.error || null,
            });
        }

        res.status(201).json(newComplaint);
    } catch (e) {
        console.error("Error creating complaint:", e);
        if (req.file) fs.unlinkSync(req.file.path);
        res.status(500).json({ message: 'Error creating complaint' });
    }
});

router.put('/complaints/:id', async (req, res) => {
    const { id } = req.params;
    const { status, assignedTo } = req.body;

    try {
        // 1. Get the current state of the complaint BEFORE updating
        const [[oldComplaint]] = await pool.query('SELECT * FROM complaints WHERE id = ?', [id]);
        if (!oldComplaint) {
            return res.status(404).json({ message: 'Complaint not found.' });
        }

        // 2. Prepare the update payload
        const fieldsToUpdate = {};
        if (status) fieldsToUpdate.status = status;
        if (typeof assignedTo !== 'undefined') fieldsToUpdate.assignedTo = assignedTo || null;

        // 3. Perform the database update if there are changes
        if (Object.keys(fieldsToUpdate).length > 0) {
            await pool.query('UPDATE complaints SET ? WHERE id = ?', [fieldsToUpdate, id]);
        }

        // 4. Check if a technician was newly assigned and send notification
        if (assignedTo && assignedTo !== oldComplaint.assignedTo) {
            console.log(`[Notification] New assignment detected for complaint ${id} to technician ${assignedTo}`);
            const settings = await getSettings();
            
            if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp.technicianTaskAssignment) {
                const [[technician]] = await pool.query('SELECT username, phone FROM users WHERE id = ? AND role = "technician"', [assignedTo]);
                
                if (technician && technician.phone) {
                    const [[complaintDetails]] = await pool.query('SELECT co.*, cu.name as customerName, cu.address as customerAddress FROM complaints co JOIN customers cu ON co.customerId = cu.id WHERE co.id = ?', [id]);
                    
                    const message = replacePlaceholders(settings.whatsapp.technicianTaskAssignment, {
                        technicianName: technician.username,
                        ticketId: complaintDetails.id,
                        customerName: complaintDetails.customerName,
                        customerAddress: complaintDetails.customerAddress,
                        complaintType: complaintDetails.type,
                        complaintDescription: complaintDetails.description,
                    });

                    const waResult = await whatsappService.sendMessage(technician.phone, message);
                    
                    await pool.query('INSERT INTO whatsapp_logs SET ?', {
                        recipient_number: technician.phone,
                        customer_id: null,
                        message_body: message,
                        status: waResult.success ? 'sent' : 'failed',
                        type: 'Technician Assignment',
                        error_message: waResult.error || null,
                    });
                } else {
                    console.warn(`[Notification] Could not send assignment notification for complaint ${id}: Technician ${assignedTo} not found or has no phone number.`);
                }
            }
        }

        const [[updatedComplaint]] = await pool.query('SELECT * FROM complaints WHERE id = ?', [id]);
        res.json(updatedComplaint);

    } catch (e) {
        console.error("Error updating complaint:", e);
        res.status(500).json({ message: 'Error updating complaint' });
    }
});

router.post('/complaints/:id/reply', upload.single('photo'), async (req, res) => {
    try {
        const { id } = req.params;
        const { replyText, repliedBy } = req.body;
        const photoFile = req.file;
        const settings = await getSettings();

        // Allow replies with only a photo
        if ((!replyText || !replyText.trim()) && !photoFile) {
            return res.status(400).json({ message: 'Reply must contain text or a photo.' });
        }
         if (!repliedBy) {
            if (photoFile) fs.unlinkSync(photoFile.path);
            return res.status(400).json({ message: 'Replier identity is required.' });
        }


        const [[complaint]] = await pool.query('SELECT replies, customerId FROM complaints WHERE id = ?', [id]);
        if (!complaint) {
            if (photoFile) fs.unlinkSync(photoFile.path);
            return res.status(404).json({ message: 'Complaint not found.' });
        }

        const [users] = await pool.query('SELECT role FROM users WHERE username = ?', [repliedBy]);
        const user = users[0];
        const senderType = (user && (user.role === 'admin' || user.role === 'technician' || user.role === 'reseller')) ? 'admin' : 'customer';

        let replies = [];
        try {
            if (complaint.replies) {
                replies = JSON.parse(complaint.replies);
            }
        } catch (e) {
            console.error(`Could not parse replies for complaint ${id}. Starting fresh. Error:`, e);
            replies = [];
        }
        
        const newReply = {
            id: `REP-${Date.now()}`,
            senderType: senderType,
            senderName: repliedBy,
            replyText: replyText || '',
            createdAt: toMySQLDatetime(new Date(), settings.app.timezone),
            photos: [],
        };

        if (photoFile) {
            const photoUrl = `/uploads/${photoFile.filename}`;
            newReply.photos.push(photoUrl);
        }

        replies.push(newReply);

        await pool.query('UPDATE complaints SET replies = ? WHERE id = ?', [JSON.stringify(replies), id]);

        res.status(201).json(newReply);
    } catch (e) {
        console.error("Error adding complaint reply:", e);
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error("Error deleting temp file on reply failure:", err);
            });
        }
        res.status(500).json({ message: 'Error adding reply.' });
    }
});

router.post('/complaints/bulk-delete', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of complaint IDs is required.' });
    }

    try {
        const [result] = await pool.query('DELETE FROM complaints WHERE id IN (?)', [ids]);
        if (result.affectedRows === 0) {
            console.warn(`Bulk delete requested for ${ids.length} complaints, but none were found/deleted.`);
        }
        res.json({ success: true, message: `${result.affectedRows} complaint(s) deleted successfully.` });
    } catch (error) {
        console.error("Error during bulk complaint deletion:", error);
        res.status(500).json({ message: 'An error occurred while deleting complaints.' });
    }
});


// --- Bulk Actions ---
router.post('/bulk-status', async (req, res) => {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !['Active', 'Suspended', 'Inactive', 'Unregister'].includes(status)) {
        return res.status(400).json({ message: 'A valid status and an array of customer IDs are required.' });
    }

    try {
        const settings = await getSettings();
        const suspensionProfile = settings.billing.suspensionProfileName;
        
        if (status === 'Suspended' && !suspensionProfile) {
             return res.status(400).json({ message: 'Suspension profile name is not configured in settings.' });
        }
        
        const [customers] = await pool.query('SELECT id, pppoeUsername, status, previousPppoeProfile, packageId FROM customers WHERE id IN (?)', [ids]);
        const routerUsers = await mikrotikApi.fetchPppoeUsers();

        for (const customer of customers) {
            const { username: linkedPppoeUsername, routerUser: pppoeUser } = await resolveCustomerPppoeLink(pool, customer, routerUsers);
            if (!pppoeUser) continue;

            if (status === 'Suspended' && customer.status !== 'Suspended') {
                await pool.query('UPDATE customers SET status = ?, previousPppoeProfile = ? WHERE id = ?', [status, pppoeUser.profile, customer.id]);
                await mikrotikApi.updatePppoeUser(pppoeUser.id, { profile: suspensionProfile });
                await syncPppoeCacheProfile(pool, linkedPppoeUsername, suspensionProfile);
                await mikrotikApi.reconnectPppoeUser(linkedPppoeUsername);
            } else if (status === 'Active' && customer.status === 'Suspended') {
                let targetProfile = String(customer.previousPppoeProfile || '').trim();
                if (!targetProfile) {
                    const [[pkg]] = await pool.query('SELECT pppoeProfile FROM packages WHERE id = ?', [customer.packageId]);
                    targetProfile = String(pkg?.pppoeProfile || '').trim();
                }
                if (targetProfile) {
                    await mikrotikApi.updatePppoeUser(pppoeUser.id, { profile: targetProfile });
                    await syncPppoeCacheProfile(pool, linkedPppoeUsername, targetProfile);
                    await mikrotikApi.reconnectPppoeUser(linkedPppoeUsername);
                }
                await pool.query('UPDATE customers SET status = ?, previousPppoeProfile = NULL WHERE id = ?', [status, customer.id]);
            } else {
                 await pool.query('UPDATE customers SET status = ? WHERE id = ?', [status, customer.id]);
            }
        }
        
        res.json({ success: true, message: `Updated ${ids.length} customers to ${status}.` });
    } catch (e) {
        console.error('Error in bulk status update:', e);
        res.status(500).json({ message: e.message || 'Server error during bulk status update.' });
    }
});

router.post('/repair-pppoe-links', async (req, res) => {
    try {
        const [customers] = await pool.query('SELECT id, pppoeUsername FROM customers');
        const routerUsers = await mikrotikApi.fetchPppoeUsers();

        const routerByUsername = new Map();
        const routerByComment = new Map();

        for (const user of routerUsers) {
            const username = normalizePppoeUsername(user.name);
            const comment = normalizeCustomerId(user.comment);
            if (username && !routerByUsername.has(username)) {
                routerByUsername.set(username, user);
            }
            if (comment && !routerByComment.has(comment)) {
                routerByComment.set(comment, user);
            }
        }

        let fixedUsernameCount = 0;
        let fixedCommentCount = 0;
        let notFoundOnRouterCount = 0;
        let skippedConflictCount = 0;
        const seenUsernames = new Set();

        for (const customer of customers) {
            const customerId = normalizeCustomerId(customer.id);
            const storedUsername = normalizePppoeUsername(customer.pppoeUsername);
            let routerUser = storedUsername ? routerByUsername.get(storedUsername) : null;

            if (!routerUser && customerId) {
                routerUser = routerByComment.get(customerId) || null;
                const resolvedUsername = normalizePppoeUsername(routerUser?.name);
                if (resolvedUsername && resolvedUsername !== storedUsername) {
                    await pool.query('UPDATE customers SET pppoeUsername = ? WHERE id = ?', [resolvedUsername, customerId]);
                    fixedUsernameCount += 1;
                }
            }

            const resolvedUsername = normalizePppoeUsername(routerUser?.name);
            if (!resolvedUsername || !routerUser) {
                notFoundOnRouterCount += 1;
                continue;
            }

            if (seenUsernames.has(resolvedUsername) && storedUsername !== resolvedUsername) {
                skippedConflictCount += 1;
                continue;
            }
            seenUsernames.add(resolvedUsername);

            const currentComment = normalizeCustomerId(routerUser.comment);
            if (customerId && currentComment !== customerId) {
                await mikrotikApi.updatePppoeUserCommentByName(resolvedUsername, customerId);
                fixedCommentCount += 1;
            }
            await syncPppoeCacheComment(pool, resolvedUsername, customerId);
        }

        res.json({
            success: true,
            message: 'PPPoE link repair completed.',
            fixedUsernameCount,
            fixedCommentCount,
            notFoundOnRouterCount,
            skippedConflictCount,
            totalCustomers: customers.length,
            totalRouterUsers: routerUsers.length,
        });
    } catch (error) {
        console.error('Error repairing PPPoE links:', error);
        res.status(500).json({ message: error.message || 'Failed to repair PPPoE links.' });
    }
});

router.post('/bulk-delete', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of customer IDs is required.' });
    }
    try {
        // --- 1. Unlink PPPoE comments ---
        const [customers] = await pool.query('SELECT pppoeUsername FROM customers WHERE id IN (?)', [ids]);
        for (const customer of customers) {
            if (customer.pppoeUsername) {
                await mikrotikApi.updatePppoeUserCommentByName(customer.pppoeUsername, '');
                await syncPppoeCacheComment(pool, customer.pppoeUsername, '');
            }
        }
        
        // --- 2. Delete Bonus Vouchers ---
        const settings = await getSettings();
        if (settings.billing.bonusVoucherProfile) {
            const voucherPrefix = settings.billing.bonusVoucherPrefix || 'bonus-';
            try {
                const routerHotspotUsers = await mikrotikApi.fetchHotspotUsers();
                for (const id of ids) {
                    const bonusUsername = `${voucherPrefix}${id.slice(-4)}`;
                    const bonusUser = routerHotspotUsers.find(u => u.name === bonusUsername);
                    if (bonusUser) {
                        await mikrotikApi.deleteHotspotUser(bonusUser.id);
                        console.log(`[Customer Bulk Delete] Deleted bonus hotspot user ${bonusUsername}.`);
                    }
                }
            } catch (mikrotikError) {
                console.warn(`[Customer Bulk Delete] An error occurred while trying to delete bonus vouchers from the router. The process will continue. Error: ${mikrotikError.message}`);
            }
        }

        // --- 3. Delete Customers from DB ---
        await pool.query('DELETE FROM customers WHERE id IN (?)', [ids]);
        res.json({ success: true, message: `${ids.length} customers deleted.` });
    } catch (e) {
        console.error('Error in bulk delete:', e);
        res.status(500).json({ message: e.message || 'Server error during bulk delete.' });
    }
});

router.post('/bulk-whatsapp', async (req, res) => {
    const { ids, message } = req.body;
     if (!Array.isArray(ids) || ids.length === 0 || !message) {
        return res.status(400).json({ success: false, message: 'Customer IDs and a message are required.' });
    }

    try {
        const settings = await getSettings();
        whatsappService.applySettings(settings);
        const [targetCustomers] = await pool.query('SELECT phone, name, id FROM customers WHERE id IN (?) AND phone IS NOT NULL AND phone != ""', [ids]);

        if (targetCustomers.length === 0) {
            return res.json({ success: true, message: 'No selected customers have a valid phone number.' });
        }

        let sentCount = 0;
        for (const customer of targetCustomers) {
            const personalizedMessage = replacePlaceholders(message, { customerName: customer.name, customerId: customer.id });
            const result = await whatsappService.sendMessage(customer.phone, personalizedMessage);
            await pool.query('INSERT INTO whatsapp_logs SET ?', {
                recipient_number: customer.phone,
                customer_id: customer.id,
                message_body: personalizedMessage,
                status: result.success ? 'sent' : 'failed',
                type: 'Bulk Message',
                error_message: result.error || null,
            });
            if(result.success) sentCount++;
            await new Promise(resolve => setTimeout(resolve, Math.random() * 800 + 300));
        }
        res.json({ success: true, message: `Message sent to ${sentCount} out of ${ids.length} selected customers.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'An unexpected error occurred during bulk messaging.' });
    }
});

router.post('/import', async (req, res) => {
    const customers = req.body;
    if (!Array.isArray(customers) || customers.length === 0) {
        return res.status(400).json({ message: 'No customer data provided.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const settings = await getSettings();
        const prefix = settings.app.customerIdPrefix || 'CUS';

        let insertedCount = 0;
        let updatedCount = 0;

        for (const customer of customers) {
            // Use the consistent ID generation logic here
            const customerId = customer.id || generateNewCustomerId(prefix);

            const latValue = customer.lat ?? customer.location?.lat;
            const lngValue = customer.lng ?? customer.location?.lng;
            const hasLat = latValue !== undefined && latValue !== null && latValue !== '';
            const hasLng = lngValue !== undefined && lngValue !== null && lngValue !== '';
            const parsedLat = hasLat ? parseFloat(latValue) : null;
            const parsedLng = hasLng ? parseFloat(lngValue) : null;
            const hasValidLocation = parsedLat !== null && !Number.isNaN(parsedLat) && parsedLng !== null && !Number.isNaN(parsedLng);

            const parsedPackageId = customer.packageId !== undefined && customer.packageId !== null ? parseInt(customer.packageId) : null;
            const voucherBalanceRaw = customer.voucher_balance ?? customer.voucherBalance;
            const parsedVoucherBalance = voucherBalanceRaw !== undefined && voucherBalanceRaw !== null && voucherBalanceRaw !== '' ? parseFloat(voucherBalanceRaw) : 0;

            const customerData = {
                id: customerId,
                name: customer.name,
                nik: customer.nik || null,
                address: customer.address || null,
                phone: customer.phone,
                email: customer.email || null,
                packageId: Number.isNaN(parsedPackageId) ? null : parsedPackageId,
                status: customer.status || 'Active',
                location: hasValidLocation ? JSON.stringify({ lat: parsedLat, lng: parsedLng }) : null,
                odpId: customer.odpId || null,
                pppoeUsername: customer.pppoeUsername || null,
                activeDate: customer.activeDate ? toMySQLDatetime(new Date(customer.activeDate), settings.app.timezone) : toMySQLDatetime(new Date(), settings.app.timezone),
                acsSerialNumber: customer.acsSerialNumber || null,
                previousPppoeProfile: customer.previousPppoeProfile || null,
                voucher_balance: Number.isNaN(parsedVoucherBalance) ? 0 : parsedVoucherBalance,
                billing_type: customer.billing_type === 'fixed' ? 'fixed' : 'postpaid',
            };

            // Basic validation
            if (!customerData.name || !customerData.phone || !customerData.packageId) {
                console.warn('Skipping invalid customer row:', customer);
                continue;
            }

            const columns = Object.keys(customerData).map(c => `\`${c}\``).join(', ');
            const placeholders = Object.keys(customerData).map(() => '?').join(', ');
            const values = Object.values(customerData);

            const onUpdateClauses = Object.keys(customerData)
                .filter(key => key !== 'id')
                .map(key => `\`${key}\` = VALUES(\`${key}\`)`)
                .join(', ');

            const query = `INSERT INTO customers (${columns}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${onUpdateClauses}`;
            
            const [result] = await connection.query(query, values);
            
            // affectedRows is 1 for an insert, 2 for an update, 0 for no change
            if (result.affectedRows === 1) insertedCount++;
            if (result.affectedRows === 2) updatedCount++;
        }

        await connection.commit();
        res.json({
            success: true,
            message: `Import complete. Added ${insertedCount} new customers and updated ${updatedCount} existing customers.`
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error during customer import:', error);
        res.status(500).json({ message: 'An error occurred during import. No data was changed.' });
    } finally {
        connection.release();
    }
});

// --- NEW ENDPOINT FOR LIVE TRAFFIC ---
router.get('/:id/live-traffic', async (req, res) => {
    const { id } = req.params;
    try {
        const [[customer]] = await pool.query('SELECT pppoeUsername FROM customers WHERE id = ?', [id]);
        if (!customer || !customer.pppoeUsername) {
            return res.status(404).json({ error: 'Customer or linked PPPoE user not found.' });
        }
        
        const username = customer.pppoeUsername;
        const traffic = await mikrotikApi.monitorTrafficForPppoeUser(username);
        
        res.json(traffic);

    } catch (error) {
        console.error(`Error fetching live traffic for customer ${id}:`, error);
        // Don't send a 500 for a single poll failure, just report it.
        res.json({ error: 'Failed to retrieve live data from router.', rx: 0, tx: 0 });
    }
});

// NEW ENDPOINT for customer portal settings
router.get('/app-settings', async (req, res) => {
    try {
        const settings = await getSettings();
        // Only expose non-sensitive settings needed for the customer portal (e.g., for PDF generation)
        const portalSettings = {
            app: {
                appName: settings.app.appName,
                companyAddress: settings.app.companyAddress,
                companyPhone: settings.app.companyPhone,
            },
            billing: { // Juga ekspos taxRate
                taxRate: settings.billing.taxRate,
            },
            video: {
                enabled: Boolean(settings.video?.enabled && (settings.video?.playlistUrl || settings.video?.playlistText)),
                title: settings.video?.title || 'TV Channel',
                playlistUrl: settings.video?.playlistUrl || '',
                playlistText: settings.video?.playlistText || '',
                posterUrl: settings.video?.posterUrl || '',
                description: settings.video?.description || '',
                autoplay: Boolean(settings.video?.autoplay),
                loop: Boolean(settings.video?.loop),
                controls: settings.video?.controls !== false,
            }
        };
        res.json(portalSettings);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching application settings.' });
    }
});

router.get('/media-token', async (req, res) => {
    try {
        const customerId = req.user?.id;
        if (!customerId) {
            return res.status(401).json({ message: 'Unauthorized.' });
        }

        const token = jwt.sign(
            { sub: customerId, scope: 'media' },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );

        res.json({ token, expiresInSeconds: 15 * 60 });
    } catch (error) {
        console.error('[Customer Media Token] Failed:', error);
        res.status(500).json({ message: 'Failed to generate media token.' });
    }
});

router.get('/playlist-source', async (req, res) => {
    try {
        const rawUrl = String(req.query.url || '').trim();
        if (!rawUrl) {
            return res.status(400).json({ message: 'URL playlist tidak tersedia.' });
        }

        if (!/^https?:\/\//i.test(rawUrl)) {
            return res.status(400).json({ message: 'Hanya URL http(s) yang dapat diproxy.' });
        }

        const playlistHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        };

        const fetchPlaylistText = async (targetUrl) => {
            const response = await fetch(targetUrl, {
                headers: playlistHeaders,
                redirect: 'follow',
            });
            const body = await response.text();
            return { response, body };
        };

        let { response, body } = await fetchPlaylistText(rawUrl);

        const looksLikePlaylist = body.includes('#EXTINF') || body.includes('#EXTM3U');
        const looksLikeHtml = /<\s*html/i.test(body) || /<!doctype html/i.test(body);

        if ((!response.ok || !looksLikePlaylist) && looksLikeHtml) {
            const urlMatches = Array.from(body.matchAll(/https?:\/\/[^\s"'<>]+/gi)).map((match) => match[0]);
            const fallbackUrl = urlMatches.find((candidate) => candidate !== rawUrl && !candidate.includes('googleapis.com')) || null;
            if (fallbackUrl) {
                const retry = await fetchPlaylistText(fallbackUrl);
                response = retry.response;
                body = retry.body;
            }
        }

        if (!response.ok) {
            return res.status(response.status).json({ message: `Gagal mengambil playlist (${response.status})` });
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(body);
    } catch (error) {
        console.error('[Customer Playlist Proxy] Failed:', error);
        res.status(500).json({ message: error.message || 'Gagal mengambil playlist.' });
    }
});

// GET My Bonus Voucher (for logged-in customer)
router.get('/my-bonus-voucher', async (req, res) => {
    const customerId = req.user.id;
    const settings = await getSettings();
    const voucherPrefix = settings.billing.bonusVoucherPrefix || 'bonus-';
    const bonusUsername = `${voucherPrefix}${customerId.slice(-4)}`;

    try {
        const hotspotUsers = await mikrotikApi.fetchHotspotUsers();
        const bonusVoucher = hotspotUsers.find(u => u.name === bonusUsername);
        
        if (!bonusVoucher) {
            return res.json(null);
        }
        
        // Ensure password is included for display
        if (!bonusVoucher.password) {
            bonusVoucher.password = bonusVoucher.name;
        }

        res.json(bonusVoucher);
    } catch (e) {
        console.error(`Error fetching bonus voucher for customer ${customerId}:`, e);
        res.status(500).json({ message: e.message || "Failed to fetch bonus voucher from router." });
    }
});


// GET Bonus Voucher for a specific customer (for Admin)
router.get('/:id/bonus-voucher', async (req, res) => {
    // Basic role check for security
    if (req.user.role !== 'admin' && req.user.role !== 'technician' && req.user.role !== 'reseller') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    
    const { id: customerId } = req.params;
    const settings = await getSettings();
    const voucherPrefix = settings.billing.bonusVoucherPrefix || 'bonus-';
    const bonusUsername = `${voucherPrefix}${customerId.slice(-4)}`;

    try {
        const hotspotUsers = await mikrotikApi.fetchHotspotUsers();
        const bonusVoucher = hotspotUsers.find(u => u.name === bonusUsername);

        if (!bonusVoucher) {
            return res.json(null);
        }

        // Ensure password is included for display
        if (!bonusVoucher.password) {
            bonusVoucher.password = bonusVoucher.name;
        }
        
        res.json(bonusVoucher);
    } catch (e) {
        console.error(`Error fetching bonus voucher for customer ${customerId} by admin:`, e);
        res.status(500).json({ message: e.message || "Failed to fetch bonus voucher from router." });
    }
});

// POST /:id/create-bonus-voucher - Manually create a bonus voucher for an existing customer
router.post('/:id/create-bonus-voucher', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }

    const { id: customerId } = req.params;

    try {
        const settings = await getSettings();
        const profile = settings.billing.bonusVoucherProfile;
        if (!profile) {
            return res.status(400).json({ message: 'Bonus Hotspot Profile is not configured in Billing Settings.' });
        }

        const [[customer]] = await pool.query('SELECT TRIM(status) as status, packageId FROM customers WHERE id = ?', [customerId]);
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }
        
        const eligiblePackages = settings.billing.bonusVoucherPackageIds || [];
        const isPackageEligible = eligiblePackages.length === 0 || eligiblePackages.includes(Number(customer.packageId));

        if (!isPackageEligible) {
            return res.status(403).json({ message: "This customer's package is not eligible for a bonus voucher." });
        }
        
        const voucherPrefix = settings.billing.bonusVoucherPrefix || 'bonus-';
        const bonusUsername = `${voucherPrefix}${customerId.slice(-4)}`;
        const bonusPassword = bonusUsername;
        
        // Check if user already exists on router
        const routerUsers = await mikrotikApi.fetchHotspotUsers();
        const existingUser = routerUsers.find(u => u.name === bonusUsername);
        if (existingUser) {
            return res.status(409).json({ message: `A voucher named '${bonusUsername}' already exists on the router.` });
        }

        const isDisabled = customer.status !== 'Active';

        await mikrotikApi.addHotspotUser({
            name: bonusUsername,
            password: bonusPassword,
            profile: profile,
            comment: `Bonus for ${customerId}`,
            disabled: isDisabled ? 'yes' : 'no'
        });

        // Fetch the newly created user to return its details
        const updatedRouterUsers = await mikrotikApi.fetchHotspotUsers();
        const newUser = updatedRouterUsers.find(u => u.name === bonusUsername);

        if (!newUser) {
            throw new Error("Failed to create voucher on router or could not retrieve it after creation.");
        }
        
        if (!newUser.password) {
            newUser.password = newUser.name;
        }

        res.status(201).json(newUser);

    } catch (error) {
        console.error(`Error creating bonus voucher for customer ${customerId}:`, error);
        res.status(500).json({ message: error.message || "An internal server error occurred." });
    }
});

router.post('/sync-bonus-vouchers', async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }

    try {
        const settings = await getSettings();
        const bonusProfile = settings.billing.bonusVoucherProfile;
        if (!bonusProfile) {
            return res.status(400).json({ message: 'Bonus Hotspot Profile is not configured in Settings.' });
        }

        const eligiblePackages = settings.billing.bonusVoucherPackageIds || [];
        let query = "SELECT id, status, packageId FROM customers WHERE status = 'Active'";
        if (eligiblePackages.length > 0) {
            query += ` AND packageId IN (${eligiblePackages.map(() => '?').join(',')})`;
        }
        const [eligibleCustomers] = await pool.query(query, eligiblePackages);

        const routerUsers = await mikrotikApi.fetchHotspotUsers();
        const existingUsernames = new Set(routerUsers.map(u => u.name));
        
        const voucherPrefix = settings.billing.bonusVoucherPrefix || 'bonus-';
        let createdCount = 0;

        for (const customer of eligibleCustomers) {
            const bonusUsername = `${voucherPrefix}${customer.id.slice(-4)}`;
            if (!existingUsernames.has(bonusUsername)) {
                await mikrotikApi.addHotspotUser({
                    name: bonusUsername,
                    password: bonusUsername,
                    profile: bonusProfile,
                    comment: `Bonus for ${customer.id}`,
                    disabled: 'no'
                });
                createdCount++;
            }
        }

        res.json({ message: `Sync complete. Created ${createdCount} new bonus vouchers for eligible active customers.` });

    } catch (error) {
        console.error("Error syncing bonus vouchers:", error);
        res.status(500).json({ message: error.message || "An internal server error occurred during sync." });
    }
});


export default router;
