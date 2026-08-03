import pool from '../db.js';
import { toMySQLDatetime } from '../utils.js';

const STATUS_ALIASES = {
    pending: 'queued',
    queued: 'queued',
    accepted: 'sent',
    sent: 'sent',
    delivered: 'delivered',
    read: 'delivered',
    failed: 'failed',
    error: 'failed',
    rejected: 'failed',
    undelivered: 'failed',
};

let whatsappLogColumnsCache = null;

const normalizeLogStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return STATUS_ALIASES[normalized] || 'queued';
};

const getWhatsAppLogColumns = async () => {
    if (whatsappLogColumnsCache) {
        return whatsappLogColumnsCache;
    }

    const [columns] = await pool.query('SHOW COLUMNS FROM whatsapp_logs');
    whatsappLogColumnsCache = new Set(columns.map((column) => String(column.Field || column.field || '').trim()).filter(Boolean));
    return whatsappLogColumnsCache;
};

const buildWhatsAppLogPayload = async (fields = {}) => {
    const columns = await getWhatsAppLogColumns();
    const payload = {
        recipient_number: String(fields.recipient_number || '').trim(),
        customer_id: fields.customer_id ?? null,
        message_body: String(fields.message_body || ''),
        status: normalizeLogStatus(fields.status),
        type: String(fields.type || 'WhatsApp').trim(),
        error_message: fields.error_message ?? null,
    };

    if (columns.has('provider_message_id')) {
        payload.provider_message_id = fields.provider_message_id ? String(fields.provider_message_id).trim() : null;
    }

    if (columns.has('transport')) {
        payload.transport = fields.transport ? String(fields.transport).trim() : null;
    }

    if (columns.has('sent_at')) {
        payload.sent_at = fields.sent_at || null;
    }

    if (columns.has('delivered_at')) {
        payload.delivered_at = fields.delivered_at || null;
    }

    if (columns.has('updated_at')) {
        payload.updated_at = fields.updated_at || null;
    }

    if (fields.created_at !== undefined) {
        payload.created_at = fields.created_at;
    }

    return payload;
};

export const insertWhatsAppLog = async (fields = {}) => {
    const payload = await buildWhatsAppLogPayload(fields);
    const [result] = await pool.query('INSERT INTO whatsapp_logs SET ?', payload);
    return result.insertId;
};

export const updateWhatsAppLogById = async (logId, fields = {}) => {
    if (!logId) return false;
    const payload = await buildWhatsAppLogPayload({
        recipient_number: fields.recipient_number || '',
        customer_id: fields.customer_id ?? null,
        message_body: fields.message_body || '',
        status: fields.status || 'queued',
        type: fields.type || 'WhatsApp',
        error_message: fields.error_message ?? null,
        provider_message_id: fields.provider_message_id ?? null,
        transport: fields.transport ?? null,
        sent_at: fields.sent_at || null,
        delivered_at: fields.delivered_at || null,
        updated_at: fields.updated_at || null,
    });

    delete payload.recipient_number;
    delete payload.customer_id;
    delete payload.message_body;
    delete payload.type;

    await pool.query('UPDATE whatsapp_logs SET ? WHERE id = ?', [payload, logId]);
    return true;
};

export const updateWhatsAppLogByProviderMessageId = async (providerMessageId, fields = {}) => {
    const normalizedProviderId = String(providerMessageId || '').trim();
    if (!normalizedProviderId) {
        return false;
    }

    const columns = await getWhatsAppLogColumns();
    if (!columns.has('provider_message_id')) {
        return false;
    }

    const payload = await buildWhatsAppLogPayload({
        recipient_number: fields.recipient_number || '',
        customer_id: fields.customer_id ?? null,
        message_body: fields.message_body || '',
        status: fields.status || 'sent',
        type: fields.type || 'WhatsApp',
        error_message: fields.error_message ?? null,
        provider_message_id: normalizedProviderId,
        transport: fields.transport ?? null,
        sent_at: fields.sent_at || null,
        delivered_at: fields.delivered_at || null,
        updated_at: fields.updated_at || null,
    });

    delete payload.recipient_number;
    delete payload.customer_id;
    delete payload.message_body;
    delete payload.type;

    await pool.query('UPDATE whatsapp_logs SET ? WHERE provider_message_id = ?', [payload, normalizedProviderId]);
    return true;
};

export const extractWhatsAppStatusUpdate = (payload = {}) => {
    const candidate = payload?.entry?.[0]?.changes?.[0]?.value || payload?.data || payload || {};
    const statusItem =
        Array.isArray(candidate?.statuses) && candidate.statuses.length > 0 ? candidate.statuses[0]
        : Array.isArray(payload?.statuses) && payload.statuses.length > 0 ? payload.statuses[0]
        : null;

    if (!statusItem) {
        const directStatus = String(candidate?.status || payload?.status || '').trim().toLowerCase();
        const directMessageId = String(candidate?.message_id || candidate?.messageId || candidate?.id || payload?.message_id || payload?.messageId || payload?.id || '').trim();
        if (!directStatus || !directMessageId) {
            return null;
        }

        return {
            providerMessageId: directMessageId,
            status: normalizeLogStatus(directStatus),
            recipientNumber: String(candidate?.recipient_id || candidate?.to || payload?.recipient_id || payload?.to || '').trim() || null,
            raw: payload,
        };
    }

    const providerMessageId = String(
        statusItem.id ||
        statusItem.message_id ||
        statusItem.messageId ||
        statusItem.uuid ||
        ''
    ).trim();

    if (!providerMessageId) {
        return null;
    }

    return {
        providerMessageId,
        status: normalizeLogStatus(statusItem.status || statusItem.delivery_status || ''),
        recipientNumber: String(statusItem.recipient_id || statusItem.to || statusItem.phone_number || '').trim() || null,
        timestamp: statusItem.timestamp ? Number(statusItem.timestamp) : null,
        raw: payload,
    };
};

export const handleWhatsAppStatusWebhook = async (payload = {}, context = {}) => {
    const statusUpdate = extractWhatsAppStatusUpdate(payload);
    if (!statusUpdate) {
        return { handled: false };
    }

    const normalizedStatus = normalizeLogStatus(statusUpdate.status);
    const updateFields = {
        status: normalizedStatus,
        transport: context.transport || null,
        provider_message_id: statusUpdate.providerMessageId,
        updated_at: toMySQLDatetime(new Date(), context.timezone || null),
    };

    if (normalizedStatus === 'sent') {
        updateFields.sent_at = toMySQLDatetime(new Date(), context.timezone || null);
    }

    if (normalizedStatus === 'delivered') {
        updateFields.delivered_at = toMySQLDatetime(new Date(), context.timezone || null);
    }

    await updateWhatsAppLogByProviderMessageId(statusUpdate.providerMessageId, updateFields);
    return {
        handled: true,
        status: normalizedStatus,
        providerMessageId: statusUpdate.providerMessageId,
        recipientNumber: statusUpdate.recipientNumber,
        raw: statusUpdate.raw,
    };
};

export const normalizeWhatsAppLogStatus = normalizeLogStatus;
