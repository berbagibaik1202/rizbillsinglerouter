import pool from './db.js';

const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Jakarta';

export const defaultSettings = {
    mikrotik: {
        host: '',
        user: '',
        password: '',
        port: 8728,
    },
    tripay: {
        apiKey: '',
        privateKey: '',
        merchantCode: '',
        sandboxMode: true,
        enabledMethods: [],
    },
    digiflazz: {
        username: '',
        apiKey: '',
        sandboxMode: false,
    },
    gemini: {
        apiKey: '',
        model: '',
        enabled: false,
    },
    video: {
        enabled: false,
        title: 'Video',
        playlistUrl: '',
        playlistText: '',
        posterUrl: '',
        description: '',
        autoplay: false,
        loop: false,
        controls: true,
    },
    olt: {
        devices: [],
    },
    billing: {
        taxRate: 0,
        dueDays: 10,
        fixedBillDueDays: 3,
        fixedInvoiceLeadDays: 10,
        generationDay: 1,
        suspensionDays: 3,
        suspensionProfileName: '',
        whatsappNotificationsEnabled: false,
        reminderDaysBeforeDue: 3,
        sendInvoiceOnCreate: false,
        bonusVoucherProfile: '',
        bonusVoucherPrefix: 'bonus-',
        bonusVoucherPackageIds: [],
    },
    app: {
        baseUrl: '',
        appName: '',
        appLogoUrl: '',
        companyPhone: '',
        companyAddress: '',
        customerIdPrefix: '310890',
        apiKey: '',
        timezone: DEFAULT_TIMEZONE,
    },
    otp: {
        enabled: false,
        whatsappTemplate: 'Your OTP code for ISP Billing Pro is: {{otpCode}}. This code expires in 5 minutes.',
    },
    whatsapp: {
        invoiceCreated: '',
        invoiceReminder: '',
        paymentSuccess:
            'Salam, Kak *{{customerName}}*\n\n' +
            'Pembayaran Invoice dengan rincian:\n' +
            'Nama: *{{customerName}}*\n' +
            'Id Pelanggan: {{customerId}}\n' +
            'Layanan: *{{packageName}}*\n' +
            'Periode: {{billingPeriod}}\n' +
            'Invoice: #{{invoiceId}}\n' +
            'Total: *{{amount}}*\n' +
            'Status: *PAID | LUNAS* via *{{paymentMethod}}*\n\n' +
            'Terimakasih sudah menggunakan layanan kami,\n' +
            'Selamat menikmati koneksi internet tanpa batas!\n\n' +
            'Salam Rizkitech By Lintas Jaringan Nusantara',
        suspensionWarning: '',
        adminPhoneNumber: '',
        newComplaintNotification: '',
        accountSuspended: '',
        accountReactivated: '',
        accountDeactivated: '',
        resellerBalanceAdded: '',
        technicianTaskAssignment:
            'TUGAS BARU DITERIMA\n\n' +
            'Halo {{technicianName}},\n\n' +
            'Anda telah ditugaskan untuk menangani keluhan baru:\n\n' +
            'Tiket: #{{ticketId}}\n' +
            'Pelanggan: {{customerName}}\n' +
            'Alamat: {{customerAddress}}\n' +
            'Keluhan: {{complaintType}}\n\n' +
            'Deskripsi:\n' +
            '"{{complaintDescription}}"\n\n' +
            'Silakan periksa dasbor teknisi Anda untuk detail lebih lanjut dan untuk memulai tugas. Terima kasih.',
        packageChanged:
            'PERUBAHAN PAKET BERHASIL\n\n' +
            'Yth. Bapak/Ibu {{customerName}},\n\n' +
            'Sesuai permintaan Anda, paket internet Anda telah berhasil diubah ke *{{newPackageName}}*.\n\n' +
            'Perubahan ini aktif mulai hari ini dan tagihan Anda berikutnya akan disesuaikan dengan harga paket baru.\n\n' +
            'Terima kasih.',
        chatbotEnabled: false,
        affiliateTopupSuccess: '',
        broadcastGeneral: '',
        broadcastOutage: '',
        customGateway: {
            apiKey: '',
            timeoutMs: 20000,
            outsideWindowTemplateName: '',
            outsideWindowTemplateLanguage: 'id',
        },
    },
    email: {
        enabled: false,
        smtpHost: '',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: '',
        smtpPass: '',
        fromName: '',
        fromEmail: '',
        createdSubject: '',
        dueSubject: '',
        paidSubject: '',
        createdText: '',
        dueText: '',
        paidText: '',
        testSubject: 'Test Email',
        testText: 'Email configuration looks good.',
    },
    acs: {
        apiUrl: '',
        username: '',
        password: '',
    },
};

export const parseLocalDateString = (value) => {
    if (!value) return null;
    const normalized = String(value).length === 10 ? `${value}T00:00:00` : value;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const addMonthsKeepDay = (sourceDate, deltaMonths) => {
    if (!sourceDate) return null;
    const date = new Date(sourceDate);
    const targetDay = date.getDate();
    const next = new Date(date);
    next.setDate(1);
    next.setMonth(next.getMonth() + deltaMonths);
    const daysInTargetMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(targetDay, daysInTargetMonth));
    return next;
};

const normalizeBillingType = (value) => String(value || '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'postpaid';

const normalizeTripayEnabledMethods = (value) => {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim().toUpperCase())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean);
            }
        } catch {
            // Fallback to comma-separated list.
        }

        return trimmed
            .split(',')
            .map((item) => String(item || '').trim().toUpperCase())
            .filter(Boolean);
    }

    return [];
};

const deepMerge = (base, override) => {
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
        return { ...base };
    }

    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const baseValue = base?.[key];
        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            baseValue &&
            typeof baseValue === 'object' &&
            !Array.isArray(baseValue)
        ) {
            result[key] = deepMerge(baseValue, value);
        } else {
            result[key] = value;
        }
    }
    return result;
};

const normalizeSettings = (dbSettings = {}) => {
    const normalizedTripay = {
        ...defaultSettings.tripay,
        ...(dbSettings.tripay || {}),
        apiKey: String(dbSettings.tripay?.apiKey || '').trim(),
        privateKey: String(dbSettings.tripay?.privateKey || '').trim(),
        merchantCode: String(dbSettings.tripay?.merchantCode || '').trim(),
        sandboxMode: Boolean(dbSettings.tripay?.sandboxMode ?? defaultSettings.tripay.sandboxMode),
        enabledMethods: normalizeTripayEnabledMethods(dbSettings.tripay?.enabledMethods),
    };

    const normalizedWhatsapp = deepMerge(defaultSettings.whatsapp, dbSettings.whatsapp || {});
    normalizedWhatsapp.customGateway = {
        ...defaultSettings.whatsapp.customGateway,
        ...(dbSettings.whatsapp?.customGateway || {}),
        apiKey: String(dbSettings.whatsapp?.customGateway?.apiKey || '').trim(),
        timeoutMs: Number(dbSettings.whatsapp?.customGateway?.timeoutMs ?? defaultSettings.whatsapp.customGateway.timeoutMs),
        outsideWindowTemplateName: String(dbSettings.whatsapp?.customGateway?.outsideWindowTemplateName || '').trim(),
        outsideWindowTemplateLanguage: String(
            dbSettings.whatsapp?.customGateway?.outsideWindowTemplateLanguage ||
                defaultSettings.whatsapp.customGateway.outsideWindowTemplateLanguage,
        ).trim() || defaultSettings.whatsapp.customGateway.outsideWindowTemplateLanguage,
    };

    const normalizedEmail = {
        ...defaultSettings.email,
        ...(dbSettings.email || {}),
        enabled: Boolean(dbSettings.email?.enabled ?? defaultSettings.email.enabled),
        smtpPort: Number(dbSettings.email?.smtpPort ?? defaultSettings.email.smtpPort),
        smtpSecure: Boolean(dbSettings.email?.smtpSecure ?? defaultSettings.email.smtpSecure),
        smtpHost: String(dbSettings.email?.smtpHost || '').trim(),
        smtpUser: String(dbSettings.email?.smtpUser || '').trim(),
        smtpPass: String(dbSettings.email?.smtpPass || ''),
        fromName: String(dbSettings.email?.fromName || '').trim(),
        fromEmail: String(dbSettings.email?.fromEmail || '').trim(),
    };

    return {
        mikrotik: deepMerge(defaultSettings.mikrotik, dbSettings.mikrotik || {}),
        tripay: normalizedTripay,
        digiflazz: deepMerge(defaultSettings.digiflazz, dbSettings.digiflazz || {}),
        gemini: deepMerge(defaultSettings.gemini, dbSettings.gemini || {}),
        video: deepMerge(defaultSettings.video, dbSettings.video || {}),
        olt: deepMerge(defaultSettings.olt, dbSettings.olt || {}),
        billing: deepMerge(defaultSettings.billing, dbSettings.billing || {}),
        app: {
            ...defaultSettings.app,
            ...(dbSettings.app || {}),
            timezone: String(dbSettings.app?.timezone || defaultSettings.app.timezone),
        },
        otp: {
            ...defaultSettings.otp,
            ...(dbSettings.otp || {}),
            enabled: Boolean(dbSettings.otp?.enabled ?? defaultSettings.otp.enabled),
        },
        whatsapp: normalizedWhatsapp,
        email: normalizedEmail,
        acs: deepMerge(defaultSettings.acs, dbSettings.acs || {}),
    };
};

export const getSettings = async (conn) => {
    const querier = conn || pool;

    try {
        const [rows] = await querier.query("SELECT settings_value FROM settings WHERE settings_key = 'main'");
        if (!rows.length || !rows[0]?.settings_value) {
            return defaultSettings;
        }

        let dbSettings = {};
        try {
            const parsed = JSON.parse(rows[0].settings_value);
            if (parsed && typeof parsed === 'object') {
                dbSettings = parsed;
            }
        } catch (error) {
            console.error('Could not parse settings from DB, using defaults. Error:', error);
            return defaultSettings;
        }

        return normalizeSettings(dbSettings);
    } catch (error) {
        console.error('Database error while fetching settings:', error);
        return defaultSettings;
    }
};

export const generateNewCustomerId = (prefix) => {
    const timePart = (Date.now() % 1000).toString().padStart(3, '0');
    const randomPart = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `${prefix}${timePart}${randomPart}`;
};

export const generateNewInvoiceId = () => {
    return `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

export const formatRupiah = (amount) => {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(Number(amount || 0));
};

export const replacePlaceholders = (template, data) => {
    if (!template) return '';
    return String(template).replace(/{{(\w+)}}/g, (_, key) => {
        const value = data?.[key];
        return value === undefined || value === null || value === '' ? `{{${key}}}` : String(value);
    });
};

export const toMySQLDatetime = (date = new Date(), timezone = null) => {
    const targetTimezone = timezone || DEFAULT_TIMEZONE;
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: targetTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '00';
    const hour = get('hour') === '24' ? '00' : get('hour');

    return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
};

export const dateToYMD = (date = new Date(), timezone = null) => {
    const targetTimezone = timezone || DEFAULT_TIMEZONE;
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: targetTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    const parts = formatter.formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
};

export const dbDateTimeToLocalISO = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
    return toMySQLDatetime(date).replace(' ', 'T').slice(0, 16);
};

export const dbDateToISO = (dateString) => {
    if (!dateString) return null;
    try {
        const date = new Date(dateString);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    } catch {
        return null;
    }
};

export const formatDateDisplay = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
};

export const formatBillingPeriod = (start, end) => {
    if (!start || !end) return 'N/A';
    return `${formatDateDisplay(start)} - ${formatDateDisplay(end)}`;
};

export const getCurrentFixedCycleStart = (customer, referenceDate = new Date(), timezone = DEFAULT_TIMEZONE) => {
    const activeDate = parseLocalDateString(customer?.activeDate);
    if (!activeDate) return null;

    const reference = parseLocalDateString(referenceDate) || new Date(referenceDate);
    if (Number.isNaN(reference.getTime())) return null;

    const target = new Date(activeDate);
    target.setHours(0, 0, 0, 0);

    const limit = new Date(reference);
    limit.setHours(0, 0, 0, 0);

    let current = target;
    for (let i = 0; i < 600; i += 1) {
        const next = addMonthsKeepDay(current, 1);
        if (!next || next > limit) {
            break;
        }
        current = next;
    }

    return current;
};

export const calculateBillingDetails = (customer, pkg, settings, targetPeriodStart) => {
    const { taxRate, dueDays, fixedBillDueDays } = settings.billing;
    const price = Number(pkg?.price || 0);
    const timezone = settings?.app?.timezone || DEFAULT_TIMEZONE;
    const isFixedDateBilling = normalizeBillingType(customer?.billing_type) === 'fixed';

    let billingStart;
    let billingEnd;
    let dueDate;

    if (isFixedDateBilling) {
        const now = new Date();
        if (targetPeriodStart) {
            billingStart = parseLocalDateString(targetPeriodStart) || new Date(targetPeriodStart);
        } else if (customer?.nextBillingStart) {
            billingStart = parseLocalDateString(customer.nextBillingStart) || now;
        } else if (customer?.activeDate) {
            billingStart = parseLocalDateString(customer.activeDate) || now;
        } else {
            billingStart = now;
        }

        billingStart = new Date(billingStart);
        billingStart.setHours(0, 0, 0, 0);

        billingEnd = addMonthsKeepDay(billingStart, 1) || new Date(billingStart);
        billingEnd.setDate(billingEnd.getDate() - 1);

        dueDate = new Date(billingEnd);
        dueDate.setDate(dueDate.getDate() + Number(fixedBillDueDays || 3));
    } else {
        if (targetPeriodStart) {
            billingStart = parseLocalDateString(targetPeriodStart) || new Date(targetPeriodStart);
        } else {
            const now = new Date();
            billingStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
        }

        billingEnd = new Date(Date.UTC(billingStart.getUTCFullYear(), billingStart.getUTCMonth() + 1, 0));

        const targetDueDay = Number(dueDays || 10);
        const dueYear = billingStart.getFullYear();
        const dueMonth = billingStart.getMonth() + 1;
        const daysInDueMonth = new Date(dueYear, dueMonth + 1, 0).getDate();
        const actualDueDay = Math.min(targetDueDay, daysInDueMonth);

        dueDate = new Date(dueYear, dueMonth, actualDueDay);
    }

    let finalAmount = price;
    let notes = `Monthly invoice for ${pkg?.name || 'package'}`;

    if (!isFixedDateBilling && customer?.activeDate) {
        const activeDateObj = new Date(customer.activeDate);
        if (
            activeDateObj.getUTCFullYear() === billingStart.getUTCFullYear() &&
            activeDateObj.getUTCMonth() === billingStart.getUTCMonth() &&
            activeDateObj.getUTCDate() > 1
        ) {
            const daysInMonth = billingEnd.getUTCDate();
            const activeDay = activeDateObj.getUTCDate();
            const daysActive = daysInMonth - activeDay + 1;
            const proratedPrice = Math.round((price / daysInMonth) * daysActive);
            finalAmount = proratedPrice;
            notes = `Prorated invoice (${daysActive} days) for ${pkg?.name || 'package'}`;
            billingStart = activeDateObj;
        }
    }

    if (pkg?.useTax && Number(taxRate || 0) > 0) {
        finalAmount = Math.round(finalAmount * (1 + Number(taxRate) / 100));
    }

    return {
        amount: finalAmount,
        billingPeriodStart: dateToYMD(billingStart, timezone),
        billingPeriodEnd: dateToYMD(billingEnd, timezone),
        dueDate: dateToYMD(dueDate, timezone),
        notes,
    };
};

export const randomDelay = (minMs, maxMs) => {
    const min = Number(minMs || 0);
    const max = Number(maxMs || min);
    const range = Math.max(0, max - min);
    const delay = min + Math.floor(Math.random() * (range + 1));
    return new Promise((resolve) => setTimeout(resolve, delay));
};

