




// Import path and dotenv first to configure environment variables
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

// Boilerplate for __dirname in ES Modules & load .env from the backend directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// Now import other modules
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from './db.js'; // Import the database pool
// import { migrateDatabase } from './migrate.js'; // Import the migration function
import { getSettings, formatRupiah, formatBillingPeriod, replacePlaceholders, toMySQLDatetime, dateToYMD, parseLocalDateString } from './utils.js'; // Import getSettings
import tripayService from './tripayService.js';
import whatsappService from './whatsappService.js'; // Diperlukan untuk notifikasi
import { restoreCustomerProfile } from './services.js'; // Diperlukan untuk reaktivasi
import { recordCashMutation } from './cashMutationService.js';
import { sendInvoiceEmailNotification } from './emailService.js';
import { resolveNamespacedStorageDir } from './storagePaths.js';

// Impor rute modular
import adminRoutes from './routes/adminRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import networkRoutes from './routes/networkRoutes.js';
import pppoeRoutes from './routes/pppoeRoutes.js';
import hotspotRoutes from './routes/hotspotRoutes.js';
import acsRoutes from './routes/acsRoutes.js';
import chatbotRoutes from './routes/chatbotRoutes.js';
import publicRoutes from './routes/publicRoutes.js'; // Impor rute publik baru
import technicianRoutes from './routes/technicianRoutes.js';
import resellerRoutes from './routes/resellerRoutes.js'; // Impor rute reseller baru
import ppobRoutes, { handleDigiflazzStatusUpdate } from './routes/ppobRoutes.js'; // Impor rute PPOB baru
import oltRoutes from './routes/oltRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
// Impor fungsi startup tunggal untuk layanan latar belakang
import { startBackgroundServices } from './cronJobs.js';
import { updateDigiflazzPingEvent } from './services/digiflazzWebhookState.js';

const app = express();
app.set('trust proxy', 1); // Trust headers from proxies
const isProduction = process.env.NODE_ENV === 'production';

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


// --- MIDDLEWARE BODY PARSING ---
// 1. Tangani rute callback Tripay secara spesifik. Middleware ini harus berjalan SEBELUM express.json().
app.use('/api/billing/tripay-callback', express.raw({ type: 'application/json' }));

// 1b. Tangani webhook Digiflazz (X-Hub-Signature) secara raw agar signature tetap valid.
app.use('/webhook', express.raw({ type: 'application/json' }));

// 2. Terapkan parser JSON global.
app.use(express.json({ limit: '5mb' }));


// --- Server Startup ---
const startServer = async () => {
    // Migrasi database dinonaktifkan dari startup server.
    // Jalankan secara manual menggunakan skrip terpisah jika diperlukan.
    // await migrateDatabase();

    const UPLOAD_DIR = resolveNamespacedStorageDir({
        exactDirEnv: 'UPLOAD_DIR',
        baseDirEnv: 'UPLOAD_BASE_DIR',
        defaultBaseDir: '/opt/uploads',
    });
    if (!fs.existsSync(UPLOAD_DIR)) {
        console.log('[Startup] Creating uploads directory...');
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    
    // --- JWT Authentication Middleware ---
    const authMiddleware = (req, res, next) => {
        if (req.path === '/hotspot/webhook') {
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

            await handleDigiflazzStatusUpdate(payload);
            res.json({ success: true });
        } catch (error) {
            console.error('[Digiflazz Webhook] Error processing payload:', error);
            res.status(500).json({ success: false, message: 'Failed to process Digiflazz webhook.' });
        }
    });

    // Middleware to attach SSE function to all subsequent requests
    app.use((req, res, next) => {
        req.sendSseEvent = sendSseEvent;
        next();
    });

    // --- ROUTE MOUNTING (REFACTORED FOR CLARITY) ---

    // 1. Mount public routes on a distinct path prefix. These do NOT require authentication.
    // Frontend calls this path directly (e.g., /api/public/login).
    app.use('/api/public', publicRoutes);

    // 2. Create a router for all protected API endpoints.
    const protectedApiRouter = express.Router();
    
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

    // Mount all protected route modules inside this router.
    protectedApiRouter.use('/admin', adminRoutes);
    protectedApiRouter.use('/billing', billingRoutes);
    protectedApiRouter.use('/customers', customerRoutes);
    protectedApiRouter.use('/network', networkRoutes);
    protectedApiRouter.use('/pppoe', pppoeRoutes);
    protectedApiRouter.use('/hotspot', hotspotRoutes);
    protectedApiRouter.use('/acs', acsRoutes);
    protectedApiRouter.use('/chatbot', chatbotRoutes);
    protectedApiRouter.use('/technician', technicianRoutes);
    protectedApiRouter.use('/reseller', resellerRoutes);
    protectedApiRouter.use('/ppob', ppobRoutes);
    protectedApiRouter.use('/olt', oltRoutes);
    protectedApiRouter.use('/notifications', notificationRoutes);

    // 3. Mount the main protected router. Any request to /api/* that wasn't handled by /api/public/* will be checked here.
    app.use('/api', protectedApiRouter);

    app.get('/api/health', (req, res) => {
        res.status(200).json({ ok: true });
    });


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

    app.use('/api/*', (req, res) => {
        res.status(404).json({ message: `API endpoint not found: ${req.method} ${req.originalUrl}` });
    });


    const HOST = process.env.APP_HOST || '0.0.0.0';
    const PORT = process.env.PORT || 3002;

    app.listen(PORT, HOST, () => {
        if (!process.env.JWT_SECRET) {
            console.warn("\n\n\x1b[33m%s\x1b[0m", "WARNING: JWT_SECRET is not set in backend/.env file. Authentication will fail. Please add a strong, random secret.\n\n");
        }
        if (isProduction) {
            console.log(`[Production] Server running and listening internally on port ${PORT}`);
        } else {
            console.log(`[Development] Backend server is running on http://${HOST}:${PORT}`);
            console.log(`[Development] Accessible on all network interfaces.`);
        }
        startBackgroundServices();
    });
};

startServer().catch(err => {
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
    process.exit(1);
});
