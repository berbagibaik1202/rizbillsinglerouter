
// backend/routes/billingRoutes.js

import express from 'express';
import pool from '../db.js';
import { dbDateToISO, getSettings, calculateBillingDetails, replacePlaceholders, formatRupiah, formatBillingPeriod, formatDateDisplay, generateNewInvoiceId, parseLocalDateString, dateToYMD, toMySQLDatetime, getCurrentFixedCycleStart, addMonthsKeepDay } from '../utils.js';
import tripayService from '../tripayService.js';
import whatsappService from '../whatsappService.js';
import { restoreCustomerProfile } from '../services.js';
import mikrotikApi from '../mikrotik-api.js';
import { recordCashMutation, getCashSummary } from '../cashMutationService.js';
import { sendInvoiceEmailNotification } from '../emailService.js';

const router = express.Router();

const isFixedBillingType = (value) => String(value || '').trim().toLowerCase() === 'fixed';
const isNonPositiveNumber = (value) => {
    const numericValue = Number(value);
    return !Number.isFinite(numericValue) || numericValue <= 0;
};

const resolveInvoiceStatus = (status, dueDate, timezone) => {
    const normalizedStatus = String(status || 'Unpaid').trim();
    if (normalizedStatus !== 'Unpaid') {
        return normalizedStatus;
    }

    const dueDateObj = parseLocalDateString(dueDate);
    if (!dueDateObj) {
        return normalizedStatus;
    }

    return dateToYMD(dueDateObj, timezone) < dateToYMD(new Date(), timezone) ? 'Overdue' : normalizedStatus;
};

const toDateOnlyString = (value, fallback, timezone) => {
    const parsed = parseLocalDateString(value) || parseLocalDateString(fallback);
    if (!parsed) return null;
    return dateToYMD(parsed, timezone);
};

const isValidFixedCycleStart = (customer, targetBillingPeriodStart, timezone) => {
    const targetDate = parseLocalDateString(targetBillingPeriodStart);
    const activeDate = parseLocalDateString(customer?.activeDate);
    if (!targetDate || !activeDate) return false;

    let cursor = new Date(activeDate);
    cursor.setHours(0, 0, 0, 0);

    const targetKey = dateToYMD(targetDate, timezone);
    const targetTime = new Date(targetDate);
    targetTime.setHours(0, 0, 0, 0);

    for (let i = 0; i < 600; i += 1) {
        if (dateToYMD(cursor, timezone) === targetKey) {
            return true;
        }

        const nextCursor = addMonthsKeepDay(cursor, 1);
        if (!nextCursor || nextCursor > targetTime) {
            break;
        }
        cursor = nextCursor;
    }

    return false;
};

const getFixedCycleStart = (customer, referenceDate, timezone, requestedTargetPeriodStart = null) => {
    if (requestedTargetPeriodStart) {
        if (!isValidFixedCycleStart(customer, requestedTargetPeriodStart, timezone)) {
            return null;
        }
        return parseLocalDateString(requestedTargetPeriodStart);
    }

    return getCurrentFixedCycleStart(customer, referenceDate, timezone);
};

// --- Payments ---
router.get('/payments', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM payments');
        const formattedRows = rows.map(p => ({ ...p, date: dbDateToISO(p.date) }));
        res.json(formattedRows);
    } catch (e) {
        res.status(500).send('Error reading payments data');
    }
});

router.post('/payments', async (req, res) => {
    try {
        const { invoiceId, customerId, amount, method, sold_by_user_id } = req.body;
        const settings = await getSettings();
        const newPayment = {
            id: `PAY-${Date.now()}`,
            invoiceId,
            customerId: customerId || null,
            date: toMySQLDatetime(new Date(), settings.app.timezone),
            amount,
            method,
            sold_by_user_id: sold_by_user_id || null
        };
        await pool.query('INSERT INTO payments SET ?', newPayment);
        await recordCashMutation(pool, {
            date: newPayment.date,
            direction: 'in',
            category: 'manual_payment',
            amount: newPayment.amount,
            method: newPayment.method,
            description: `Pembayaran manual ${newPayment.invoiceId || newPayment.id}`,
            reference_type: 'payment',
            reference_id: newPayment.id,
            customer_id: newPayment.customerId,
            user_id: newPayment.sold_by_user_id,
            created_by: req.user?.id || null,
            source: 'manual',
            timezone: settings.app.timezone,
        });
        res.status(201).json(newPayment);
    } catch (e) {
        console.error("Error creating manual payment:", e);
        res.status(500).send('Error creating payment');
    }
});

router.post('/payments/bulk-delete', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of payment IDs is required.' });
    }
    try {
        await pool.query("DELETE FROM cash_mutations WHERE reference_type = 'payment' AND reference_id IN (?)", [ids]);
        const [result] = await pool.query('DELETE FROM payments WHERE id IN (?)', [ids]);
        if (result.affectedRows === 0) {
            console.warn(`Bulk delete requested for ${ids.length} payments, but none were found/deleted.`);
        }
        res.json({ success: true, message: `${result.affectedRows} transaction(s) deleted successfully.` });
    } catch (e) {
        console.error("Error during bulk payment deletion:", e);
        res.status(500).json({ message: 'An error occurred while deleting transactions.' });
    }
});

router.get('/cash-mutations', async (req, res) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    try {
        const { startDate, endDate, limit } = req.query;
        const params = [];
        let sql = `
            SELECT
                cm.*,
                c.name AS customer_name,
                u.username AS user_name,
                cb.username AS created_by_name
            FROM cash_mutations cm
            LEFT JOIN customers c ON c.id = cm.customer_id
            LEFT JOIN users u ON u.id = cm.user_id
            LEFT JOIN users cb ON cb.id = cm.created_by
            WHERE 1=1
        `;

        if (startDate) {
            sql += ' AND DATE(cm.date) >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND DATE(cm.date) <= ?';
            params.push(endDate);
        }

        sql += ' ORDER BY cm.date DESC';

        if (limit) {
            sql += ' LIMIT ?';
            params.push(Number(limit));
        }

        const [rows] = await pool.query(sql, params);
        res.json(rows.map(row => ({ ...row, date: dbDateToISO(row.date), created_at: dbDateToISO(row.created_at) })));
    } catch (error) {
        console.error("Error reading cash mutations:", error);
        res.status(500).json({ message: 'Error reading cash mutations.' });
    }
});

router.get('/cash-summary', async (req, res) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    try {
        const settings = await getSettings();
        const summary = await getCashSummary(pool, settings.app.timezone || 'Asia/Jakarta');
        res.json(summary);
    } catch (error) {
        console.error("Error reading cash summary:", error);
        res.status(500).json({ message: 'Error reading cash summary.' });
    }
});

router.post('/cash-mutations', async (req, res) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }

    try {
        const { date, direction, category, amount, method, description, customer_id, user_id } = req.body;
        if (!amount || Number(amount) <= 0 || !category) {
            return res.status(400).json({ message: 'Amount and category are required.' });
        }

        const settings = await getSettings();
        const mutation = await recordCashMutation(pool, {
            date: date || toMySQLDatetime(new Date(), settings.app.timezone),
            direction,
            category,
            amount,
            method,
            description,
            customer_id: customer_id || null,
            user_id: user_id || null,
            created_by: req.user.id,
            source: 'manual',
            timezone: settings.app.timezone,
        });

        res.status(201).json(mutation);
    } catch (error) {
        console.error("Error creating cash mutation:", error);
        res.status(500).json({ message: error.message || 'Error creating cash mutation.' });
    }
});

router.post('/cash-mutations/bulk-delete', async (req, res) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of cash mutation IDs is required.' });
    }

    try {
        const [result] = await pool.query(
            "DELETE FROM cash_mutations WHERE id IN (?) AND source = 'manual'",
            [ids]
        );
        res.json({ success: true, message: `${result.affectedRows} cash mutation(s) deleted.` });
    } catch (error) {
        console.error("Error deleting cash mutations:", error);
        res.status(500).json({ message: 'Failed to delete cash mutations.' });
    }
});


// --- Invoices ---
router.get('/invoices', async (req, res) => {
    try {
        const { customerId } = req.query;
        let query = 'SELECT * FROM invoices';
        const params = [];

        if (customerId) {
            query += ' WHERE customerId = ?';
            params.push(customerId);
        }
        query += ' ORDER BY issueDate DESC';

        const [rows] = await pool.query(query, params);
        
        const formattedRows = rows.map(invoice => ({
            ...invoice,
            issueDate: dbDateToISO(invoice.issueDate),
            dueDate: dbDateToISO(invoice.dueDate),
            billingPeriodStart: dbDateToISO(invoice.billingPeriodStart),
            billingPeriodEnd: dbDateToISO(invoice.billingPeriodEnd),
        }));
        
        res.json(formattedRows);
    } catch (e) {
        console.error("Error reading invoices data:", e);
        res.status(500).send('Error reading data for invoices');
    }
});

router.post('/invoices/calculate', async (req, res) => {
    try {
        const { customerId, targetBillingPeriodStart } = req.body;
        
        if (!customerId) {
            return res.status(400).json({ message: 'customerId is required.' });
        }

        // 1. Fetch necessary data
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [customerId]);
        if (!customer) return res.status(404).json({ message: 'Customer not found.' });

        const [[customerPackage]] = await pool.query('SELECT * FROM packages WHERE id = ?', [customer.packageId]);
        if (!customerPackage) return res.status(404).json({ message: 'Customer package not found.' });
        
        const settings = await getSettings();
        const tz = settings.app.timezone;
        
        let targetBillingPeriodStr;
        // 2. Determine the correct target billing period
        if (isFixedBillingType(customer.billing_type)) {
            const selectedCycleStart = getFixedCycleStart(customer, new Date(), tz, targetBillingPeriodStart);
            if (!selectedCycleStart) {
                return res.status(400).json({ message: 'Periode fixed yang dipilih tidak valid untuk customer ini.' });
            }

            targetBillingPeriodStr = dateToYMD(selectedCycleStart, tz);
        } else if (targetBillingPeriodStart) {
            targetBillingPeriodStr = targetBillingPeriodStart;
        } else {
            // Check latest invoice to see next cycle
            const [customerInvoices] = await pool.query(
                'SELECT billingPeriodEnd FROM invoices WHERE customerId = ? ORDER BY billingPeriodEnd DESC LIMIT 1',
                [customerId]
            );

            if (customerInvoices.length === 0) {
                // NO PREVIOUS INVOICE
                const now = new Date();
                
                // POSTPAID: Default to 1st of PREVIOUS MONTH
                const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
                targetBillingPeriodStr = dateToYMD(prevMonthDate, tz);
            } else {
                // HAS PREVIOUS INVOICE
                const lastBillingEnd = new Date(customerInvoices[0].billingPeriodEnd);
                // Next period starts 1 day after last end
                const nextPeriodStart = new Date(Date.UTC(lastBillingEnd.getUTCFullYear(), lastBillingEnd.getUTCMonth(), lastBillingEnd.getUTCDate() + 1));
                targetBillingPeriodStr = dateToYMD(nextPeriodStart, tz);
            }
        }
        
        // 3. Call the universal calculation utility
        const details = calculateBillingDetails(customer, customerPackage, settings, targetBillingPeriodStr);
        
        res.json(details);

    } catch (error) {
        console.error("Error calculating invoice:", error);
        res.status(500).json({ message: 'Error calculating invoice details.' });
    }
});

router.post('/invoices', async (req, res) => {
    try {
        const { 
            customerId, 
            amount,
            issueDate,
            dueDate,
            billingPeriodStart,
            billingPeriodEnd,
            status, 
            notes,
        } = req.body;

        if (!customerId || !amount || !issueDate || !dueDate || !billingPeriodStart || !billingPeriodEnd) {
            return res.status(400).json({ message: 'Missing required invoice details. Please ensure all fields are calculated correctly.' });
        }

        const settings = await getSettings();
        const tz = settings.app.timezone || 'Asia/Jakarta';
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [customerId]);
        if (!customer) return res.status(404).json({ message: 'Customer not found.' });
        
        const [[customerPackage]] = await pool.query('SELECT * FROM packages WHERE id = ?', [customer.packageId]);
        if (!customerPackage) return res.status(404).json({ message: 'Customer package not found.' });

        let invoiceAmount = amount;
        let invoiceDueDate = dueDate;
        let invoiceBillingPeriodStart = billingPeriodStart;
        let invoiceBillingPeriodEnd = billingPeriodEnd;
        let invoiceNotes = notes || `Monthly invoice for ${customerPackage.name}`;

        if (isNonPositiveNumber(customerPackage.price)) {
            return res.status(400).json({ message: 'Invoice tidak bisa dibuat karena harga paket customer bernilai 0 atau tidak valid.' });
        }

        if (isFixedBillingType(customer.billing_type)) {
            const selectedCycleStart = getFixedCycleStart(customer, new Date(), tz, billingPeriodStart);
            if (!selectedCycleStart) {
                return res.status(400).json({ message: 'Periode fixed yang dipilih tidak valid untuk customer ini.' });
            }

            const targetBillingPeriodStr = dateToYMD(selectedCycleStart, tz);
            const fixedDetails = calculateBillingDetails(
                customer,
                customerPackage,
                settings,
                targetBillingPeriodStr
            );

            invoiceAmount = fixedDetails.amount;
            invoiceDueDate = fixedDetails.dueDate;
            invoiceBillingPeriodStart = fixedDetails.billingPeriodStart;
            invoiceBillingPeriodEnd = fixedDetails.billingPeriodEnd;
            invoiceNotes = notes || fixedDetails.notes || `Monthly invoice for ${customerPackage.name}`;
        }

        if (isNonPositiveNumber(invoiceAmount)) {
            return res.status(400).json({ message: 'Invoice tidak bisa dibuat karena total tagihan bernilai 0 atau tidak valid.' });
        }

        // Check for existing invoice for the same customer and period
        const [existingInvoices] = await pool.query(
            'SELECT id FROM invoices WHERE customerId = ? AND billingPeriodStart = ?',
            [customerId, invoiceBillingPeriodStart]
        );

        if (existingInvoices.length > 0) {
            return res.status(409).json({ message: `An invoice already exists for this customer for the billing period starting ${invoiceBillingPeriodStart}.` });
        }

        const newId = generateNewInvoiceId();
        const finalStatus = resolveInvoiceStatus(status, invoiceDueDate, tz);
        
        const invoiceToSave = {
            id: newId,
            customerId,
            amount: invoiceAmount,
            issueDate,
            dueDate: invoiceDueDate,
            billingPeriodStart: invoiceBillingPeriodStart,
            billingPeriodEnd: invoiceBillingPeriodEnd,
            status: finalStatus,
            notes: invoiceNotes,
        };
        
        await pool.query('INSERT INTO invoices SET ?', invoiceToSave);
        res.status(201).json(invoiceToSave);
    } catch (e) {
        console.error("Error creating invoice:", e);
        res.status(500).send('Error creating invoice');
    }
});

router.put('/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentMethod, paymentDate, ...invoiceData } = req.body;
        const settings = await getSettings();
        const timezone = settings.app.timezone || 'Asia/Jakarta';

        const [[originalInvoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
        if (!originalInvoice) {
            return res.status(404).json({ message: 'Invoice not found.' });
        }

        const customerId = String(invoiceData.customerId || originalInvoice.customerId || '').trim();
        if (!customerId) {
            return res.status(400).json({ message: 'Customer ID is required.' });
        }

        const hasManualPayment = Boolean(paymentMethod);
        const amountSource = invoiceData.amount ?? originalInvoice.amount;
        let amount = Number(amountSource);
        if (hasManualPayment && (!Number.isFinite(amount) || amount <= 0)) {
            amount = Number(originalInvoice.amount);
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'Invoice amount must be a positive number.' });
        }

        const issueDate = toDateOnlyString(invoiceData.issueDate, originalInvoice.issueDate, timezone);
        const dueDate = toDateOnlyString(invoiceData.dueDate, originalInvoice.dueDate, timezone);
        const billingPeriodStart = toDateOnlyString(invoiceData.billingPeriodStart, originalInvoice.billingPeriodStart, timezone);
        const billingPeriodEnd = toDateOnlyString(invoiceData.billingPeriodEnd, originalInvoice.billingPeriodEnd, timezone);

        if (!issueDate || !dueDate) {
            return res.status(400).json({ message: 'Issue date and due date are required.' });
        }

        const normalizedInvoiceData = {
            customerId,
            amount,
            issueDate,
            dueDate,
            billingPeriodStart,
            billingPeriodEnd,
            status: invoiceData.status || originalInvoice.status,
            notes: invoiceData.notes ?? originalInvoice.notes ?? null,
        };

        if (normalizedInvoiceData.status !== 'Paid') {
            normalizedInvoiceData.status = resolveInvoiceStatus(
                normalizedInvoiceData.status,
                normalizedInvoiceData.dueDate,
                timezone
            );
        }

        const [result] = await pool.query('UPDATE invoices SET ? WHERE id = ?', [normalizedInvoiceData, id]);
        if (result.affectedRows === 0) return res.status(404).send('Invoice not found during update');

        const wasPending = ['Unpaid', 'Overdue'].includes(originalInvoice.status);
        const statusChangedToPaid = wasPending && normalizedInvoiceData.status === 'Paid';

        if (statusChangedToPaid) {
            console.log(`[Billing] Invoice ${id} manually marked as Paid. Triggering post-payment actions.`);
            let paymentDateObj = parseLocalDateString(paymentDate);
            if (!paymentDateObj) {
                paymentDateObj = new Date();
            }
            const paymentDateForDb = toMySQLDatetime(paymentDateObj, timezone);

            if (paymentMethod) {
                const paymentRecord = {
                    id: `PAY-${Date.now()}`,
                    invoiceId: id,
                    customerId: originalInvoice.customerId,
                    date: paymentDateForDb,
                    amount: normalizedInvoiceData.amount || originalInvoice.amount,
                    method: paymentMethod,
                };
                await pool.query('INSERT INTO payments SET ?', paymentRecord);
                await recordCashMutation(pool, {
                    date: paymentDateForDb,
                    direction: 'in',
                    category: 'invoice_payment',
                    amount: paymentRecord.amount,
                    method: paymentMethod,
                    description: `Pembayaran invoice ${id}`,
                    reference_type: 'payment',
                    reference_id: paymentRecord.id,
                    customer_id: originalInvoice.customerId,
                    created_by: req.user?.id || null,
                    source: 'system',
                    timezone,
                });
            }

            const [[customerData]] = await pool.query('SELECT c.*, p.name as packageName FROM customers c LEFT JOIN packages p ON c.packageId = p.id WHERE c.id = ?', [originalInvoice.customerId]);
            if (customerData && typeof req.sendSseEvent === 'function') {
                req.sendSseEvent({
                    type: 'payment_success',
                    customerName: customerData.name,
                    amount: normalizedInvoiceData.amount || originalInvoice.amount,
                    invoiceId: id 
                });
            }

            try {
                await restoreCustomerProfile(originalInvoice.customerId, originalInvoice);
            } catch (restoreError) {
                console.error(`[Billing] Failed to auto-restore profile for customer ${originalInvoice.customerId} after manual payment. Error: ${restoreError.message}`);
            }

            if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp?.paymentSuccess && customerData && customerData.phone) {
                const billingPeriod = formatBillingPeriod(originalInvoice.billingPeriodStart, originalInvoice.billingPeriodEnd);
                const message = replacePlaceholders(settings.whatsapp.paymentSuccess, {
                    customerName: customerData.name,
                    customerId: customerData.id,
                    invoiceId: originalInvoice.id,
                    amount: formatRupiah(originalInvoice.amount),
                    packageName: customerData.packageName || 'N/A',
                    billingPeriod,
                    paymentMethod: paymentMethod || 'Manual' 
                });
                const waResult = await whatsappService.sendMessage(customerData.phone, message);

                await pool.query('INSERT INTO whatsapp_logs SET ?', {
                    recipient_number: customerData.phone,
                    customer_id: customerData.id,
                    message_body: message,
                    status: waResult.success ? 'sent' : 'failed',
                    type: 'Payment Success (Manual)',
                    error_message: waResult.error || null,
                });
            }

            if (customerData?.email) {
                try {
                    await sendInvoiceEmailNotification({
                        settings,
                        customer: customerData,
                        invoice: originalInvoice,
                        packageName: customerData.packageName || 'N/A',
                        type: 'paid',
                        paymentMethod: paymentMethod || 'Manual',
                    });
                } catch (emailError) {
                    console.error(`[Billing] Failed to send payment success email for invoice ${originalInvoice.id}:`, emailError.message);
                }
            }

        }

        const [[updatedInvoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
        res.json(updatedInvoice);

    } catch (e) {
        console.error("Error updating invoice:", e);
        res.status(500).send('Error updating invoice');
    }
});


router.delete('/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [payments] = await pool.query('SELECT id FROM payments WHERE invoiceId = ?', [id]);
        const paymentIds = payments.map(payment => payment.id);
        if (paymentIds.length > 0) {
            await pool.query("DELETE FROM cash_mutations WHERE reference_type = 'payment' AND reference_id IN (?)", [paymentIds]);
        }
        await pool.query('DELETE FROM payments WHERE invoiceId = ?', [id]);
        const [result] = await pool.query('DELETE FROM invoices WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).send('Invoice not found');
        
        res.status(204).send();
    } catch (e) {
        console.error("Error deleting invoice:", e);
        res.status(500).send('Error deleting invoice');
    }
});

// --- Smart Invoice Generation (Bulk) ---
router.post('/generate-monthly', async (req, res) => {
    console.log('[Billing] Starting bulk invoice generation...');
    try {
        const settings = await getSettings();
        const tz = settings.app.timezone || 'Asia/Jakarta';
        
        const [customersToBill] = await pool.query("SELECT * FROM customers WHERE status IN ('Active', 'Suspended') AND activeDate IS NOT NULL");
        const [packages] = await pool.query("SELECT * FROM packages");
        const packagesMap = packages.reduce((acc, pkg) => ({ ...acc, [pkg.id]: pkg }), {});
        
        let generatedInvoicesCount = 0;
        let skippedInvoicesCount = 0;
        
        const today = new Date();
        const todayYMD = dateToYMD(today, tz);

        for (const customer of customersToBill) {
            // --- HANDLE PENDING PACKAGE CHANGES FIRST ---
            // (Logika ganti paket tetap sama, dieksekusi sebelum billing)
            const [[pendingChange]] = await pool.query('SELECT * FROM package_changes WHERE customer_id = ? AND status = ?', [customer.id, 'pending']);
            
            let customerForBilling = { ...customer };
            let packageForBilling = packagesMap[customer.packageId];

            if (pendingChange) {
                const newPackageId = pendingChange.new_package_id;
                const [[newPackage]] = await pool.query('SELECT * FROM packages WHERE id = ?', [newPackageId]);

                if (newPackage && customer.pppoeUsername) {
                    await pool.query('UPDATE customers SET packageId = ? WHERE id = ?', [newPackageId, customer.id]);
                    await pool.query('UPDATE package_changes SET status = ?, processed_at = NOW() WHERE id = ?', ['processed', pendingChange.id]);

                    customerForBilling.packageId = newPackageId;
                    packageForBilling = newPackage;
                    
                    try {
                        const routerUsers = await mikrotikApi.fetchPppoeUsers();
                        const pppoeUser = routerUsers.find(u => u.name === customer.pppoeUsername);
                        if (pppoeUser && newPackage.pppoeProfile) {
                            await mikrotikApi.updatePppoeUser(pppoeUser.id, { profile: newPackage.pppoeProfile });
                            await mikrotikApi.reconnectPppoeUser(customer.pppoeUsername);
                        }
                        if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp.packageChanged && customer.phone) {
                            const message = replacePlaceholders(settings.whatsapp.packageChanged, { customerName: customer.name, newPackageName: newPackage.name });
                            await whatsappService.sendMessage(customer.phone, message);
                        }
                    } catch (mikrotikError) {
                        console.error(`[Billing] Failed to update MikroTik for package change:`, mikrotikError);
                    }
                }
            }

            if (!packageForBilling) continue;
            if (isNonPositiveNumber(packageForBilling.price)) {
                skippedInvoicesCount++;
                continue;
            }

            // --- BILLING LOGIC START ---
            let targetPeriodStartStr;
            let precomputedDetails = null;

            if (isFixedBillingType(customer.billing_type)) {
                const currentCycleStart = getCurrentFixedCycleStart(customer, today, tz);
                if (!currentCycleStart) {
                    skippedInvoicesCount++;
                    continue;
                }

                targetPeriodStartStr = dateToYMD(currentCycleStart, tz);
                const cycleDetails = calculateBillingDetails(customerForBilling, packageForBilling, settings, targetPeriodStartStr);
                precomputedDetails = cycleDetails;
                if (isNonPositiveNumber(cycleDetails.amount)) {
                    skippedInvoicesCount++;
                    continue;
                }
                const dueDateObj = parseLocalDateString(cycleDetails.dueDate);
                if (!dueDateObj) {
                    skippedInvoicesCount++;
                    continue;
                }

                const earliestGenerateDate = new Date(dueDateObj);
                earliestGenerateDate.setDate(earliestGenerateDate.getDate() - Number(settings.billing.fixedBillDueDays || 0));

                if (todayYMD < dateToYMD(earliestGenerateDate, tz)) {
                    skippedInvoicesCount++;
                    continue;
                }

            } else {
                // === LOGIKA POSTPAID (Default) ===
                // Target periodenya adalah BULAN LALU (full month)
                // Biasanya dijalankan setiap tanggal 1 (generationDay), tapi jika dijalankan manual
                // di tanggal lain, tetap targetkan bulan lalu jika belum ada.
                
                const firstDayOfPreviousMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
                targetPeriodStartStr = dateToYMD(firstDayOfPreviousMonth, tz);
            }

            // Cek Duplikat di DB
            const [existing] = await pool.query(
                'SELECT id FROM invoices WHERE customerId = ? AND billingPeriodStart = ?',
                [customer.id, targetPeriodStartStr]
            );

            if (existing.length === 0) {
                const details = precomputedDetails || calculateBillingDetails(customerForBilling, packageForBilling, settings, targetPeriodStartStr);
                if (isNonPositiveNumber(details.amount)) {
                    skippedInvoicesCount++;
                    continue;
                }
                
                const newInvoice = {
                    id: generateNewInvoiceId(),
                    customerId: customer.id,
                    ...details,
                    issueDate: todayYMD,
                    status: 'Unpaid',
                    notes: isFixedBillingType(customer.billing_type) ? 'Monthly subscription' : `Invoice for period ${formatDateDisplay(targetPeriodStartStr)}`
                };
                await pool.query('INSERT INTO invoices SET ?', newInvoice);
                generatedInvoicesCount++;
                
                // Send WA Notification
                if (settings.billing.whatsappNotificationsEnabled && settings.billing.sendInvoiceOnCreate && customer.phone) {
                    const paymentLink = `${settings.app.baseUrl.replace(/\/$/, "")}/#pay/${newInvoice.id}`;
                    const period = formatBillingPeriod(newInvoice.billingPeriodStart, newInvoice.billingPeriodEnd);
                    const msg = replacePlaceholders(settings.whatsapp.invoiceCreated, {
                        customerName: customer.name, customerId: customer.id, invoiceId: newInvoice.id,
                        amount: formatRupiah(newInvoice.amount), dueDate: formatDateDisplay(newInvoice.dueDate),
                        paymentLink, packageName: packageForBilling.name, billingPeriod: period
                    });
                    try {
                        const result = await whatsappService.sendMessage(customer.phone, msg);
                        await pool.query("INSERT INTO whatsapp_logs SET ?", {
                            recipient_number: customer.phone, customer_id: customer.id, message_body: msg,
                            status: result.success ? 'sent' : 'failed', type: 'Auto Invoice Created', created_at: toMySQLDatetime(new Date(), tz)
                        });
                    } catch(e) {}
                }

            } else {
                skippedInvoicesCount++;
            }
        }

        res.json({ 
            success: true, 
            message: `Generated ${generatedInvoicesCount} invoices. Skipped ${skippedInvoicesCount} (already exists or not due).` 
        });

    } catch (error) {
        console.error('[Billing] Error during bulk generation:', error);
        res.status(500).json({ message: error.message || 'An error occurred while generating invoices.' });
    }
});


// --- Tripay Payment Gateway Endpoints ---

// Endpoint for CLOSED PAYMENT (Public Page, Admin, Customer)
router.post('/invoices/:id/create-payment', async (req, res) => {
    try {
        const { id } = req.params;
        const { method } = req.body; // Hanya ambil method dari body

        // Dapatkan pengaturan untuk menemukan baseUrl yang benar
        const settings = await getSettings();
        const returnUrl = settings.app.baseUrl;

        if (!returnUrl) {
            throw new Error("Application Base URL is not configured in settings. Cannot create payment link.");
        }
        if (!method) return res.status(400).json({ message: 'A payment method (method) is required for this endpoint.' });
        
        const [invoices] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
        if (invoices.length === 0) return res.status(404).json({ message: 'Invoice not found.' });
        const invoice = invoices[0];
        
        if (invoice.status === 'Paid') return res.status(400).json({ message: 'Invoice has already been paid.' });

        const [customers] = await pool.query('SELECT * FROM customers WHERE id = ?', [invoice.customerId]);
        if (customers.length === 0) return res.status(404).json({ message: 'Customer not found.' });
        
        const tripayResponse = await tripayService.createTransaction(invoice, customers[0], returnUrl, method);

        await pool.query('UPDATE invoices SET tripayReference = ?, paymentUrl = ? WHERE id = ?', [tripayResponse.reference, tripayResponse.checkout_url, id]);
        
        console.log(`[Payment] Created CLOSED payment link for Invoice ${id} with method ${method}. URL: ${tripayResponse.checkout_url}`);
        
        // Kembalikan paymentUrl untuk WebView dan returnUrl untuk logika navigasi
        res.json({ paymentUrl: tripayResponse.checkout_url, returnUrl: returnUrl });
        
    } catch (error) {
        console.error(`[Payment Error] Failed to create closed payment link for invoice ${req.params.id}:`, error);
        res.status(500).json({ message: error.message || 'An internal server error occurred.' });
    }
});

router.post('/invoices/:id/send-whatsapp', async (req, res) => {
    const { id } = req.params;

    try {
        const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
        if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });

        const [[customer]] = await pool.query('SELECT c.*, p.name as packageName FROM customers c LEFT JOIN packages p ON c.packageId = p.id WHERE c.id = ?', [invoice.customerId]);
        if (!customer) return res.status(404).json({ message: 'Customer not found.' });
        if (!customer.phone) return res.status(400).json({ message: 'Customer does not have a registered phone number.' });
        
        const settings = await getSettings();
        if (!settings.billing.whatsappNotificationsEnabled) return res.status(400).json({ message: 'WhatsApp notifications are disabled in settings.' });
        if (whatsappService.getStatus().status !== 'connected') return res.status(400).json({ message: 'WhatsApp is not connected.' });
        const template = settings.whatsapp.invoiceCreated;
        if (!template) return res.status(400).json({ message: 'The "Invoice Created" WhatsApp template is empty in settings.' });
        if (!settings.app.baseUrl) return res.status(400).json({ message: 'Base URL is not configured in App Settings.' });

        // Generate the public payment link to our application
        const paymentLink = `${settings.app.baseUrl.replace(/\/$/, '')}/#pay/${invoice.id}`;
        
        const billingPeriod = formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd);
        const message = replacePlaceholders(template, {
            customerName: customer.name,
            customerId: customer.id,
            invoiceId: invoice.id,
            amount: formatRupiah(invoice.amount),
            paymentLink: paymentLink,
            dueDate: formatDateDisplay(invoice.dueDate),
            packageName: customer.packageName || 'N/A',
            billingPeriod,
        });

        const waResult = await whatsappService.sendMessage(customer.phone, message);

        await pool.query('INSERT INTO whatsapp_logs SET ?', {
            recipient_number: customer.phone,
            customer_id: customer.id,
            message_body: message,
            status: waResult.success ? 'sent' : 'failed',
            type: 'Manual Invoice Notification',
            error_message: waResult.error || null,
        });

        if (!waResult.success) throw new Error(waResult.error || 'Failed to send message via WhatsApp service.');

        res.json({ success: true, message: `Notification for invoice ${id} sent to ${customer.name}.` });

    } catch (error) {
        console.error(`[Send WA] Error sending notification for invoice ${id}:`, error);
        res.status(500).json({ message: error.message || 'An internal server error occurred.' });
    }
});

// --- Fallback endpoint for admin panel ---
router.get('/payment-channels', async (req, res) => {
    console.log(`[Billing Routes] GET /payment-channels endpoint HIT. Timestamp: ${new Date().toISOString()}`);
    try {
        console.log('[Billing Routes] Attempting to fetch channels from Tripay service...');
        const channels = await tripayService.getPaymentChannels();
        console.log(`[Billing Routes] Successfully fetched ${channels.length} channels from Tripay service.`);
        res.json(channels);
    } catch (error) {
        console.error('[Billing Routes] CRITICAL ERROR in /payment-channels endpoint:', error);
        res.status(500).json({ message: error.message || 'Failed to get payment channels.' });
    }
});


// --- Bulk Actions ---
router.post('/invoices/bulk-delete', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of invoice IDs is required.' });
    }
    try {
        const [payments] = await pool.query('SELECT id FROM payments WHERE invoiceId IN (?)', [ids]);
        const paymentIds = payments.map(payment => payment.id);
        if (paymentIds.length > 0) {
            await pool.query("DELETE FROM cash_mutations WHERE reference_type = 'payment' AND reference_id IN (?)", [paymentIds]);
        }
        await pool.query('DELETE FROM payments WHERE invoiceId IN (?)', [ids]);
        const [result] = await pool.query('DELETE FROM invoices WHERE id IN (?)', [ids]);
        res.json({ success: true, message: `${result.affectedRows} invoice(s) deleted.` });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete invoices.' });
    }
});

router.post('/invoices/bulk-mark-paid', async (req, res) => {
    const { ids, method } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !method) {
        return res.status(400).json({ message: 'An array of invoice IDs and a payment method are required.' });
    }
    try {
        const settings = await getSettings();
        const [invoicesToUpdate] = await pool.query('SELECT * FROM invoices WHERE id IN (?) AND status != ?', [ids, 'Paid']);
        if (invoicesToUpdate.length === 0) {
            return res.json({ success: true, message: 'No unpaid invoices were selected to update.' });
        }
        
        for (const invoice of invoicesToUpdate) {
            await pool.query('UPDATE invoices SET status = ? WHERE id = ?', ['Paid', invoice.id]);
            const paymentRecord = {
                id: `PAY-${Date.now()}-${invoice.id.slice(-4)}`,
                invoiceId: invoice.id,
                customerId: invoice.customerId,
                date: toMySQLDatetime(new Date(), settings.app.timezone),
                amount: invoice.amount,
                method,
            };
            await pool.query('INSERT INTO payments SET ?', paymentRecord);
            await recordCashMutation(pool, {
                date: paymentRecord.date,
                direction: 'in',
                category: 'invoice_payment',
                amount: paymentRecord.amount,
                method,
                description: `Pembayaran invoice ${invoice.id}`,
                reference_type: 'payment',
                reference_id: paymentRecord.id,
                customer_id: invoice.customerId,
                created_by: req.user?.id || null,
                source: 'system',
                timezone: settings.app.timezone,
            });
            await restoreCustomerProfile(invoice.customerId, invoice);

            try {
                const [[customerData]] = await pool.query(
                    'SELECT c.*, p.name as packageName FROM customers c LEFT JOIN packages p ON c.packageId = p.id WHERE c.id = ?',
                    [invoice.customerId]
                );
                if (customerData?.email) {
                    await sendInvoiceEmailNotification({
                        settings,
                        customer: customerData,
                        invoice,
                        packageName: customerData.packageName || 'N/A',
                        type: 'paid',
                        paymentMethod: method,
                    });
                }
            } catch (emailError) {
                console.error(`[Billing] Failed to send bulk payment email for invoice ${invoice.id}:`, emailError.message);
            }
        }
        
        res.json({ success: true, message: `Successfully marked ${invoicesToUpdate.length} invoice(s) as paid.` });
    } catch (error) {
        console.error("Bulk Mark Paid Error:", error);
        res.status(500).json({ message: 'Failed to mark invoices as paid.' });
    }
});

router.post('/invoices/bulk-send-whatsapp', async (req, res) => {
    const { ids, message } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of invoice IDs is required.' });
    }
    try {
        const settings = await getSettings();
        if (!settings.billing.whatsappNotificationsEnabled || !settings.whatsapp.invoiceCreated) {
            return res.status(400).json({ message: 'WhatsApp invoice creation notifications are disabled or the template is not set.' });
        }

        const [invoices] = await pool.query(`
            SELECT i.*, c.name, c.phone, p.name as packageName 
            FROM invoices i 
            JOIN customers c ON i.customerId = c.id
            LEFT JOIN packages p ON c.packageId = p.id
            WHERE i.id IN (?)
        `, [ids]);
        
        let sentCount = 0;
        for (const invoice of invoices) {
            if (invoice.phone) {
                const paymentLink = `${settings.app.baseUrl.replace(/\/$/, '')}/#pay/${invoice.id}`;
                const billingPeriod = formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd);
                const message = replacePlaceholders(settings.whatsapp.invoiceCreated, {
                    customerName: invoice.name,
                    customerId: invoice.customerId,
                    invoiceId: invoice.id,
                    amount: formatRupiah(invoice.amount),
                    paymentLink: paymentLink,
                    dueDate: formatDateDisplay(invoice.dueDate),
                    packageName: invoice.packageName || 'N/A',
                    billingPeriod,
                });
                const waResult = await whatsappService.sendMessage(invoice.phone, message);
                await pool.query('INSERT INTO whatsapp_logs SET ?', {
                    recipient_number: invoice.phone,
                    customer_id: invoice.customerId,
                    message_body: message,
                    status: waResult.success ? 'sent' : 'failed',
                    type: 'Bulk Invoice Notification',
                    error_message: waResult.error || null,
                });
                if (waResult.success) sentCount++;
                await new Promise(resolve => setTimeout(resolve, 1000)); // Delay between messages
            }
        }
        res.json({ success: true, message: `Sent invoice notifications for ${sentCount} of ${invoices.length} selected invoices.` });
    } catch (error) {
        console.error("Bulk Send WA Error:", error);
        res.status(500).json({ message: 'An error occurred while sending notifications.' });
    }
});

// Endpoint baru untuk mengambil permintaan top-up untuk admin
router.get('/topup-requests', async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'reseller') {
            return res.status(403).json({ message: 'Forbidden' });
        }
        // Fetch all requests
        const [rows] = await pool.query(`
            SELECT 
                tr.*, 
                c.name as customer_name, 
                u.username as reseller_name
            FROM topup_requests tr
            LEFT JOIN customers c ON tr.customer_id = c.id
            LEFT JOIN users u ON tr.user_id = u.id
            ORDER BY tr.created_at DESC
        `);

        const formattedRows = rows.map(r => ({
            ...r,
            created_at: dbDateToISO(r.created_at),
            paid_at: dbDateToISO(r.paid_at),
            requester_name: r.customer_name || r.reseller_name || 'Unknown',
        }));
        res.json(formattedRows);
    } catch (e) {
        console.error("Error fetching topup requests:", e);
        res.status(500).json({ message: 'Error fetching topup requests data' });
    }
});


export default router;
