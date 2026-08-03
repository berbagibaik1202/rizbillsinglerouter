import express from 'express';
import pool from '../db.js';
import { getSettings, replacePlaceholders, generateNewCustomerId } from '../utils.js';
import whatsappService from '../whatsappService.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import tripayService from '../tripayService.js';
import http from 'node:http';
import https from 'node:https';

const router = express.Router();
const PUBLIC_APP_SETTINGS_FALLBACK = {
    app: {
        appName: 'ISP Billing',
        appLogoUrl: '/logo.png'
    }
};

const appendProxyHeaderHints = (targetUrl, headerHints = {}) => {
    const url = new URL(targetUrl, targetUrl);
    if (headerHints.userAgent && !url.searchParams.has('ua')) {
        url.searchParams.set('ua', headerHints.userAgent);
    }
    if (headerHints.referer && !url.searchParams.has('referer')) {
        url.searchParams.set('referer', headerHints.referer);
    }
    if (headerHints.origin && !url.searchParams.has('origin')) {
        url.searchParams.set('origin', headerHints.origin);
    }
    if (headerHints.acceptLanguage && !url.searchParams.has('accept-language')) {
        url.searchParams.set('accept-language', headerHints.acceptLanguage);
    }
    return url.toString();
};

const rewriteProxyPlaylistBody = (body, token, baseUrl, headerHints = {}) => {
    const proxyUrlFor = (targetUrl) => {
        const proxiedTarget = appendProxyHeaderHints(targetUrl, headerHints);
        return `/api/public/media-proxy?token=${encodeURIComponent(token)}&url=${encodeURIComponent(proxiedTarget)}`;
    };

    return String(body || '')
        .split(/\r?\n/)
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            if (trimmed.startsWith('#EXTVLCOPT:')) {
                const optionValue = trimmed.slice('#EXTVLCOPT:'.length).trim();
                const [keyRaw, ...valueParts] = optionValue.split('=');
                const key = String(keyRaw || '').trim().toLowerCase();
                const value = valueParts.join('=').trim().replace(/^"(.*)"$/, '$1');

                if (key === 'http-user-agent' && value) {
                    headerHints.userAgent = value;
                } else if ((key === 'http-referrer' || key === 'http-referer') && value) {
                    headerHints.referer = value;
                } else if (key === 'http-origin' && value) {
                    headerHints.origin = value;
                } else if (key === 'http-accept-language' && value) {
                    headerHints.acceptLanguage = value;
                }
                return line;
            }

            if (trimmed.startsWith('#')) {
                return line.replace(/URI="([^"]+)"/gi, (_match, uri) => {
                    try {
                        const resolved = new URL(uri, baseUrl).href;
                        return `URI="${proxyUrlFor(resolved)}"`;
                    } catch {
                        return _match;
                    }
                });
            }

            try {
                const resolved = new URL(trimmed, baseUrl).href;
                return proxyUrlFor(resolved);
            } catch {
                return line;
            }
        })
        .join('\n');
};

const rewriteProxyMediaBody = (body, token, baseUrl, headerHints = {}) => {
    const resolveUrl = (value) => {
        try {
            return new URL(value, baseUrl).href;
        } catch {
            return value;
        }
    };

    let rewritten = String(body || '');

    rewritten = rewritten.replace(/\b(URI|url|sourceURL|initialization|media|xlink:href|href)="([^"]+)"/gi, (match, attr, value) => {
        const lowerAttr = String(attr || '').toLowerCase();
        if (lowerAttr.startsWith('xmlns') || /schemaLocation$/i.test(lowerAttr)) {
            return match;
        }
        if (/^(indexRange|range)$/i.test(attr)) {
            return match;
        }
        if (value.includes('$')) {
            return match;
        }
        const resolved = resolveUrl(value);
        return `${attr}="${resolved}"`;
    });

    rewritten = rewritten.replace(/<BaseURL>([^<]+)<\/BaseURL>/gi, (_match, value) => {
        const trimmed = String(value || '').trim();
        if (!trimmed) return _match;
        return `<BaseURL>${resolveUrl(trimmed)}</BaseURL>`;
    });

    rewritten = rewritten.replace(/<Location>([^<]+)<\/Location>/gi, (_match, value) => {
        const trimmed = String(value || '').trim();
        if (!trimmed || /^data:/i.test(trimmed)) return _match;
        return `<Location>${resolveUrl(trimmed)}</Location>`;
    });

    const dashBaseUrl = (() => {
        try {
            return new URL('.', baseUrl).href;
        } catch {
            return baseUrl;
        }
    })();

    if (/\bSegmentTemplate\b/i.test(rewritten) && !/<BaseURL>/i.test(rewritten)) {
        rewritten = rewritten.replace(/(<MPD\b[^>]*>)/i, `$1\n  <BaseURL>${dashBaseUrl}</BaseURL>`);
    }
    return rewritten;
};

const buildUpstreamHeaders = (req) => {
    let targetOrigin = '';
    try {
        const requestedTarget = normalizeTargetUrl(req.query?.url);
        targetOrigin = requestedTarget ? new URL(requestedTarget).origin : '';
    } catch {
        targetOrigin = '';
    }

    const headers = {
        'User-Agent': req.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': req.get('accept') || '*/*',
        'Accept-Language': req.get('accept-language') || 'en-US,en;q=0.9,id;q=0.8',
        'Cache-Control': req.get('cache-control') || 'no-cache',
        'Pragma': req.get('pragma') || 'no-cache',
    };

    const forwardedHeaders = [
        'range',
        'if-range',
        'if-modified-since',
        'if-none-match',
        'origin',
        'ua',
        'accept-language',
    ];

    for (const headerName of forwardedHeaders) {
        const value = req.get(headerName);
        if (value) {
            headers[headerName] = value;
        }
    }

    headers['accept-encoding'] = 'identity';
    headers.connection = 'keep-alive';

    if (req.query?.ua) {
        headers['User-Agent'] = String(req.query.ua);
    }
    if (req.query?.referer) {
        headers.referer = String(req.query.referer);
    } else if (targetOrigin) {
        headers.referer = `${targetOrigin}/`;
    }
    if (req.query?.origin) {
        headers.origin = String(req.query.origin);
    } else if (targetOrigin) {
        headers.origin = targetOrigin;
    }
    if (req.query?.['accept-language']) {
        headers['Accept-Language'] = String(req.query['accept-language']);
    }

    if (/detik\.com$/i.test(targetOrigin)) {
        headers.referer = headers.referer || 'https://video.detik.com/';
        headers.origin = headers.origin || 'https://video.detik.com';
    }

    return headers;
};

const getRequestHeaderHints = (req, targetUrl) => {
    let origin = '';
    try {
        origin = new URL(targetUrl).origin;
    } catch {
        origin = '';
    }

    return {
        userAgent: req.query?.ua ? String(req.query.ua) : req.get('user-agent') || undefined,
        referer: req.query?.referer ? String(req.query.referer) : targetUrl,
        origin: req.query?.origin ? String(req.query.origin) : origin || undefined,
        acceptLanguage: req.query?.['accept-language'] ? String(req.query['accept-language']) : req.get('accept-language') || undefined,
    };
};

const requestUpstream = async (targetUrl, headers, depth = 0, method = 'GET') => {
    const parsedUrl = new URL(targetUrl);
    const requestModule = parsedUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const request = requestModule.request(targetUrl, {
            method,
            headers,
        }, (response) => {
            const statusCode = response.statusCode || 500;
            const location = response.headers.location;

            if (statusCode >= 300 && statusCode < 400 && location) {
                response.resume();
                if (depth >= 5) {
                    reject(new Error(`Too many redirects while fetching ${targetUrl}`));
                    return;
                }
                const nextUrl = new URL(location, targetUrl).href;
                requestUpstream(nextUrl, headers, depth + 1, method).then(resolve).catch(reject);
                return;
            }

            resolve({
                statusCode,
                headers: response.headers,
                stream: response,
                finalUrl: targetUrl,
            });
        });

        request.on('error', reject);
        request.setTimeout(120000, () => {
            request.destroy(new Error(`Upstream request timeout for ${targetUrl}`));
        });
        request.end();
    });
};

const streamToString = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
};

const normalizeTargetUrl = (value) => {
    const rawValue = String(value || '').trim().replace(/^"(.*)"$/, '$1');
    if (!rawValue) return '';

    const candidates = [rawValue];
    try {
        const decodedOnce = decodeURIComponent(rawValue);
        if (decodedOnce && decodedOnce !== rawValue) {
            candidates.push(decodedOnce.trim());
        }
    } catch {
        // Ignore decode errors and fall back to the original value.
    }

    for (const candidate of candidates) {
        if (/^https?:\/\//i.test(candidate)) {
            return candidate;
        }
    }

    return rawValue;
};

const handleMediaProxy = async (req, res) => {
    try {
        const token = String(req.query.token || '').trim();
        const targetUrl = normalizeTargetUrl(req.query.url);
        const isHeadRequest = req.method === 'HEAD';

        if (!token) {
            return res.status(401).json({ message: 'Media token is required.' });
        }
        if (!targetUrl) {
            return res.status(400).json({ message: 'Target URL is required.' });
        }
        if (!/^https?:\/\//i.test(targetUrl)) {
            return res.status(400).json({ message: 'Only absolute http(s) URLs are allowed.' });
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (!payload || payload.scope !== 'media') {
            return res.status(401).json({ message: 'Invalid media token.' });
        }

        const requestHeaderHints = getRequestHeaderHints(req, targetUrl);
        const response = await requestUpstream(targetUrl, buildUpstreamHeaders(req), 0, isHeadRequest ? 'HEAD' : 'GET');

        const contentType = String(response.headers['content-type'] || '');
        const isPlaylistLike = /mpegurl|m3u8|text\/plain|xml|dash/i.test(contentType) || /\.(m3u8|mpd)(\?|$)/i.test(targetUrl);

        if (isPlaylistLike) {
            const body = isHeadRequest ? '' : await streamToString(response.stream);
            const rewritten = /\.mpd(\?|$)/i.test(targetUrl) || /xml|dash/i.test(contentType)
                ? rewriteProxyMediaBody(body, token, targetUrl, requestHeaderHints)
                : rewriteProxyPlaylistBody(body, token, targetUrl, requestHeaderHints);
            res.setHeader('Content-Type', /\.(mpd)(\?|$)/i.test(targetUrl) || /xml|dash/i.test(contentType)
                ? 'application/dash+xml; charset=utf-8'
                : 'application/vnd.apple.mpegurl; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.status(response.statusCode);
            if (isHeadRequest) {
                return res.end();
            }
            return res.send(rewritten);
        }

        res.status(response.statusCode);
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        const contentLength = response.headers['content-length'];
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }
        const upstreamRange = response.headers['content-range'];
        if (upstreamRange) {
            res.setHeader('Content-Range', upstreamRange);
        }

        if (isHeadRequest) {
            if (response.stream) {
                response.stream.resume();
            }
            return res.end();
        }

        if (!response.stream) {
            return res.end();
        }

        response.stream.on('error', (streamError) => {
            console.error('[Public Media Proxy] Stream error:', streamError);
            if (!res.headersSent) {
                res.status(502);
            }
            res.end();
        });
        return response.stream.pipe(res);
    } catch (error) {
        console.error('[Public Media Proxy] Failed:', error);
        if (String(error?.name || '') === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Media token expired.' });
        }
        if (String(error?.cause?.code || error?.code || '') === 'ECONNRESET') {
            return res.status(502).json({ message: 'Upstream stream connection was reset.' });
        }
        return res.status(500).json({ message: error.message || 'Failed to proxy media.' });
    }
};

router.get('/media-proxy', handleMediaProxy);
router.head('/media-proxy', handleMediaProxy);

// Simpan OTP sementara di memori. Untuk produksi, gunakan Redis atau tabel database.
const otpStore = {};

// --- Rute Login Admin (Publik) ---
router.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required.' });
        }

        const [users] = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username.trim()]);
        
        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const user = users[0];
        
        // Periksa apakah kata sandi ada dan terlihat seperti hash
        if (!user.password || !user.password.startsWith('$2a$')) {
            // Ini bisa terjadi dengan data lama. Tolak login demi keamanan.
             console.warn(`[Auth] Upaya login untuk pengguna '${username}' dengan kata sandi yang tidak di-hash. Akses ditolak.`);
             return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const isPasswordMatch = await bcrypt.compare(password, user.password);

        if (!isPasswordMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const userPayload = {
            id: user.id,
            username: user.username,
            role: user.role,
        };
        
        const token = jwt.sign(userPayload, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({ success: true, token });

    } catch (e) {
        console.error("[Login Error] Terjadi kesalahan server:", e);
        res.status(500).json({ message: e.message || 'Terjadi kesalahan server saat login.' });
    }
});


// --- Rute Login Pelanggan (Dipindahkan ke Publik) ---

router.post('/login/request-otp', async (req, res) => {
    const { customerId } = req.body;
    if (!customerId) return res.status(400).json({ message: 'Customer ID is required.' });

    try {
        const settings = await getSettings();
        await whatsappService.applySettings(settings);
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [customerId]);
        if (!customer) {
            return res.status(404).json({ message: 'Customer ID not found.' });
        }
        
        // Jika OTP dinonaktifkan di pengaturan, login langsung dan kembalikan token
        if (!settings.otp || !settings.otp.enabled) {
            const customerPayload = {
                id: customer.id,
                name: customer.name,
                address: customer.address,
                phone: customer.phone,
                email: customer.email,
                packageId: customer.packageId,
                status: customer.status,
                pppoeUsername: customer.pppoeUsername,
                acsSerialNumber: customer.acsSerialNumber,
                role: 'customer'
            };
            const token = jwt.sign(customerPayload, process.env.JWT_SECRET, { expiresIn: '7d' });
            return res.json({ 
                success: true, 
                otpRequired: false, 
                token,
                customer,
                apiKey: settings.app.apiKey // Keep for older mobile versions if any
            });
        }

        if (!customer.phone) {
            return res.status(400).json({ message: 'No phone number is registered for this account. Please contact support.' });
        }

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expirationTime = Date.now() + 5 * 60 * 1000; // validitas 5 menit

        otpStore[customerId] = { code: otpCode, expires: expirationTime };

        const message = replacePlaceholders(settings.otp.whatsappTemplate, { otpCode });
        const waResult = await whatsappService.sendMessage(customer.phone, message);
        
        await pool.query('INSERT INTO whatsapp_logs SET ?', {
            recipient_number: customer.phone,
            customer_id: customer.id,
            message_body: message,
            status: waResult.success ? 'sent' : 'failed',
            type: 'OTP Login',
            error_message: waResult.error || null,
        });

        if (!waResult.success) {
            throw new Error(waResult.error || 'Failed to send OTP via WhatsApp.');
        }

        res.json({ success: true, otpRequired: true });

    } catch (error) {
        console.error("Request OTP Error:", error);
        res.status(500).json({ message: error.message || 'An internal server error occurred.' });
    }
});


router.post('/login/verify-otp', async (req, res) => {
    const { customerId, otp } = req.body;
    if (!customerId || !otp) {
        return res.status(400).json({ message: 'Customer ID and OTP are required.' });
    }

    try {
        const storedOtp = otpStore[customerId];

        if (!storedOtp) {
            return res.status(400).json({ success: false, message: 'OTP not found. Please request a new one.' });
        }

        if (Date.now() > storedOtp.expires) {
            delete otpStore[customerId];
            return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
        }

        if (storedOtp.code !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP code.' });
        }

        // OTP valid, bersihkan dan ambil data pelanggan
        delete otpStore[customerId];
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [customerId]);
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }
        
        const customerPayload = {
            id: customer.id,
            name: customer.name,
            // Include all necessary fields for the customer portal state
            address: customer.address,
            phone: customer.phone,
            email: customer.email,
            packageId: customer.packageId,
            status: customer.status,
            pppoeUsername: customer.pppoeUsername,
            acsSerialNumber: customer.acsSerialNumber,
            role: 'customer'
        };

        const token = jwt.sign(customerPayload, process.env.JWT_SECRET, { expiresIn: '7d' });

        const settings = await getSettings();
        res.json({ 
            success: true, 
            token,
            customer,
            apiKey: settings.app.apiKey // Keep for older mobile versions if any
        });

    } catch (error) {
        console.error("Verify OTP Error:", error);
        res.status(500).json({ message: 'An internal server error occurred during OTP verification.' });
    }
});


// GET /api/public/settings
router.get('/settings', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        const settings = await getSettings();
        const publicSettings = {
            app: {
                appName: settings.app?.appName || PUBLIC_APP_SETTINGS_FALLBACK.app.appName,
                appLogoUrl: settings.app?.appLogoUrl || PUBLIC_APP_SETTINGS_FALLBACK.app.appLogoUrl,
            }
        };
        res.json(publicSettings);
    } catch (error) {
        console.error('[Public API] Error fetching public settings:', error);
        res.json(PUBLIC_APP_SETTINGS_FALLBACK);
    }
});


// GET /api/public/invoice/:invoiceId
router.get('/invoice/:invoiceId', async (req, res) => {
    const { invoiceId } = req.params;
    try {
        const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);

        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found.' });
        }

        const [[customer]] = await pool.query('SELECT name FROM customers WHERE id = ?', [invoice.customerId]);
        if (!customer) {
            return res.status(404).json({ message: 'Associated customer not found.' });
        }

        const publicDetails = {
            id: invoice.id,
            amount: invoice.amount,
            dueDate: invoice.dueDate,
            customerName: customer.name,
            status: invoice.status,
        };

        res.json(publicDetails);

    } catch (error) {
        console.error(`[Public API] Error fetching invoice ${invoiceId}:`, error);
        res.status(500).json({ message: 'Internal server error.' });
    }
});


// POST /api/public/register
router.post('/register', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { name, email, phone, address, packageId, nik, namawifi, passwordwifi, location } = req.body;

        if (!name || !phone || !address || !packageId) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Nama, telepon, alamat, dan paket adalah kolom yang wajib diisi.' });
        }

        const [existingCustomers] = await connection.query('SELECT id FROM customers WHERE phone = ? FOR UPDATE', [phone]);
        
        if (existingCustomers.length > 0) {
            await connection.rollback();
            console.log(`[Public API] Pendaftaran duplikat ditolak untuk nomor telepon: ${phone}`);
            return res.status(409).json({ success: false, message: 'Nomor telepon ini sudah terdaftar. Mohon tunggu, tim kami akan segera menghubungi Anda.' });
        }

        const [[selectedPackage]] = await connection.query('SELECT name, speed FROM packages WHERE id = ?', [packageId]);
        if (!selectedPackage) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Paket yang dipilih tidak ditemukan.' });
        }

        const settings = await getSettings();
        const prefix = settings.app.customerIdPrefix || 'WEB';
        const newId = generateNewCustomerId(prefix);
        const packageLabel = `${selectedPackage.name}${selectedPackage.speed ? ` - ${selectedPackage.speed} Mbps` : ''}`;

        const fullAddressParts = [address];
        if (namawifi) fullAddressParts.push(`Nama WiFi Pilihan: ${namawifi}`);
        if (passwordwifi) fullAddressParts.push(`Password WiFi Pilihan: ${passwordwifi}`);

        const newCustomer = {
            id: newId,
            name,
            nik: nik || null,
            email: email || null,
            phone,
            address: fullAddressParts.join('\n'),
            packageId,
            status: 'Unregister',
            activeDate: new Date(),
            location: location ? JSON.stringify(location) : null,
            pppoeUsername: null,
            acsSerialNumber: null,
        };

        await connection.query('INSERT INTO customers SET ?', newCustomer);

        await connection.commit();

        try {
            if (settings.billing?.whatsappNotificationsEnabled && settings.whatsapp?.adminPhoneNumber) {
                const template = settings.whatsapp.newRegistrationNotification || 
`PENDAFTARAN BARU\n\nPelanggan: {{customerName}}\nID Pelanggan: {{customerId}}\nNo. HP: {{customerPhone}}\nEmail: {{customerEmail}}\nPaket: {{packageName}}\n\nAlamat:\n{{address}}`;
                const message = replacePlaceholders(template, {
                    customerName: name,
                    customerId: newId,
                    customerPhone: phone,
                    customerEmail: email || '-',
                    packageName: packageLabel,
                    address: newCustomer.address,
                });

                const result = await whatsappService.sendMessage(settings.whatsapp.adminPhoneNumber, message);
                await pool.query('INSERT INTO whatsapp_logs SET ?', {
                    recipient_number: settings.whatsapp.adminPhoneNumber,
                    customer_id: newId,
                    message_body: message,
                    status: result.success ? 'sent' : 'failed',
                    type: 'New Registration Notification',
                    error_message: result.error || null,
                });
            }
        } catch (notificationError) {
            console.error('[Public API] Failed to send WhatsApp notification for new registration:', notificationError);
        }

        res.status(201).json({ success: true, message: 'Pendaftaran berhasil! Tim kami akan segera menghubungi Anda untuk proses selanjutnya.', customerId: newId });

    } catch (error) {
        await connection.rollback();
        console.error('[Public API] Error saat pendaftaran pelanggan:', error);
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
             return res.status(400).json({ success: false, message: 'Paket yang dipilih tidak valid.' });
        }
        res.status(500).json({ success: false, message: 'Terjadi kesalahan internal saat pendaftaran.' });
    } finally {
        connection.release();
    }
});

// Endpoint to get available payment channels (publicly accessible)
router.get('/payment-channels', async (req, res) => {
    console.log(`[Public API] /payment-channels endpoint HIT. Timestamp: ${new Date().toISOString()}`);
    try {
        console.log('[Public API] Attempting to fetch channels from Tripay service...');
        const channels = await tripayService.getPaymentChannels();
        console.log(`[Public API] Successfully fetched ${channels.length} channels from Tripay service.`);
        res.json(channels);
    } catch (error) {
        console.error('[Public API] CRITICAL ERROR in /payment-channels endpoint:', error);
        res.status(500).json({ message: error.message || 'Failed to get payment channels.' });
    }
});

// Endpoint for creating payment link from public page
router.post('/create-public-payment', async (req, res) => {
    const { invoiceId, method } = req.body;
    
    console.log(`[Public API DEBUG] Received public payment creation request for Invoice: ${invoiceId}, Method: ${method}`);

    if (!invoiceId || !method) {
        return res.status(400).json({ message: 'Invoice ID and payment method are required.' });
    }

    try {
        const settings = await getSettings();
        // Return URL for public page should always be the public page itself.
        const returnUrl = `${settings.app.baseUrl.replace(/\/$/, '')}/#pay/${invoiceId}`;

        const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
        if (invoice.status === 'Paid') return res.status(400).json({ message: 'This invoice has already been paid.' });

        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [invoice.customerId]);
        if (!customer) return res.status(404).json({ message: 'Customer associated with this invoice not found.' });

        const tripayResponse = await tripayService.createTransaction(invoice, customer, returnUrl, method);

        await pool.query('UPDATE invoices SET tripayReference = ?, paymentUrl = ? WHERE id = ?', [tripayResponse.reference, tripayResponse.checkout_url, invoiceId]);
        
        console.log(`[Public API DEBUG] Successfully created Tripay transaction for Invoice ${invoiceId}. Ref: ${tripayResponse.reference}`);

        res.json({ paymentUrl: tripayResponse.checkout_url, returnUrl });

    } catch (error) {
        console.error(`[Public API DEBUG] Error creating payment transaction for invoice ${invoiceId}:`, error);
        res.status(500).json({ message: error.message || 'An internal server error occurred while creating the payment transaction.' });
    }
});

// GET /api/public/packages - Get list of packages for public registration
router.get('/packages', async (req, res) => {
    try {
        // Change: Removed `WHERE useTax = 1` to ensure all packages are available for new registrations.
        // This resolves an issue where the package list might be empty if no packages are marked as taxable,
        // or if taxable packages are only meant for existing customers.
        const [packages] = await pool.query('SELECT id, name, speed, price FROM packages ORDER BY price ASC');
        res.json(packages);
    } catch (error) {
        console.error('[Public API] Error fetching packages:', error);
        res.status(500).json({ message: 'Gagal mengambil daftar paket.' });
    }
});


export default router;
