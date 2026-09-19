import './preload-env.js';
import { fileURLToPath } from 'url';
import path from 'path';

// Boilerplate for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Now import other modules
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import fs from 'fs';
// import { monitorEventLoopDelay } from 'perf_hooks';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool, { getDatabaseConfigSummary, testDatabaseConnection } from './db.js'; // Import the database pool
import { migrateDatabase } from './migrate.js';
import { getSettings, formatRupiah, formatBillingPeriod, replacePlaceholders, toMySQLDatetime, dateToYMD, parseLocalDateString } from './utils.js'; // Import getSettings
import tripayService from './tripayService.js';
import whatsappService from './whatsappService.js'; // Diperlukan untuk notifikasi
import { verifyWebhookSignature, InvalidSignatureError, SignatureExpiredError, MalformedPayloadError } from '@kirimdev/sdk/webhooks';

import { updateDigiflazzPingEvent } from './services/digiflazzWebhookState.js';
import { handleWhatsAppStatusWebhook } from './services/whatsappLogService.js';
import waExtensionRoutes from './wa-extension/providers.js';
import { mountHotspotWebhook } from './routes/hotspotWebhook.js';

console.log('[Server] Static imports resolved. Entering server module initialization...');

const loadProtectedRouteModules = (() => {
    let promise = null;
    return () => {
        if (!promise) {
            promise = Promise.all([
                import('./routes/adminRoutes.js'),
                import('./routes/billingRoutes.js'),
                import('./routes/customerRoutes.js'),
                import('./routes/networkRoutes.js'),
                import('./routes/pppoeRoutes.js'),
                import('./routes/hotspotRoutes.js'),
                import('./routes/acsRoutes.js'),
                import('./routes/chatbotRoutes.js'),
                import('./routes/technicianRoutes.js'),
                import('./routes/resellerRoutes.js'),
                import('./routes/ppobRoutes.js'),
                import('./routes/oltRoutes.js'),
                import('./routes/notificationRoutes.js'),
            ]).then(([
                adminModule,
                billingModule,
                customerModule,
                networkModule,
                pppoeModule,
                hotspotModule,
                acsModule,
                chatbotModule,
                technicianModule,
                resellerModule,
                ppobModule,
                oltModule,
                notificationModule,
            ]) => ({
                adminRoutes: adminModule.default,
                billingRoutes: billingModule.default,
                customerRoutes: customerModule.default,
                networkRoutes: networkModule.default,
                pppoeRoutes: pppoeModule.default,
                hotspotRoutes: hotspotModule.default,
                acsRoutes: acsModule.default,
                startAcsSyncJobScheduler: acsModule.startAcsSyncJobScheduler,
                chatbotRoutes: chatbotModule.default,
                handleWhatsappMessage: chatbotModule.handleWhatsappMessage,
                technicianRoutes: technicianModule.default,
                resellerRoutes: resellerModule.default,
                ppobRoutes: ppobModule.default,
                handleDigiflazzStatusUpdate: ppobModule.handleDigiflazzStatusUpdate,
                oltRoutes: oltModule.default,
                notificationRoutes: notificationModule.default,
                startPppoeSyncJobScheduler: pppoeModule.startPppoeSyncJobScheduler,
                startDatabaseRestoreJobScheduler: adminModule.startDatabaseRestoreJobScheduler,
            }));
        }

        return promise;
    };
})();

const loadCronJobs = (() => {
    let promise = null;
    return () => {
        if (!promise) {
            promise = import('./cronJobs.js');
        }
        return promise;
    };
})();

const loadPublicRoutes = (() => {
    let promise = null;
    return () => {
        if (!promise) {
            promise = import('./routes/publicRoutes.js');
        }
        return promise;
    };
})();

const loadCashMutationService = (() => {
    let promise = null;
    return () => {
        if (!promise) {
            promise = import('./cashMutationService.js');
        }
        return promise;
    };
})();

const loadBillingServices = (() => {
    let promise = null;
    return () => {
        if (!promise) {
            promise = import('./services.js');
        }
        return promise;
    };
})();

const loadEmailService = (() => {
    let promise = null;
    return () => {
        if (!promise) {
            promise = import('./emailService.js');
        }
        return promise;
    };
})();

const app = express();
app.set('trust proxy', 1); // Trust headers from proxies
const isProduction = process.env.NODE_ENV === 'production';
const isLightweightRuntime = process.env.CPANEL_LIGHTWEIGHT === 'true'
    || process.env.DISABLE_BACKGROUND_SERVICES === 'true'
    || process.env.DISABLE_WHATSAPP === 'true';
let httpServer = null;
let shutdownInProgress = false;
const healthEventLoopLagThresholdMs = Number(process.env.HEALTH_EVENT_LOOP_LAG_THRESHOLD_MS || 1000);
// const eventLoopDelayMonitor = monitorEventLoopDelay({ resolution: 20 });
// eventLoopDelayMonitor.enable();
let latestEventLoopLagMs = 0;
let latestEventLoopLagSampledAt = new Date().toISOString();

const updateEventLoopLagSample = () => {
    // Event loop monitoring disabled
};

const normalizeListenHost = (value) => {
    const host = String(value || '').trim();
    if (!host) {
        return '0.0.0.0';
    }

    if (host === '0.0.0.0' || host === '127.0.0.1' || host === '::' || host === 'localhost') {
        return host;
    }

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
        return host;
    }

    return '0.0.0.0';
};

// setInterval(updateEventLoopLagSample, 5000).unref();
// updateEventLoopLagSample();

const shutdownBackend = async (exitCode = 0, reason = 'shutdown') => {
    if (shutdownInProgress) {
        return;
    }

    shutdownInProgress = true;
    console.log(`[Shutdown] Backend is stopping (${reason})...`);

    try {
        if (httpServer) {
            await new Promise((resolve) => httpServer.close(resolve));
        }
    } catch (error) {
        console.error('[Shutdown] Failed to close HTTP server cleanly:', error);
    }

    try {
        await pool.end();
    } catch (error) {
        console.error('[Shutdown] Failed to close database pool cleanly:', error);
    }

    process.exit(exitCode);
};

const handleFatalError = async (label, error) => {
    console.error(`[Fatal] ${label}:`, error);
    await shutdownBackend(1, label);
};

process.on('uncaughtException', (error) => {
    handleFatalError('Uncaught exception', error).catch(() => {
        process.exit(1);
    });
});

process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    handleFatalError('Unhandled rejection', error).catch(() => {
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    shutdownBackend(0, 'SIGTERM').catch(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    shutdownBackend(0, 'SIGINT').catch(() => {
        process.exit(0);
    });
});

// --- SSE (Server-Sent Events) Setup ---
let clients = []; // Array to hold connected admin clients (res objects)

/**
 * Sends an event to all connected Server-Sent Events (SSE) clients.
 * @param {object} data - The data object to send. Should have a 'type' property.
 */
const sendSseEvent = (data) => {
  console.log('[SSE] Broadcasting event:', data);
  clients.forEach(client => client.res.write(`data: ${JSON.stringify(data)}\n\n`));
};

const firstObject = (...values) => values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || null;

const normalizeKirimdevPhone = (value) => {
    const base = String(value || '').split('@')[0];
    const digits = base.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('62')) return digits;
    if (digits.startsWith('0')) return `62${digits.slice(1)}`;
    if (digits.startsWith('8')) return `62${digits}`;
    return digits;
};

const isFonnteInboundMode = (settings = {}) => {
    const mode = String(settings?.whatsapp?.deliveryMode || '').toLowerCase();
    return mode === 'fonnte' || mode === 'wa';
};

const getKirimdevWebhookSecrets = () => [
    process.env.KIRIMDEV_WEBHOOK_SECRET,
    process.env.KIRIMDEV_WEBHOOK_SECRET_PREVIOUS,
    process.env.KIRIM_WEBHOOK_SECRET,
    process.env.KIRIM_WEBHOOK_SECRET_PREVIOUS,
].map((secret) => String(secret || '').trim()).filter(Boolean);

const extractKirimdevWebhookMessage = (payload = {}, headers = {}) => {
    const eventName = String(headers['x-kirim-event'] || payload?.type || '').toLowerCase();
    const sourceName = String(headers['x-kirim-source'] || '').toLowerCase();

    if (eventName !== 'message.received' && sourceName !== 'meta') {
        return null;
    }

    const value = payload?.entry?.[0]?.changes?.[0]?.value || null;
    const message = value?.messages?.[0] || null;
    if (!message) return null;

    const from = normalizeKirimdevPhone(
        message.from ||
        value?.contacts?.[0]?.wa_id ||
        value?.contacts?.[0]?.phone_number ||
        value?.contacts?.[0]?.phone ||
        value?.metadata?.display_phone_number ||
        ''
    );

    const textFromMessage = (
        message.text?.body ||
        message.extendedTextMessage?.text ||
        message.conversation ||
        message.caption ||
        message.body ||
        ''
    );

    const interactiveBody = (
        message.interactive?.button_reply?.title ||
        message.interactive?.button_reply?.id ||
        message.interactive?.list_reply?.title ||
        message.interactive?.list_reply?.id ||
        message.button?.payload ||
        message.button?.text ||
        ''
    );

    const body = String(
        textFromMessage ||
        interactiveBody ||
        message.image?.caption ||
        message.video?.caption ||
        message.document?.caption ||
        message.reaction?.emoji ||
        ''
    ).trim();

    if (!from || !body) {
        return null;
    }

    return {
        from,
        body,
        messageId: String(message.id || '').trim(),
        phoneNumberId: String(value?.metadata?.phone_number_id || '').trim(),
        source: sourceName || 'meta',
        event: eventName || 'message.received',
    };
};

const extractFonnteWebhookMessage = (payload = {}) => {
    const message = firstObject(payload?.data, payload?.body, payload) || payload || {};
    if (String(message.member || '').trim()) {
        return null;
    }

    const sender = normalizeKirimdevPhone(
        message.sender ||
        message.from ||
        message.phone ||
        message.number ||
        message.contact ||
        ''
    );

    const body = String(
        message.message ||
        message.text ||
        message.caption ||
        message.body ||
        ''
    ).trim();

    if (!sender || !body) {
        return null;
    }

    return {
        from: sender,
        body,
        messageId: String(message.id || message.messageId || message.requestid || '').trim(),
        device: String(message.device || message.number || '').trim(),
        source: 'fonnte',
        event: 'message.received',
        raw: message,
    };
};


// --- MIDDLEWARE BODY PARSING ---
// 1. Tangani rute callback Tripay secara spesifik. Middleware ini harus berjalan SEBELUM express.json().
app.use('/api/billing/tripay-callback', express.raw({ type: 'application/json' }));

// 1b. Tangani webhook Digiflazz (X-Hub-Signature) secara raw agar signature tetap valid.
app.use('/webhook', express.raw({ type: 'application/json' }));

// 2. Terapkan parser JSON global.
app.use(express.json({ limit: '5mb' }));

app.get(['/health', '/api/health'], async (req, res) => {
    // updateEventLoopLagSample(); // Disabled

    let dbHealthy = false;
    try {
        await pool.query('SELECT 1');
        dbHealthy = true;
    } catch (error) {
        console.error('[Health] Database check failed:', error);
    }

    const eventLoopHealthy = true; // Assume healthy since monitoring is disabled
    const status = dbHealthy && eventLoopHealthy ? 'ok' : 'degraded';
    const code = dbHealthy && eventLoopHealthy ? 200 : 503;

    res.status(code).json({
        status,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dbHealthy,
        eventLoopHealthy,
    });
});


// --- Server Startup ---
const startServer = async () => {
    console.log('[Startup] Initializing backend server...');
    console.log(`[Startup] Instance=${process.env.APP_INSTANCE_NAME || process.env.COMPOSE_PROJECT_NAME || 'default'}`);
    console.log(`[Startup] NODE_ENV=${process.env.NODE_ENV || '(unset)'}`);
    console.log(`[Startup] cwd=${process.cwd()}`);
    const rawAppHost = String(process.env.APP_HOST || '').trim();
    const listenHost = normalizeListenHost(rawAppHost);
    if (rawAppHost && listenHost !== rawAppHost) {
        console.warn(`[Startup] APP_HOST env "${rawAppHost}" is not a valid bind address. Falling back to ${listenHost}.`);
    }
    console.log(`[Startup] APP_HOST=${listenHost}`);
    console.log(`[Startup] Legacy HOST=${process.env.HOST || '(unset)'}`);
    const rawListenPort = String(
        process.env.PORT
        || process.env.PASSENGER_PORT
        || process.env.NODE_PORT
        || process.env.APP_PORT
        || process.env.SERVER_PORT
        || process.env.OPENSHIFT_NODEJS_PORT
        || ''
    ).trim();
    const listenPort = Number(rawListenPort || 3000);
    const resolvedPort = Number.isFinite(listenPort) && listenPort > 0 ? listenPort : 3000;
    console.log(`[Startup] PORT=${resolvedPort}`);
    const portSource = process.env.PORT ? 'PORT'
        : process.env.PASSENGER_PORT ? 'PASSENGER_PORT'
        : process.env.NODE_PORT ? 'NODE_PORT'
        : process.env.APP_PORT ? 'APP_PORT'
        : process.env.SERVER_PORT ? 'SERVER_PORT'
        : process.env.OPENSHIFT_NODEJS_PORT ? 'OPENSHIFT_NODEJS_PORT'
        : 'default(3000)';
    console.log(`[Startup] PORT source=${portSource}`);
    console.log(`[Startup] DB_HOST=${process.env.DB_HOST || '(unset)'}`);
    console.log(`[Startup] DB_PORT=${process.env.DB_PORT || 3306}`);
    console.log(`[Startup] DB_NAME=${process.env.DB_NAME || '(unset)'}`);
    console.log(`[Startup] DB_USER=${process.env.DB_USER || '(unset)'}`);
    console.log(`[Startup] CPANEL_LIGHTWEIGHT=${process.env.CPANEL_LIGHTWEIGHT || '(unset)'}`);
    console.log(`[Startup] DISABLE_BACKGROUND_SERVICES=${process.env.DISABLE_BACKGROUND_SERVICES || '(unset)'}`);
    console.log(`[Startup] DISABLE_WHATSAPP=${process.env.DISABLE_WHATSAPP || '(unset)'}`);
    console.log('[Startup] Database config summary from db.js:', getDatabaseConfigSummary());

    console.log('[Startup] Running database migration before listening...');
    await migrateDatabase();
    console.log('[Startup] Database migration completed.');

    app.locals.databaseReady = false;
    let databaseReady = false;
    const verifyDatabaseConnection = async () => {
        if (databaseReady) {
            return true;
        }

        try {
            await testDatabaseConnection();
            databaseReady = true;
            app.locals.databaseReady = true;
            console.log('[Startup] Database connection verified.');
            return true;
        } catch (error) {
            console.error('[Startup] Database connection check failed. Continuing in degraded mode so the app stays reachable.');
            console.error(error?.stack || error);
            console.warn('[Startup] Running without a verified DB connection. API requests that need the database will fail until the connection is restored.');
            return false;
        }
    };

    const UPLOAD_DIR = path.join(__dirname, 'uploads');
    if (!fs.existsSync(UPLOAD_DIR)) {
        console.log('[Startup] Creating uploads directory...');
        fs.mkdirSync(UPLOAD_DIR);
    }
    
    // --- JWT Authentication Middleware ---
    const authMiddleware = (req, res, next) => {
        // Public endpoints are mounted under /api/public and must stay accessible
        // without a JWT so login screens can load branding/settings first.
        if (req.path === '/public' || req.path.startsWith('/public/')) {
            return next();
        }

        let token = null;
        // Try getting token from header
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            token = authHeader.split(' ')[1]; // Bearer <token>
        }
        
        // If not in header, try query parameter (for EventSource)
        if (!token && req.query.token) {
            token = req.query.token;
        }

        if (token == null) {
            return res.status(401).json({ message: 'Unauthorized: No token provided.' });
        }

        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) {
                return res.status(403).json({ message: 'Forbidden: Invalid or expired token.' });
            }
            req.user = user;
            next();
        });
    };

    app.use(cors());
    // Dedicated opaque sessions cannot authenticate to the general billing API.
    app.use('/api/wa-extension', waExtensionRoutes);

    // --- PUBLIC TRIPAY CALLBACK HANDLER ---
    // Ditangani di sini sebelum middleware otentikasi diterapkan.
    app.post('/api/billing/tripay-callback', async (req, res) => {
        try {
            const callbackSignature = req.headers['x-callback-signature'];
            const settings = await getSettings();
    
            if (!tripayService.verifySignature(req.body, callbackSignature, settings.tripay.privateKey)) {
                console.warn('[Tripay Callback] Received request with INVALID signature.');
                return res.status(400).json({ success: false, message: 'Invalid signature' });
            }
    
            const callbackJson = JSON.parse(req.body.toString());
            console.log('[Tripay Callback] Received VALID callback:', callbackJson);
            
            if (callbackJson.status === 'PAID') {
                const merchantRef = callbackJson.merchant_ref;

                if (merchantRef.startsWith('TOPUP-')) {
                    // It's a Customer Affiliate Top-Up request
                    const connection = await pool.getConnection();
                    try {
                        await connection.beginTransaction();
    
                        const [[topup]] = await connection.query('SELECT * FROM topup_requests WHERE id = ? AND status = ? FOR UPDATE', [merchantRef, 'pending']);
                        
                        if (topup) {
                            await connection.query('UPDATE topup_requests SET status = ?, paid_at = NOW() WHERE id = ?', ['paid', merchantRef]);
                            
                            await connection.query('UPDATE customers SET voucher_balance = voucher_balance + ? WHERE id = ?', [topup.amount, topup.customer_id]);
                            
                            const [[customer]] = await connection.query('SELECT * FROM customers WHERE id = ?', [topup.customer_id]);
                            const newBalance = (Number(customer.voucher_balance) || 0) + Number(topup.amount);

                            // Tambahkan catatan ke tabel 'payments' untuk pelacakan pendapatan
                            const paymentRecord = {
                                id: `PAY-${merchantRef}`,
                                invoiceId: 'Affiliate Top Up (Tripay)',
                                customerId: topup.customer_id,
                                date: toMySQLDatetime(new Date(), settings.app.timezone),
                                amount: topup.amount,
                                method: 'Payment Gateway',
                                sold_by_user_id: null,
                            };
                            await connection.query('INSERT INTO payments SET ?', paymentRecord);
                            const { recordCashMutation } = await loadCashMutationService();
                            await recordCashMutation(connection, {
                                date: paymentRecord.date,
                                direction: 'in',
                                category: 'affiliate_topup',
                                amount: topup.amount,
                                method: paymentRecord.method,
                                description: `Top up saldo affiliate ${merchantRef}`,
                                reference_type: 'payment',
                                reference_id: paymentRecord.id,
                                customer_id: topup.customer_id,
                                source: 'system',
                                timezone: settings.app.timezone,
                            });
                            
                            await connection.commit();
                            console.log(`[Tripay Callback] Affiliate Top-Up ${merchantRef} for customer ${topup.customer_id} of ${formatRupiah(topup.amount)} processed successfully.`);
    
                            // Send notification (outside transaction)
                            if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp?.affiliateTopupSuccess && customer.phone) {
                                const message = replacePlaceholders(settings.whatsapp.affiliateTopupSuccess, {
                                    customerName: customer.name,
                                    amount: formatRupiah(topup.amount),
                                    newBalance: formatRupiah(newBalance)
                                });
                                await whatsappService.sendMessage(customer.phone, message);
                            }
                        } else {
                            console.warn(`[Tripay Callback] Received PAID callback for an already processed or non-existent Top-Up ID: ${merchantRef}`);
                            await connection.rollback();
                        }
                    } catch (dbError) {
                        await connection.rollback();
                        throw dbError; // Propagate to outer catch
                    } finally {
                        connection.release();
                    }
                } else if (merchantRef.startsWith('RTOPUP-')) {
                    // It's a Reseller Top-Up request
                    const connection = await pool.getConnection();
                    try {
                        await connection.beginTransaction();

                        const [[topup]] = await connection.query('SELECT * FROM topup_requests WHERE id = ? AND status = ? FOR UPDATE', [merchantRef, 'pending']);

                        if (topup) {
                            await connection.query('UPDATE topup_requests SET status = ?, paid_at = NOW() WHERE id = ?', ['paid', merchantRef]);
                            
                            // UPDATE THE 'users' TABLE FOR RESELLERS using user_id
                            await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [topup.amount, topup.user_id]); 
                            
                            const [[reseller]] = await connection.query('SELECT * FROM users WHERE id = ?', [topup.user_id]);
                            const newBalance = Number(reseller.balance);
                            
                            // Tambahkan catatan ke tabel 'payments' untuk pelacakan pendapatan
                            const paymentRecord = {
                                id: `PAY-${merchantRef}`,
                                invoiceId: 'Reseller Top Up (Tripay)',
                                customerId: null,
                                date: toMySQLDatetime(new Date(), settings.app.timezone),
                                amount: topup.amount,
                                method: 'Payment Gateway',
                                sold_by_user_id: topup.user_id,
                            };
                            await connection.query('INSERT INTO payments SET ?', paymentRecord);
                            const { recordCashMutation } = await loadCashMutationService();
                            await recordCashMutation(connection, {
                                date: paymentRecord.date,
                                direction: 'in',
                                category: 'reseller_topup',
                                amount: topup.amount,
                                method: paymentRecord.method,
                                description: `Top up saldo reseller ${merchantRef}`,
                                reference_type: 'payment',
                                reference_id: paymentRecord.id,
                                user_id: topup.user_id,
                                source: 'system',
                                timezone: settings.app.timezone,
                            });

                            await connection.commit();
                            console.log(`[Tripay Callback] Reseller Top-Up ${merchantRef} for reseller ${topup.user_id} of ${formatRupiah(topup.amount)} processed successfully.`);

                            // Send notification to reseller
                            if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp?.resellerBalanceAdded && reseller.phone) {
                                const message = replacePlaceholders(settings.whatsapp.resellerBalanceAdded, {
                                    amountAdded: formatRupiah(topup.amount),
                                    newBalance: formatRupiah(newBalance)
                                });
                                await whatsappService.sendMessage(reseller.phone, message);
                            }
                        } else {
                            console.warn(`[Tripay Callback] Received PAID callback for an already processed or non-existent Reseller Top-Up ID: ${merchantRef}`);
                            await connection.rollback();
                        }
                    } catch (dbError) {
                        await connection.rollback();
                        throw dbError;
                    } finally {
                        if (connection) connection.release();
                    }
                } else {
                    // It's an Invoice payment
                    const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [merchantRef]);
                    
                    if (invoice && invoice.status !== 'Paid') {
                        await pool.query('UPDATE invoices SET status = ? WHERE id = ?', ['Paid', merchantRef]);
                        console.log(`[Tripay Callback] Invoice ${merchantRef} marked as Paid.`);

                        const paymentMethod = 'Tripay Gateway';
                        const timezone = settings.app.timezone || 'Asia/Jakarta';
                        const paymentTimestamp = callbackJson.paid_at || callbackJson.completed_at || callbackJson.updated_at || callbackJson.success_at;
                        let paymentDateObj = parseLocalDateString(paymentTimestamp);
                        if (!paymentDateObj) {
                            paymentDateObj = new Date();
                        }
                        const paymentDateForDb = toMySQLDatetime(paymentDateObj, timezone);

                        const paymentRecord = {
                            id: `PAY-${Date.now()}`, invoiceId: merchantRef, customerId: invoice.customerId,
                            date: paymentDateForDb, amount: callbackJson.total_amount, method: paymentMethod,
                        };
                        await pool.query('INSERT INTO payments SET ?', paymentRecord);
                        const { recordCashMutation } = await loadCashMutationService();
                        await recordCashMutation(pool, {
                            date: paymentRecord.date,
                            direction: 'in',
                            category: 'invoice_payment',
                            amount: paymentRecord.amount,
                            method: paymentMethod,
                            description: `Pembayaran invoice ${merchantRef}`,
                            reference_type: 'payment',
                            reference_id: paymentRecord.id,
                            customer_id: invoice.customerId,
                            source: 'system',
                            timezone,
                        });
                        console.log(`[Tripay Callback] Payment record created for invoice ${merchantRef}.`);
                        
                        const [[customerData]] = await pool.query('SELECT c.*, p.name as packageName FROM customers c LEFT JOIN packages p ON c.packageId = p.id WHERE c.id = ?', [invoice.customerId]);
                        if (customerData) {
                            sendSseEvent({
                                type: 'payment_success',
                                customerName: customerData.name,
                                amount: callbackJson.total_amount,
                                invoiceId: merchantRef
                            });
                        }

                        if (settings.billing.whatsappNotificationsEnabled && settings.whatsapp?.paymentSuccess && customerData && customerData.phone) {
                            const billingPeriod = formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd);
                            const message = replacePlaceholders(settings.whatsapp.paymentSuccess, {
                                customerName: customerData.name, customerId: customerData.id,
                                invoiceId: invoice.id, amount: formatRupiah(invoice.amount),
                                packageName: customerData.packageName || 'N/A',
                                billingPeriod,
                                paymentMethod: paymentMethod
                            });
                            const result = await whatsappService.sendMessage(customerData.phone, message);
                            await pool.query('INSERT INTO whatsapp_logs SET ?', {
                                recipient_number: customerData.phone,
                                customer_id: customerData.id,
                                message_body: message,
                                status: result.success ? 'sent' : 'failed',
                                type: 'Payment Success',
                                error_message: result.error || null,
                            });
                        }

                        if (customerData?.email) {
                            try {
                                const { sendInvoiceEmailNotification } = await loadEmailService();
                                await sendInvoiceEmailNotification({
                                    settings,
                                    customer: customerData,
                                    invoice,
                                    packageName: customerData.packageName || 'N/A',
                                    type: 'paid',
                                    paymentMethod,
                                });
                            } catch (emailError) {
                                console.error(`[Tripay Callback] Failed to send payment success email for invoice ${invoice.id}:`, emailError.message);
                            }
                        }

                        try {
                            const { restoreCustomerProfile } = await loadBillingServices();
                            await restoreCustomerProfile(invoice.customerId, invoice);
                        } catch (restoreError) {
                            console.error(`[Billing] Failed to auto-restore profile for customer ${invoice.customerId} after gateway payment. Error: ${restoreError.message}`);
                        }

                    }
                }
            }
            res.status(200).json({ success: true });
        } catch (error) {
            console.error('[Tripay Callback] Error:', error);
            res.status(500).json({ success: false, message: 'Internal server error.' });
            }
        });
    
    app.post('/webhook', async (req, res) => {
        const webhookSecret = process.env.DIGIFLAZZ_WEBHOOK_SECRET;
        const rawBody = req.body;
        if (!Buffer.isBuffer(rawBody)) {
            return res.status(400).json({ success: false, message: 'Invalid webhook payload.' });
        }

        const signatureHeader = req.headers['x-hub-signature'];
        if (webhookSecret) {
            const expected = `sha1=${crypto.createHmac('sha1', webhookSecret).update(rawBody).digest('hex')}`;
            if (!signatureHeader || signatureHeader !== expected) {
                console.warn('[Digiflazz Webhook] Invalid signature.', signatureHeader, expected);
                return res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
            }
        } else if (signatureHeader) {
            console.warn('[Digiflazz Webhook] Signature received but no webhook secret configured.');
        }

        let payload;
        try {
            payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
        } catch (parseError) {
            console.error('[Digiflazz Webhook] Failed to parse JSON payload:', parseError);
            return res.status(400).json({ success: false, message: 'Malformed JSON payload.' });
        }

        try {
            const isPingEvent = !!(payload && payload.sed && payload.hook_id && payload.hook);
            if (isPingEvent) {
                const pingDetail = {
                    hookId: payload.hook_id,
                    sed: payload.sed,
                    hook: payload.hook,
                };
                updateDigiflazzPingEvent(pingDetail);
                console.log('[Digiflazz Webhook] Received ping event for hook', payload.hook_id);
                return res.json({ success: true, type: 'ping', hookId: payload.hook_id, sed: payload.sed });
            }

            const { handleDigiflazzStatusUpdate } = await loadProtectedRouteModules();
            await handleDigiflazzStatusUpdate(payload);
            res.json({ success: true });
        } catch (error) {
            console.error('[Digiflazz Webhook] Error processing payload:', error);
            res.status(500).json({ success: false, message: 'Failed to process Digiflazz webhook.' });
        }
    });

    app.post('/webhook/kirimdev/whatsapp', async (req, res) => {
        try {
            const settings = await getSettings();
            await whatsappService.applySettings(settings);

            const deliveryMode = String(settings?.whatsapp?.deliveryMode || 'baileys').toLowerCase();
            if (deliveryMode !== 'custom') {
                return res.json({ success: true, ignored: true, reason: 'Kirimdev webhook is only active when delivery mode is custom.' });
            }

            const rawBody = Buffer.isBuffer(req.body)
                ? req.body.toString('utf8')
                : typeof req.body === 'string'
                    ? req.body
                    : JSON.stringify(req.body || {});

            const signatureHeader = req.get('x-kirim-signature');
            const webhookSecrets = getKirimdevWebhookSecrets();
            if (signatureHeader && webhookSecrets.length > 0) {
                await verifyWebhookSignature({
                    rawBody,
                    signatureHeader,
                    secrets: webhookSecrets,
                });
            } else if (signatureHeader) {
                console.warn('[Kirimdev Webhook] Signature received but no webhook secret configured.');
            }

            const payload = rawBody.trim() ? JSON.parse(rawBody) : {};
            const statusUpdate = await handleWhatsAppStatusWebhook(payload, {
                transport: 'custom',
                timezone: process.env.APP_TIMEZONE || null,
            });
            if (statusUpdate?.handled) {
                return res.json({
                    success: true,
                    type: 'status',
                    status: statusUpdate.status,
                    providerMessageId: statusUpdate.providerMessageId,
                    recipientNumber: statusUpdate.recipientNumber,
                });
            }

            const inboundMessage = extractKirimdevWebhookMessage(payload, req.headers);
            if (!inboundMessage) {
                return res.status(400).json({ success: false, message: 'Unable to extract inbound WhatsApp message from webhook payload.' });
            }

            const { handleWhatsappMessage } = await loadProtectedRouteModules();
            await handleWhatsappMessage(inboundMessage);
            res.json({ success: true });
        } catch (error) {
            if (error instanceof SignatureExpiredError) {
                return res.status(400).json({ success: false, message: 'Stale Kirimdev webhook signature.' });
            }
            if (error instanceof InvalidSignatureError) {
                return res.status(401).json({ success: false, message: 'Invalid Kirimdev webhook signature.' });
            }
            if (error instanceof MalformedPayloadError) {
                return res.status(400).json({ success: false, message: 'Malformed Kirimdev webhook payload.' });
            }
            console.error('[Kirimdev Webhook] Error processing payload:', error);
            res.status(500).json({ success: false, message: 'Failed to process Kirimdev webhook.' });
        }
    });

    app.post('/webhook/fonnte/whatsapp', async (req, res) => {
        try {
            const settings = await getSettings();
            await whatsappService.applySettings(settings);

            if (!isFonnteInboundMode(settings)) {
                return res.json({ success: true, ignored: true, reason: 'Fonnte webhook is only active when delivery mode is Fonnte/WA.' });
            }

            const rawBody = Buffer.isBuffer(req.body)
                ? req.body.toString('utf8')
                : typeof req.body === 'string'
                    ? req.body
                    : JSON.stringify(req.body || {});

            let payload;
            try {
                payload = rawBody.trim() ? JSON.parse(rawBody) : {};
            } catch (parseError) {
                console.error('[Fonnte Webhook] Failed to parse JSON payload:', parseError);
                return res.status(400).json({ success: false, message: 'Malformed Fonnte webhook payload.' });
            }
            const inboundMessage = extractFonnteWebhookMessage(payload);

            if (!inboundMessage) {
                return res.status(400).json({ success: false, message: 'Unable to extract inbound WhatsApp message from Fonnte webhook payload.' });
            }

            const { handleWhatsappMessage } = await loadProtectedRouteModules();
            await handleWhatsappMessage(inboundMessage);
            res.json({ success: true });
        } catch (error) {
            console.error('[Fonnte Webhook] Error processing payload:', error);
            res.status(500).json({ success: false, message: 'Failed to process Fonnte webhook.' });
        }
    });

    // Middleware to attach SSE function to all subsequent requests
    app.use((req, res, next) => {
        req.sendSseEvent = sendSseEvent;
        next();
    });

    // Router callbacks use the external API key, not an interactive JWT session.
    mountHotspotWebhook(app, {
        getSettings,
        handleWebhook: async (req, res) => {
            const { handleHotspotWebhook } = await import('./routes/hotspotRoutes.js');
            return handleHotspotWebhook(req, res);
        },
    });

    // --- ROUTE MOUNTING (REFACTORED FOR CLARITY) ---

    // 1. Create a router for all protected API endpoints.
    const protectedApiRouter = express.Router();
    let protectedRoutesMounted = false;
    let publicRoutesMounted = false;
    
    // Apply the authentication middleware to ALL routes within this router.
    protectedApiRouter.use(authMiddleware);
    
    // Mount the SSE endpoint directly here
    protectedApiRouter.get('/admin/events', (req, res) => {
        // Auth middleware has run. Check for specific role.
        if (req.user.role !== 'admin' && req.user.role !== 'reseller') {
            return res.status(403).json({ message: 'Forbidden' });
        }
    
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
    
        const clientId = Date.now();
        const newClient = { id: clientId, res };
        clients.push(newClient);
        console.log(`[SSE] Client ${clientId} connected. Total clients: ${clients.length}`);
    
        req.on('close', () => {
            clients = clients.filter(client => client.id !== clientId);
            console.log(`[SSE] Client ${clientId} disconnected. Total clients: ${clients.length}`);
        });
    });

    // 2. Mount the main protected router. Any request to /api/* that wasn't handled by /api/public/* will be checked here.
    app.use('/api', protectedApiRouter);


    // Serve the 'uploads' directory statically
    app.use('/uploads', express.static(UPLOAD_DIR));

    // --- PRODUCTION/STATIC SERVING MIDDLEWARE ---
    const BUILD_PATH_FROM_SRC = path.join(__dirname, '..', 'dist');
    const BUILD_PATH_FROM_DIST = path.join(__dirname, '..');
    
    const BUILD_PATH = fs.existsSync(path.join(BUILD_PATH_FROM_DIST, 'index.html'))
        ? BUILD_PATH_FROM_DIST
        : (fs.existsSync(path.join(BUILD_PATH_FROM_SRC, 'index.html')) ? BUILD_PATH_FROM_SRC : null);

    if (BUILD_PATH) {
        console.log(`[Static Serving] 'dist' folder found. Serving static files from: ${BUILD_PATH}`);
        app.use(express.static(BUILD_PATH));
        
        app.get('*', (req, res, next) => {
            if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
                return next();
            }
            res.sendFile(path.join(BUILD_PATH, 'index.html'));
        });
    }

    const HOST = listenHost;
    const PORT = resolvedPort;

    const mountDeferredRoutes = async () => {
        console.log('[Startup] Loading public and protected route modules...');
        const [publicRouteModule, routeModules] = await Promise.all([
            loadPublicRoutes(),
            loadProtectedRouteModules(),
        ]);

        if (!publicRoutesMounted) {
            app.use('/api/public', publicRouteModule.default);
            publicRoutesMounted = true;
            console.log('[Startup] Public routes mounted.');
        }

        if (!protectedRoutesMounted) {
            protectedApiRouter.use('/admin', routeModules.adminRoutes);
            protectedApiRouter.use('/billing', routeModules.billingRoutes);
            protectedApiRouter.use('/customers', routeModules.customerRoutes);
            protectedApiRouter.use('/network', routeModules.networkRoutes);
            protectedApiRouter.use('/pppoe', routeModules.pppoeRoutes);
            protectedApiRouter.use('/hotspot', routeModules.hotspotRoutes);
            protectedApiRouter.use('/acs', routeModules.acsRoutes);
            protectedApiRouter.use('/chatbot', routeModules.chatbotRoutes);
            protectedApiRouter.use('/technician', routeModules.technicianRoutes);
            protectedApiRouter.use('/reseller', routeModules.resellerRoutes);
            protectedApiRouter.use('/ppob', routeModules.ppobRoutes);
            protectedApiRouter.use('/olt', routeModules.oltRoutes);
            protectedApiRouter.use('/notifications', routeModules.notificationRoutes);
            protectedRoutesMounted = true;
            console.log('[Startup] Protected routes mounted.');
        }

        // Keep the API 404 fallback at the very end so /api/public routes
        // can resolve normally before unmatched API requests are rejected.
        if (!app.locals.api404Mounted) {
            app.locals.api404Mounted = true;
            app.use('/api/*', (req, res) => {
                res.status(404).json({ message: `API endpoint not found: ${req.method} ${req.originalUrl}` });
            });
        }
    };

    const startDeferredServices = async () => {
        if (isLightweightRuntime) {
            console.warn('[Startup] Lightweight runtime aktif. Background services, WhatsApp worker, ACS scheduler, PPPoE scheduler, dan database restore scheduler tidak dijalankan.');
        }

        console.log('[Startup] Loading cron jobs...');
        const cronModule = await loadCronJobs();

        if (databaseReady && !isLightweightRuntime) {
            cronModule.startBackgroundServices();
            const routeModules = await loadProtectedRouteModules();
            routeModules.startAcsSyncJobScheduler?.();
            routeModules.startPppoeSyncJobScheduler?.();
            routeModules.startDatabaseRestoreJobScheduler?.();
        }
    };

    httpServer = app.listen(PORT, HOST, () => {
        if (!process.env.JWT_SECRET) {
            console.warn("\n\n\x1b[33m%s\x1b[0m", "WARNING: JWT_SECRET is not set in backend/.env file. Authentication will fail. Please add a strong, random secret.\n\n");
        }
        if (isProduction) {
            console.log(`[Production] Server running and listening internally on port ${PORT}`);
        } else {
            console.log(`[Development] Backend server is running on http://${HOST}:${PORT}`);
            console.log(`[Development] Accessible on all network interfaces.`);
        }
        if (isLightweightRuntime) {
            console.warn('[Startup] Lightweight runtime aktif. Background services, WhatsApp worker, ACS scheduler, PPPoE scheduler, dan database restore scheduler tidak dijalankan.');
        } else if (!databaseReady) {
            console.warn('[Startup] Background services tidak dijalankan karena koneksi database belum terverifikasi.');
        } else {
            // no-op; deferred services will handle startup.
        }
        void mountDeferredRoutes()
            .then(() => verifyDatabaseConnection())
            .then(() => startDeferredServices())
            .catch((error) => {
                console.error('[Startup] Deferred route mounting failed:', error?.stack || error);
            });
    });

    httpServer.on('error', (error) => {
        console.error('[Startup] HTTP server error:', error?.stack || error);
        if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') {
            shutdownBackend(1, `http server ${error.code}`).catch(() => {
                process.exit(1);
            });
        }
    });
};

startServer().catch(err => {
    console.error('[Server] startServer() rejected before bootstrap completion.');
    // Check if it's a database connection error from the migration step
    if (err.code && err.errno) {
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.error("!!! FAILED TO CONNECT TO MYSQL DATABASE !!!");
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.error("Error connecting to the MySQL database:");
        console.error(`- Code: ${err.code}`);
        console.error(`- Errno: ${err.errno}`);
        console.error(`- Message: ${err.message}`);
        console.error("\nPlease check your .env file in the /backend directory and ensure your MySQL server is running.");
        console.error("The backend server will not start without a database connection.");
    } else {
        console.error("Failed to start server with an unexpected error:", err);
    }
    shutdownBackend(1, 'startup failure').catch(() => {
        process.exit(1);
    });
});
