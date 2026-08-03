import nodemailer from 'nodemailer';
import {
    replacePlaceholders,
    formatRupiah,
    formatBillingPeriod,
    formatDateDisplay,
} from './utils.js';
import { generateInvoicePdfBuffer } from './invoicePdfService.js';

const normalize = (value) => String(value || '').trim();

const isEmailEnabled = (settings) => Boolean(settings?.email?.enabled);

const resolveSmtpHost = (settings) => normalize(settings?.email?.smtpHost);

const isEmailConfigured = (settings) => {
    const host = resolveSmtpHost(settings);
    const fromEmail = normalize(settings?.email?.fromEmail);
    const port = Number(settings?.email?.smtpPort);
    return Boolean(host && fromEmail && Number.isFinite(port) && port > 0);
};

const buildFromValue = (settings) => {
    const fromName = normalize(settings?.email?.fromName);
    const fromEmail = normalize(settings?.email?.fromEmail);
    if (!fromName) return fromEmail;
    return `"${fromName.replace(/"/g, '\\"')}" <${fromEmail}>`;
};

const buildTransport = (settings) => {
    const host = resolveSmtpHost(settings);
    const port = Number(settings?.email?.smtpPort || 587);
    const secure = Boolean(settings?.email?.smtpSecure);
    const user = normalize(settings?.email?.smtpUser);
    const pass = normalize(settings?.email?.smtpPass);

    const transportConfig = {
        host,
        port,
        secure,
    };

    if (user) {
        transportConfig.auth = { user, pass };
    }

    return nodemailer.createTransport(transportConfig);
};

export const sendInvoiceEmailNotification = async ({
    settings,
    customer,
    invoice,
    packageName = '',
    type = 'due',
    paymentMethod = '',
}) => {
    if (!isEmailEnabled(settings)) {
        return { success: false, skipped: true, reason: 'Email notifications disabled.' };
    }
    if (!isEmailConfigured(settings)) {
        return { success: false, skipped: true, reason: 'Email settings are incomplete.' };
    }

    const targetEmail = normalize(customer?.email);
    if (!targetEmail) {
        return { success: false, skipped: true, reason: 'Customer email is empty.' };
    }

    const billingPeriod = formatBillingPeriod(invoice?.billingPeriodStart, invoice?.billingPeriodEnd);
    const placeholders = {
        customerName: customer?.name || '',
        customerId: customer?.id || '',
        invoiceId: invoice?.id || '',
        amount: formatRupiah(Number(invoice?.amount || 0)),
        dueDate: formatDateDisplay(invoice?.dueDate),
        issueDate: formatDateDisplay(invoice?.issueDate),
        billingPeriod,
        packageName: packageName || 'N/A',
        paymentMethod: paymentMethod || 'Manual',
        status: type === 'paid' ? 'PAID' : 'DUE',
        paymentLink: settings?.app?.baseUrl ? `${settings.app.baseUrl.replace(/\/$/, '')}/#pay/${invoice?.id || ''}` : '',
    };

    const createdSubjectDefault = 'Invoice baru #{{invoiceId}} - {{customerName}}';
    const createdBodyDefault = 'Halo {{customerName}},\n\nInvoice #{{invoiceId}} sebesar {{amount}} untuk paket {{packageName}} (periode {{billingPeriod}}) telah diterbitkan pada {{issueDate}} dan jatuh tempo pada {{dueDate}}.\n\nLink pembayaran: {{paymentLink}}\n\nTerima kasih.';
    const dueSubjectDefault = 'Pengingat jatuh tempo invoice #{{invoiceId}} - {{customerName}}';
    const dueBodyDefault = 'Halo {{customerName}},\n\nInvoice #{{invoiceId}} sebesar {{amount}} untuk paket {{packageName}} (periode {{billingPeriod}}) jatuh tempo pada {{dueDate}}.\n\nLink pembayaran: {{paymentLink}}\n\nTerima kasih.';
    const paidSubjectDefault = 'Pembayaran berhasil invoice #{{invoiceId}} - {{customerName}}';
    const paidBodyDefault = 'Halo {{customerName}},\n\nPembayaran untuk invoice #{{invoiceId}} sebesar {{amount}} telah kami terima melalui {{paymentMethod}}.\n\nTerima kasih.';

    const subjectTemplate = type === 'paid'
        ? (settings?.email?.paidSubject || paidSubjectDefault)
        : type === 'created'
            ? (settings?.email?.createdSubject || createdSubjectDefault)
            : (settings?.email?.dueSubject || dueSubjectDefault);
    const bodyTemplate = type === 'paid'
        ? (settings?.email?.paidBody || paidBodyDefault)
        : type === 'created'
            ? (settings?.email?.createdBody || createdBodyDefault)
            : (settings?.email?.dueBody || dueBodyDefault);

    const subject = replacePlaceholders(subjectTemplate, placeholders);
    const text = replacePlaceholders(bodyTemplate, placeholders);
    const pdfBuffer = await generateInvoicePdfBuffer({
        settings,
        customer,
        invoice,
        packageName,
        notificationType: type,
        paymentMethod,
    });

    const transporter = buildTransport(settings);
    const attachmentPrefix = type === 'paid' ? 'faktur' : 'invoice';
    await transporter.sendMail({
        from: buildFromValue(settings),
        to: targetEmail,
        subject,
        text,
        attachments: [{
            filename: `${attachmentPrefix}-${invoice?.id || Date.now()}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
        }],
    });

    return { success: true };
};

export const sendTestEmail = async ({ settings, to }) => {
    if (!isEmailConfigured(settings)) {
        throw new Error('Email settings are incomplete.');
    }
    const targetEmail = normalize(to);
    if (!targetEmail) {
        throw new Error('Target email is required.');
    }

    const transporter = buildTransport(settings);
    await transporter.sendMail({
        from: buildFromValue(settings),
        to: targetEmail,
        subject: 'Test koneksi Email ISP Billing',
        text: 'Jika Anda menerima email ini, konfigurasi SMTP pada ISP Billing sudah berhasil.',
    });
};
