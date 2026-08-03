




// cronJobs.js (FULL TIMEZONE-AWARE VERSION)

import pool from './db.js';
import {
    getSettings,
    dateToYMD,
    replacePlaceholders,
    formatRupiah,
    formatBillingPeriod,
    formatDateDisplay,
    calculateBillingDetails,
    generateNewInvoiceId,
    toMySQLDatetime,
    addMonthsKeepDay,
    getCurrentFixedCycleStart,
    parseLocalDateString,
    randomDelay
} from './utils.js';

import { suspendCustomer, restoreCustomerProfile } from './services.js';
import whatsappService from './whatsappService.js';
import mikrotikApi from './mikrotik-api.js';
import { handleWhatsappMessage } from './routes/chatbotRoutes.js';
import { recordCashMutation } from './cashMutationService.js';
import { sendInvoiceEmailNotification } from './emailService.js';

/* ==========================================================
   UTILITAS TIMEZONE
========================================================== */

// Fungsi untuk mendapatkan objek Date yang merepresentasikan waktu lokal bisnis
function getBusinessDate(timezone) {
    const now = new Date();
    const localString = now.toLocaleString('en-US', { timeZone: timezone });
    return new Date(localString);
}

function normalizeBillingTypeForSuspension(value) {
    return String(value || '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'postpaid';
}

function isNonPositiveNumber(value) {
    const numericValue = Number(value);
    return !Number.isFinite(numericValue) || numericValue <= 0;
}

/* ==========================================================
   FLAG LOCK MENCEGAH OVERLAPPING JOB
========================================================== */

let billingLock = false;

/* ==========================================================
   CRON BILLING UTAMA (DAILY)
========================================================== */

export const runBillingMaintenance = async () => {
    if (billingLock) {
        console.log(`[Cron] Billing masih berjalan, skip cycle ini.`);
        return;
    }
    billingLock = true;

    try {
        const settings = await getSettings();
        const tz = settings.app.timezone || 'Asia/Jakarta'; // Default fallback
        
        const businessNow = getBusinessDate(tz); 
        const todayYMD = dateToYMD(new Date(), tz);

        console.log(`[Cron] ↪ Billing cron berjalan. Waktu Bisnis (${tz}): ${todayYMD}`);

        const generationDay = settings.billing.generationDay || 1;
        const currentDay = businessNow.getDate(); // Ambil tanggal (1-31)

        /* ======================================================
           BAGIAN 1 — GENERATE INVOICE (DAILY CHECK)
        ====================================================== */
        
        let generatedCount = 0;
        const generatedInvoiceNotifications = [];
        const [packages] = await pool.query("SELECT * FROM packages");
        const packageMap = Object.fromEntries(packages.map(p => [p.id, p]));

        // --- 1.A: POSTPAID GENERATION (Only on Generation Day, e.g., 1st) ---
        if (currentDay === generationDay) {
             const [flag] = await pool.query(
                `SELECT flag FROM system_flags WHERE flag = 'postpaid_gen' AND date_value = ?`,
                [todayYMD]
            );

            if (flag.length === 0) {
                console.log(`[Cron] Checking Postpaid Generation for ${todayYMD}...`);
                
                const [postpaidCustomers] = await pool.query(
                    "SELECT * FROM customers WHERE status IN ('Active','Suspended') AND (billing_type = 'postpaid' OR billing_type IS NULL) AND activeDate IS NOT NULL"
                );

                // Target Billing Month for Postpaid is PREVIOUS month
                const targetYear = businessNow.getFullYear();
                const targetMonth = businessNow.getMonth(); // 0-11 (Current)
                const billingDate = new Date(targetYear, targetMonth - 1, 1); // Month-1
                const billYear = billingDate.getFullYear();
                const billMonth = billingDate.getMonth() + 1; // 1-based
                const monthStr = `${billYear}-${String(billMonth).padStart(2, '0')}`;
                const periodStr = `${monthStr}-01`;

                for (const c of postpaidCustomers) {
                    const [exist] = await pool.query(`
                        SELECT id FROM invoices
                        WHERE customerId = ? AND billingPeriodStart = ?
                    `, [c.id, periodStr]);

                    if (exist.length > 0) continue;

                    const pkg = packageMap[c.packageId];
                    if (!pkg) continue;
                    if (isNonPositiveNumber(pkg.price)) continue;
                    
                    // Skip if activeDate is after the billing period end
                    const activeDate = new Date(c.activeDate);
                    // Last day of billing month
                    const endOfBillMonth = new Date(Date.UTC(billYear, billMonth, 0));
                    if (activeDate > endOfBillMonth) continue;

                    const details = calculateBillingDetails(c, pkg, settings, periodStr);
                    if (isNonPositiveNumber(details.amount)) continue;

                    const newInv = {
                        id: generateNewInvoiceId(),
                        customerId: c.id,
                        ...details,
                        issueDate: todayYMD,
                        status: 'Unpaid',
                        notes: `Postpaid Invoice ${monthStr}`
                    };

                    await pool.query("INSERT INTO invoices SET ?", newInv);
                    generatedCount++;
                    queueInvoiceNotification(generatedInvoiceNotifications, c, newInv, pkg.name, settings);
                }

                // Set Flag
                await pool.query("INSERT INTO system_flags SET ?", { flag: 'postpaid_gen', date_value: todayYMD });
            }
        }

        const fixedLeadDays = settings.billing.fixedBillDueDays ?? 10;
        console.log(`[Cron] Checking Fixed Billing lead=${fixedLeadDays} for ${todayYMD}...`);
        
        const [fixedCustomers] = await pool.query(`
            SELECT *
            FROM customers
            WHERE status IN ('Active','Suspended')
              AND activeDate IS NOT NULL
              AND LOWER(TRIM(COALESCE(billing_type, ''))) = 'fixed'
        `);
        
        for (const c of fixedCustomers) {
            const billingType = String(c.billing_type || '').trim().toLowerCase();
            if (billingType !== 'fixed') continue;

            const pkg = packageMap[c.packageId];
            if (!pkg) continue;
            if (isNonPositiveNumber(pkg.price)) continue;

            const activeDateObj = parseLocalDateString(c.activeDate);
            if (!activeDateObj) continue;

            const currentStart = getCurrentFixedCycleStart(c, businessNow, tz) || activeDateObj;
            if (!currentStart) continue;

            const periodStartStr = dateToYMD(currentStart, tz);
            const details = calculateBillingDetails(c, pkg, settings, periodStartStr);
            if (isNonPositiveNumber(details.amount)) {
                continue;
            }
            const dueDateObj = parseLocalDateString(details.dueDate);
            if (!dueDateObj) {
                continue;
            }

            const leadDate = new Date(dueDateObj);
            leadDate.setDate(leadDate.getDate() - fixedLeadDays);

            if (leadDate > businessNow) {
                continue;
            }

            const [exist] = await pool.query(`
                SELECT id FROM invoices
                WHERE customerId = ? AND billingPeriodStart = ?
            `, [c.id, periodStartStr]);

            if (exist.length > 0) {
                continue;
            }

            const newInv = {
                id: generateNewInvoiceId(),
                customerId: c.id,
                ...details,
                issueDate: todayYMD,
                status: 'Unpaid',
                notes: `Monthly subscription`
            };

            await pool.query("INSERT INTO invoices SET ?", newInv);
            generatedCount++;
            queueInvoiceNotification(generatedInvoiceNotifications, c, newInv, pkg.name, settings);
        }

        await flushGeneratedInvoiceNotifications(generatedInvoiceNotifications, settings, tz);
        console.log(`[Cron] Total invoices generated today: ${generatedCount}`);
        
        // Clean flags
        await pool.query(`DELETE FROM system_flags WHERE date_value < (CURDATE() - INTERVAL 60 DAY)`);


        /* ======================================================
           BAGIAN 2 — REMINDER (Tetap sama)
        ====================================================== */

        const [reminderFlag] = await pool.query(
            "SELECT flag FROM system_flags WHERE flag = 'daily_reminders' AND date_value = ?",
            [todayYMD]
        );

        if (reminderFlag.length === 0) {

            console.log(`[Cron] ✔ Menjalankan pemeriksaan pengingat untuk ${todayYMD}.`);

            const [unpaid] = await pool.query(`
                SELECT i.*, c.name AS customerName, c.phone AS customerPhone, c.email AS customerEmail, p.name AS packageName
                FROM invoices i
                JOIN customers c ON c.id = i.customerId
                LEFT JOIN packages p ON p.id = c.packageId
                WHERE i.status IN ('Unpaid','Overdue')
            `);

            for (const inv of unpaid) {
                const dueDateObj = new Date(inv.dueDate);
                const reminderLead = settings.billing.reminderDaysBeforeDue;
                const offsets = new Set();
                if (typeof reminderLead === 'number' && reminderLead > 0) {
                    offsets.add(reminderLead);
                }
                offsets.add(0); // Always try to remind on the due date itself

                for (const offset of offsets) {
                    if (offset < 0) continue;

                    const reminderDate = new Date(dueDateObj);
                    reminderDate.setDate(reminderDate.getDate() - offset);
                    const reminderDateStr = dateToYMD(reminderDate, tz);

                    if (reminderDateStr !== todayYMD) continue;

                    const [dupe] = await pool.query(`
                        SELECT id FROM whatsapp_logs
                        WHERE type='Invoice Reminder'
                        AND message_body LIKE ?
                        AND DATE(created_at) >= CURDATE() 
                    `, [`%${inv.id}%`]);

                    if (dupe.length === 0 && inv.customerPhone) {
                        const period = formatBillingPeriod(inv.billingPeriodStart, inv.billingPeriodEnd);
                        const link = `${settings.app.baseUrl.replace(/\/$/, "")}/#pay/${inv.id}`;

                        const msg = replacePlaceholders(settings.whatsapp.invoiceReminder, {
                            customerName: inv.customerName,
                            invoiceId: inv.id,
                            amount: formatRupiah(inv.amount),
                            paymentLink: link,
                            dueDate: formatDateDisplay(inv.dueDate),
                            billingPeriod: period,
                            packageName: inv.packageName
                        });

                        try {
                            const result = await whatsappService.sendMessage(inv.customerPhone, msg);
                            await pool.query("INSERT INTO whatsapp_logs SET ?", {
                                recipient_number: inv.customerPhone,
                                customer_id: inv.customerId,
                                message_body: msg,
                                status: result.success ? 'sent' : 'failed',
                                type: 'Invoice Reminder',
                                created_at: toMySQLDatetime(new Date(), tz)
                            });
                            await randomDelay(2000, 5000); // 2-5 second delay
                        } catch (e) { }
                    }

                    if (inv.customerEmail) {
                        try {
                            await sendInvoiceEmailNotification({
                                settings,
                                customer: {
                                    id: inv.customerId,
                                    name: inv.customerName,
                                    email: inv.customerEmail,
                                },
                                invoice: inv,
                                packageName: inv.packageName || 'N/A',
                                type: 'due',
                            });
                        } catch (emailError) {
                            console.error(`[Cron] Failed to send due reminder email for invoice ${inv.id}:`, emailError.message);
                        }
                    }

                    break; // Only one reminder per invoice per day
                }
            }

            /* INSERT FLAG + AUTO-EXPIRE */
            await pool.query(
                "INSERT INTO system_flags SET ?",
                { flag: 'daily_reminders', date_value: todayYMD }
            );
        } 


        /* ======================================================
           BAGIAN 3 — AUTO-OVERDUE (Tetap sama)
        ====================================================== */

        // Query ini aman dijalankan berulang karena hanya mengubah invoice Unpaid yang sudah lewat due date.
        await pool.query(`
            UPDATE invoices
            SET status='Overdue'
            WHERE status='Unpaid' AND dueDate < ?
        `, [todayYMD]);


        /* ======================================================
           BAGIAN 4 — SUSPENSION (Tetap sama)
        ====================================================== */

    const [suspensionFlag] = await pool.query(
        "SELECT flag FROM system_flags WHERE flag='daily_suspension_check' AND date_value=?",
        [todayYMD]
    );

        const currentMonthKey = todayYMD.slice(0, 7);

        const [rawTargets] = await pool.query(`
            SELECT i.*, c.name AS customerName, c.phone AS customerPhone, c.billing_type, c.status AS customerStatus, p.name AS packageName
            FROM invoices i
            JOIN customers c ON c.id = i.customerId
            LEFT JOIN packages p ON p.id = c.packageId
            WHERE i.status = 'Overdue'
        `);
        const latestOverdueByCustomer = new Map();

        for (const inv of rawTargets) {
            const dueDateObj = parseLocalDateString(inv.dueDate);
            if (!dueDateObj) continue;
            if (dateToYMD(dueDateObj, tz).slice(0, 7) !== currentMonthKey) continue;

            const existingOverdue = latestOverdueByCustomer.get(inv.customerId);
            if (!existingOverdue) {
                latestOverdueByCustomer.set(inv.customerId, inv);
                continue;
            }

            const existingOverdueDueDate = parseLocalDateString(existingOverdue.dueDate);
            if (!existingOverdueDueDate || dueDateObj > existingOverdueDueDate) {
                latestOverdueByCustomer.set(inv.customerId, inv);
            }
        }

        const targets = Array.from(latestOverdueByCustomer.values());

        const hasEligibleActiveSuspensions = targets.some((inv) => {
            const dueDateObj = parseLocalDateString(inv.dueDate);
            if (!dueDateObj) return false;

            const suspendDays = settings.billing.suspensionDays || 0;
            const suspendDate = new Date(dueDateObj);
            suspendDate.setDate(suspendDate.getDate() + suspendDays);
            const suspendDateStr = dateToYMD(suspendDate, tz);

            return todayYMD >= suspendDateStr
                && String(inv.customerStatus || '').trim() === 'Active'
                && inv.status === 'Overdue';
        });

        const shouldRunSuspensionCheck = suspensionFlag.length === 0 || hasEligibleActiveSuspensions;

        if (shouldRunSuspensionCheck) {
            let hadSuspensionProcessingErrors = false;

            for (const inv of targets) {
                try {
                    const dueDateObj = parseLocalDateString(inv.dueDate);
                    if (!dueDateObj) {
                        continue;
                    }

                    const suspendDays = settings.billing.suspensionDays || 0;
                    // Tanggal suspend = due date + suspend days
                    const suspendDate = new Date(dueDateObj);
                    suspendDate.setDate(suspendDate.getDate() + suspendDays);
                    const suspendDateStr = dateToYMD(suspendDate, tz);

                    // Tanggal warning = 1 hari sebelum suspend
                    const warnDate = new Date(suspendDate);
                    warnDate.setDate(warnDate.getDate() - 1);
                    const warnDateStr = dateToYMD(warnDate, tz);

                    /* WARNING */
                    if (warnDateStr === todayYMD &&
                        settings.whatsapp.suspensionWarning &&
                        inv.customerPhone) {

                        const period = formatBillingPeriod(inv.billingPeriodStart, inv.billingPeriodEnd);

                        const msg = replacePlaceholders(settings.whatsapp.suspensionWarning, {
                            customerName: inv.customerName,
                            invoiceId: inv.id,
                            amount: formatRupiah(inv.amount),
                            dueDate: formatDateDisplay(inv.dueDate),
                            billingPeriod: period,
                            packageName: inv.packageName
                        });

                        const result = await whatsappService.sendMessage(inv.customerPhone, msg);
                        await pool.query("INSERT INTO whatsapp_logs SET ?", {
                            recipient_number: inv.customerPhone,
                            customer_id: inv.customerId,
                            message_body: msg,
                            status: result.success ? 'sent' : 'failed',
                            type: 'Suspension Warning',
                            created_at: toMySQLDatetime(new Date(), tz)
                        });
                        await randomDelay(2000, 5000); // 2-5 second delay
                    }

                    /* SUSPEND */
                    // Jika hari ini sudah lewat atau sama dengan tanggal suspend
                    if (todayYMD >= suspendDateStr) {

                        const [[statusCheck]] = await pool.query(
                            "SELECT status FROM invoices WHERE id=?",
                            [inv.id]
                        );

                        if (statusCheck && statusCheck.status === 'Overdue') {
                            await suspendCustomer(inv.customerId, inv);
                        }
                    }
                } catch (customerError) {
                    hadSuspensionProcessingErrors = true;
                }
            }

            if (!hadSuspensionProcessingErrors) {
                if (suspensionFlag.length === 0) {
                    await pool.query(
                        "INSERT INTO system_flags SET ?",
                        { flag: 'daily_suspension_check', date_value: todayYMD }
                    );
                }
            }
        } 

        await reconcileTripayPayments(tz, businessNow);

    } catch (err) {
        console.error("[Cron] ERROR:", err);

    } finally {
        billingLock = false;
    }
};

function getBroadcastDelayProfile(settings) {
    const delayMode = String(settings?.whatsapp?.broadcastDelayMode || 'step');
    const delayStartMs = Math.max(0, Number(settings?.whatsapp?.broadcastDelayStartMs ?? 1000));
    const delayIncrementMs = Math.max(0, Number(settings?.whatsapp?.broadcastDelayIncrementMs ?? 750));
    const delayMaxMs = Math.max(delayStartMs, Number(settings?.whatsapp?.broadcastDelayMaxMs ?? 7000));
    const delayStepEvery = Math.max(1, Number(settings?.whatsapp?.broadcastDelayStepEvery ?? 5));
    const delayRandomJitterMs = Math.max(0, Number(settings?.whatsapp?.broadcastDelayRandomJitterMs ?? 1500));

    return {
        mode: ['flat', 'linear', 'step', 'randomized'].includes(delayMode) ? delayMode : 'step',
        startMs: delayStartMs,
        incrementMs: delayIncrementMs,
        maxMs: delayMaxMs,
        stepEvery: delayStepEvery,
        randomJitterMs: delayRandomJitterMs,
    };
}

function computeBroadcastDelay(index, profile) {
    if (profile.mode === 'flat') {
        return profile.startMs;
    }
    if (profile.mode === 'linear') {
        return Math.min(
            profile.startMs + (Math.max(0, index) * profile.incrementMs),
            profile.maxMs,
        );
    }
    if (profile.mode === 'randomized') {
        const randomOffset = Math.floor(Math.random() * (profile.randomJitterMs + 1));
        return Math.min(profile.startMs + randomOffset, profile.maxMs);
    }

    const stepIndex = Math.floor(Math.max(0, index) / profile.stepEvery);
    return Math.min(
        profile.startMs + (stepIndex * profile.incrementMs),
        profile.maxMs,
    );
}

function queueInvoiceNotification(queue, customer, invoice, packageName, settings) {
    if (!settings.billing.whatsappNotificationsEnabled ||
        !settings.billing.sendInvoiceOnCreate ||
        !customer.phone) {
        return;
    }

    const paymentLink = `${settings.app.baseUrl.replace(/\/$/, "")}/#pay/${invoice.id}`;
    const period = formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd);
    const msg = replacePlaceholders(settings.whatsapp.invoiceCreated, {
        customerName: customer.name,
        customerId: customer.id,
        invoiceId: invoice.id,
        amount: formatRupiah(invoice.amount),
        dueDate: formatDateDisplay(invoice.dueDate),
        paymentLink,
        packageName,
        billingPeriod: period,
    });

    queue.push({
        customerId: customer.id,
        phone: customer.phone,
        message: msg,
    });
}

async function flushGeneratedInvoiceNotifications(queue, settings, tz) {
    if (!Array.isArray(queue) || queue.length === 0) {
        return;
    }

    const delayProfile = getBroadcastDelayProfile(settings);

    for (let index = 0; index < queue.length; index++) {
        const item = queue[index];
        try {
            const result = await whatsappService.sendMessage(item.phone, item.message);
            await pool.query("INSERT INTO whatsapp_logs SET ?", {
                recipient_number: item.phone,
                customer_id: item.customerId,
                message_body: item.message,
                status: result.success ? 'sent' : 'failed',
                type: 'Auto Invoice Created',
                error_message: result.error || null,
                created_at: toMySQLDatetime(new Date(), tz)
            });
        } catch (e) {
            console.error("Failed to send invoice notification:", e);
        }

        if (index < queue.length - 1) {
            const waitMs = computeBroadcastDelay(index, delayProfile);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
}


async function reconcileTripayPayments(tz, businessNow) {
    try {
        const [missingPayments] = await pool.query(`
            SELECT i.id, i.customerId, i.amount
            FROM invoices i
            LEFT JOIN payments p ON p.invoiceId = i.id
            WHERE i.status = 'Paid' AND i.tripayReference IS NOT NULL AND p.id IS NULL
        `);

        if (missingPayments.length === 0) {
            return;
        }

        const paymentTimestamp = toMySQLDatetime(businessNow, tz);
        const nowMs = Date.now();
        let insertedCount = 0;

        for (const invoice of missingPayments) {
            const paymentId = `PAY-CRON-${nowMs}-${invoice.id.slice(-4)}-${insertedCount}`;
            const paymentRecord = {
                id: paymentId,
                invoiceId: invoice.id,
                customerId: invoice.customerId,
                date: paymentTimestamp,
                amount: invoice.amount,
                method: 'Tripay Gateway (Auto)'
            };
            await pool.query('INSERT INTO payments SET ?', paymentRecord);
            await recordCashMutation(pool, {
                date: paymentTimestamp,
                direction: 'in',
                category: 'invoice_payment',
                amount: invoice.amount,
                method: paymentRecord.method,
                description: `Pembayaran invoice ${invoice.id} direkonsiliasi otomatis`,
                reference_type: 'payment',
                reference_id: paymentId,
                customer_id: invoice.customerId,
                source: 'system',
                timezone: tz,
            });
            insertedCount++;
        }

        console.log(`[Cron] Auto-logged ${insertedCount} Tripay payment(s) missing from transaction history.`);
    } catch (error) {
        console.error("[Cron] Failed to reconcile Tripay payments:", error);
    }
}


/* ==========================================================
   HOTSPOT JOB (ROBUST & SECURE)
========================================================== */

export const runHotspotMaintenance = async () => {
    // ... (Hotspot logic remains same as before)
    // Copied from previous file for completeness
    try {
        const settings = await getSettings();
        const tz = settings.app.timezone || 'Asia/Jakarta';
        const currentDbTime = toMySQLDatetime(new Date(), tz);

        const [expiredVouchers] = await pool.query(`
            SELECT * FROM hotspot_vouchers 
            WHERE status='active' AND expires_at IS NOT NULL
              AND expires_at <= ?
        `, [currentDbTime]);

        if (expiredVouchers.length > 0) {
            console.log(`[Hotspot Cron] Ditemukan ${expiredVouchers.length} voucher kadaluarsa.`);
            const activeSessions = await mikrotikApi.fetchActiveHotspotConnections();
            const routerUsers = await mikrotikApi.fetchHotspotUsers();

            for (const v of expiredVouchers) {
                const routerUser = routerUsers.find(u => u.name === v.username);
                if (routerUser) {
                    try {
                        await mikrotikApi.disableHotspotUser(routerUser.id);
                    } catch (e) {}
                } else if (v.mikrotik_id) {
                    try {
                        await mikrotikApi.disableHotspotUser(v.mikrotik_id);
                    } catch (e) {}
                }

                const session = activeSessions.find(x => x.user === v.username);
                if (session) {
                    try {
                        await mikrotikApi.removeActiveHotspotUser(session['.id']);
                    } catch (e) {}
                }

                await pool.query(`UPDATE hotspot_vouchers SET status='expired' WHERE id=?`, [v.id]);
            }
        }
    } catch (err) {
        console.error("[Hotspot Cron] ERROR:", err);
    }
};


/* ==========================================================
   START BACKGROUND SERVICES
========================================================== */

export const startBackgroundServices = () => {
    console.log("Initialize background jobs...");
    
    const initWhatsApp = async () => {
        try {
            const settings = await getSettings();
            const standbyEnabled = Boolean(settings?.whatsapp?.standbyEnabled);
            const autoConnectWhatsApp = String(process.env.AUTO_CONNECT_WHATSAPP || 'false').toLowerCase() === 'true';

            whatsappService.setMessageHandler(handleWhatsappMessage);

            if (process.env.DISABLE_WHATSAPP === 'true' || standbyEnabled) {
                console.warn("[Startup] WhatsApp standby aktif. Tidak melakukan koneksi.");
                await whatsappService.setStandby(true);
                return;
            }

            if (!autoConnectWhatsApp) {
                console.log("[Startup] WhatsApp auto-connect disabled. Waiting for manual Connect button.");
                return;
            }

            console.log("[Startup] Init WA after 15s...");
            setTimeout(() => {
                whatsappService.connectToWhatsApp(handleWhatsappMessage);
            }, 15000);
        } catch (error) {
            console.error("[Startup] Failed to load settings for WhatsApp init:", error);
        }
    };

    initWhatsApp();

    const startupMaintenanceDelayMs = Math.max(
        0,
        Number(process.env.STARTUP_MAINTENANCE_DELAY_MS || 60000)
    );

    const runStartupMaintenance = () => {
        runBillingMaintenance().catch(err => {
            console.error("[Startup] Initial billing maintenance failed:", err);
        });
        runHotspotMaintenance().catch(err => {
            console.error("[Startup] Initial hotspot maintenance failed:", err);
        });
    };

    if (startupMaintenanceDelayMs === 0) {
        runStartupMaintenance();
    } else {
        console.log(`[Startup] Deferring initial maintenance for ${startupMaintenanceDelayMs}ms.`);
        setTimeout(runStartupMaintenance, startupMaintenanceDelayMs);
    }

    // Changed interval to every 30 minutes for better responsiveness to daily changes
    setInterval(runBillingMaintenance, 30 * 60 * 1000); 
    setInterval(runHotspotMaintenance, 60 * 1000); 

    console.log("Background services running.");
};
