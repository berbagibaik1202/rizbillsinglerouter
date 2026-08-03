// whatsappService.js (Robust, Multi-Device Ready Implementation)
import path from 'path';
import os from 'os';
import fsp from 'fs/promises';
import fs from 'fs';
import qrcode from 'qrcode';
import { fileURLToPath } from 'url';
import { Boom } from '@hapi/boom';

// --- Start WhatsApp Session Directory Validation ---
// Added to prevent crashes from invalid/unwritable WA_SESSION_BASE_DIR in .env
const sessionBaseDir = process.env.WA_SESSION_BASE_DIR;
if (sessionBaseDir) {
    try {
        const resolvedPath = path.resolve(sessionBaseDir);

        if (sessionBaseDir.trim() === '/') {
            throw new Error('Using the root directory ("/") for WA_SESSION_BASE_DIR is not allowed for security reasons.');
        }
        
        fs.mkdirSync(resolvedPath, { recursive: true });
        fs.accessSync(resolvedPath, fs.constants.W_OK);

    } catch (err) {
        throw new Error(
            `[Fatal] Invalid or non-writable WA_SESSION_BASE_DIR: "${sessionBaseDir}". ` +
            `Please ensure this directory exists and is writable by the application. Underlying error: ${err.message}`
        );
    }
}
// --- End WhatsApp Session Directory Validation ---

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';
let connectedUser = null;
let reconnectAttempts = 0;
let heartbeatFailures = 0;
let standbyEnabled = false;
let baileysConnectArmed = false;
let runtimeSettings = {
  whatsapp: {
    deliveryMode: 'baileys',
    customGateway: {
      apiKey: '',
      timeoutMs: 20000,
    },
    fonnteGateway: {
      apiKey: '',
      countryCode: '0',
      timeoutMs: 20000,
      preview: false,
      typing: false,
    },
  },
};
const KIRIMDEV_BASE_URL = 'https://api.kirimdev.com';
const kirimdevPhoneNumberCache = new Map();
const FONNTE_BASE_URL = 'https://api.fonnte.com';
// This handler will be injected from cronJobs.js to handle incoming messages
let messageHandler = () => console.warn('[WhatsApp] Message handler has not been initialized.');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_DIR = (() => {
  if (process.env.WA_SESSION_DIR) {
    return path.resolve(process.env.WA_SESSION_DIR);
  }

  const sessionRoot = process.env.WA_SESSION_BASE_DIR
    ? path.resolve(process.env.WA_SESSION_BASE_DIR)
    : path.join(os.homedir(), 'whatsapp_sessions');

  const rawNamespace = process.env.WA_SESSION_NAMESPACE
    || process.env.APP_SUBDOMAIN
    || process.env.SUBDOMAIN
    || process.env.HOSTNAME
    || path.basename(process.cwd());

  const safeNamespace = String(rawNamespace || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return path.join(sessionRoot, safeNamespace || 'default');
})();
let heartbeatInterval = null; // To store the interval ID

// Define a list of User-Agents to rotate through
const userAgents = [
    ['Windows', 'Chrome', '112.0.5615.138'],
    ['Windows', 'Firefox', '112.0'],
    ['Mac OS X', 'Safari', '16.4.1'],
    ['Mac OS X', 'Chrome', '112.0.5615.137'],
    ['Windows', 'Edge', '112.0.1722.58'],
];

/** Format phone number to 62... */
const formatPhoneNumber = (number) => {
  let cleaned = ('' + number).replace(/\D/g, '');
  if (cleaned.startsWith('62')) {
    return cleaned;
  }
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
};

const extractMessageBody = (messageContent) => (
  messageContent?.conversation ||
  messageContent?.extendedTextMessage?.text ||
  messageContent?.ephemeralMessage?.message?.conversation ||
  messageContent?.ephemeralMessage?.message?.extendedTextMessage?.text ||
  messageContent?.editedMessage?.message?.protocolMessage?.editedMessage?.conversation ||
  messageContent?.imageMessage?.caption ||
  messageContent?.videoMessage?.caption ||
  messageContent?.documentMessage?.caption ||
  messageContent?.buttonsResponseMessage?.selectedDisplayText ||
  messageContent?.listResponseMessage?.title ||
  messageContent?.templateButtonReplyMessage?.selectedDisplayText ||
  ''
);

const normalizeCustomGatewayConfig = (gateway = {}) => ({
  apiKey: String(gateway.apiKey || '').trim(),
  timeoutMs: Math.max(1000, Number(gateway.timeoutMs ?? 20000)),
  phoneNumberId: String(gateway.phoneNumberId || '').trim(),
  outsideWindowTemplateName: String(gateway.outsideWindowTemplateName || '').trim(),
  outsideWindowTemplateLanguage: String(gateway.outsideWindowTemplateLanguage || 'id').trim() || 'id',
});

const normalizeFonnteGatewayConfig = (gateway = {}) => ({
  apiKey: String(gateway.apiKey || '').trim(),
  countryCode: String(gateway.countryCode ?? '0').trim() || '0',
  timeoutMs: Math.max(1000, Number(gateway.timeoutMs ?? 20000)),
  preview: Boolean(gateway.preview),
  typing: Boolean(gateway.typing),
});

const normalizeDeliveryMode = (value) => {
  const mode = String(value || 'baileys').toLowerCase();
  if (mode === 'kirimdev') return 'custom';
  if (mode === 'wa') return 'fonnte';
  if (mode === 'baileys' || mode === 'custom' || mode === 'fonnte') {
    return mode;
  }
  return 'baileys';
};

const formatFonnteTarget = (phoneNumber, countryCode = '0') => {
  const cleaned = formatPhoneNumber(phoneNumber);
  const normalizedCountryCode = String(countryCode || '0').trim();

  if (!cleaned) {
    return '';
  }

  if (!normalizedCountryCode || normalizedCountryCode === '0') {
    return cleaned;
  }

  if (cleaned.startsWith(normalizedCountryCode)) {
    return cleaned.slice(normalizedCountryCode.length);
  }

  if (normalizedCountryCode === '62' && cleaned.startsWith('0')) {
    return cleaned.slice(1);
  }

  return cleaned;
};

const buildKirimdevPayload = (gateway, phoneNumber, message) => ({
  messaging_product: 'whatsapp',
  to: formatPhoneNumber(phoneNumber),
  type: 'text',
  text: {
    body: message,
  },
  recipient_type: 'individual',
});

const buildKirimdevTemplatePayload = (phoneNumber, templateName, templateLanguage, message) => ({
  messaging_product: 'whatsapp',
  to: formatPhoneNumber(phoneNumber),
  type: 'template',
  template: {
    name: templateName,
    language: templateLanguage || 'id',
    components: [
      {
        type: 'body',
        parameters: [
          {
            type: 'text',
            text: message,
          },
        ],
      },
    ],
  },
});

const normalizeResponseText = async (response) => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const extractKirimdevFailureDetails = (responseData, responseText, statusCode = null) => {
  const errorObject = typeof responseData === 'object' && responseData !== null
    ? (responseData.error || responseData)
    : null;

  const providerCode = Number(
    errorObject?.provider_code
    ?? errorObject?.providerCode
    ?? responseData?.provider_code
    ?? responseData?.providerCode
  );

  const errorCode = String(
    errorObject?.code
    || responseData?.code
    || errorObject?.error_code
    || responseData?.error_code
    || ''
  ).trim();

  const message = String(
    errorObject?.message
    || responseData?.message
    || responseText
    || 'Failed to send WhatsApp message.'
  ).trim();

  return {
    error: message,
    errorCode: errorCode || null,
    providerCode: Number.isFinite(providerCode) ? providerCode : null,
    statusCode: Number.isFinite(Number(statusCode)) ? Number(statusCode) : null,
    rawResponse: typeof responseData === 'object' ? responseData : null,
  };
};

const isOutside24hWindowFailure = (result = {}) => {
  const normalizedCode = String(result.errorCode || '').toLowerCase();
  const normalizedMessage = String(result.error || '').toLowerCase();
  const providerCode = Number(result.providerCode);

  return (
    normalizedCode === 'outside_24h_window'
    || providerCode === 131047
    || normalizedMessage.includes('outside_24h_window')
    || normalizedMessage.includes('131047')
    || normalizedMessage.includes('outside the 24-hour')
  );
};

const normalizeKirimdevCollection = (payload) => {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  return [];
};

const clampKirimdevLimit = (value, fallback = 100) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Math.min(fallback, 100));
  }

  return Math.max(1, Math.min(Math.trunc(parsed), 100));
};

const kirimdevApiRequest = async (gateway, path, options = {}) => {
  const apiKey = String(gateway?.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('Kirimdev API key is required.');
  }

  const requestUrl = new URL(`${KIRIMDEV_BASE_URL}/v1${path}`);
  const query = options.query || {};
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      requestUrl.searchParams.set(key, String(value));
    }
  });

  const init = {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  };

  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(requestUrl, init);
  const responseText = await normalizeResponseText(response);
  let data = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data?.error?.message
      ? data.error.message
      : responseText;
    throw new Error(`Kirimdev request failed (HTTP ${response.status})${message ? `: ${message}` : ''}`);
  }

  return { response, data };
};

const resolveKirimdevPhoneNumberId = async (gateway) => {
  const apiKey = String(gateway.apiKey || '').trim();
  const cacheKey = `${KIRIMDEV_BASE_URL}|${apiKey}`;

  if (kirimdevPhoneNumberCache.has(cacheKey)) {
    return kirimdevPhoneNumberCache.get(cacheKey);
  }

  const { data } = await kirimdevApiRequest(gateway, '/accounts', {
    query: { status: 'connected' },
  });
  const accounts = normalizeKirimdevCollection(data);

  const selected = accounts.find((account) => String(account?.status || '').toLowerCase() === 'connected')
    || accounts[0]
    || null;

  const phoneNumberId = String(selected?.phone_number_id || '').trim();
  if (!phoneNumberId) {
    throw new Error('No connected Kirimdev WhatsApp account found.');
  }

  kirimdevPhoneNumberCache.set(cacheKey, phoneNumberId);
  return phoneNumberId;
};

const resolveKirimdevConversationContact = (conversation = {}) => {
  const candidate =
    conversation?.contact?.phone_number ||
    conversation?.contact?.phone ||
    conversation?.phone_number ||
    conversation?.phone ||
    conversation?.participant?.phone_number ||
    conversation?.participant?.phone ||
    conversation?.customer?.phone ||
    conversation?.customer?.phone_number ||
    '';

  return formatPhoneNumber(candidate);
};

const normalizeKirimdevConversation = (conversation = {}) => ({
  id: String(conversation?.id || '').trim(),
  name: String(
    conversation?.contact?.name ||
    conversation?.customer?.name ||
    conversation?.name ||
    conversation?.title ||
    conversation?.subject ||
    resolveKirimdevConversationContact(conversation) ||
    'Unknown'
  ).trim(),
  phoneNumber: resolveKirimdevConversationContact(conversation),
  lastMessage: String(
    conversation?.last_message?.content ||
    conversation?.lastMessage?.content ||
    conversation?.last_message?.text?.body ||
    conversation?.last_message?.body ||
    conversation?.lastMessage?.text?.body ||
    conversation?.lastMessage?.body ||
    conversation?.preview ||
    conversation?.snippet ||
    conversation?.last_message_preview ||
    ''
  ).trim(),
  updatedAt: conversation?.updated_at || conversation?.last_message_at || conversation?.last_activity_at || conversation?.created_at || null,
  unreadCount: Number(conversation?.unread_count ?? conversation?.unreadCount ?? 0),
  status: conversation?.status || null,
  raw: conversation,
});

const extractKirimdevMessageText = (message = {}) => {
  const content = message?.content;
  const messageContent = message?.message?.content;

  const text = (
    (typeof content === 'string' ? content : '') ||
    message?.text?.body ||
    message?.body ||
    (content && typeof content === 'object' ? content.text || content.body || content.message || '' : '') ||
    (typeof messageContent === 'string' ? messageContent : '') ||
    (messageContent && typeof messageContent === 'object' ? messageContent.text || messageContent.body || '' : '') ||
    message?.message?.text?.body ||
    message?.message?.body ||
    extractMessageBody(message) ||
    ''
  );

  return String(text).trim();
};

const extractKirimdevMessageNumber = (message = {}, directionHint = '') => {
  const candidates = [
    message?.from,
    message?.sender?.phone_number,
    message?.sender?.phone,
    message?.author?.phone_number,
    message?.to,
    message?.recipient?.phone_number,
    message?.recipient?.phone,
    message?.contact?.phone_number,
    message?.contact?.phone,
  ].filter(Boolean);

  const normalized = candidates.map((candidate) => formatPhoneNumber(candidate)).filter(Boolean);
  if (normalized.length === 0) return '';

  const hint = String(directionHint || message?.direction || message?.type || '').toLowerCase();
  if (hint.includes('in') || hint.includes('recv') || hint.includes('incoming')) {
    return normalized[0];
  }

  if (hint.includes('out') || hint.includes('sent') || hint.includes('outgoing')) {
    return normalized[0];
  }

  return normalized[0];
};

const normalizeKirimdevMessage = (message = {}) => ({
  id: String(message?.id || message?.message_id || message?.uuid || '').trim(),
  conversationId: String(
    message?.conversation_id ||
    message?.conversation?.id ||
    message?.thread_id ||
    message?.chat_id ||
    ''
  ).trim(),
  direction: String(message?.direction || message?.type || '').toLowerCase(),
  from: formatPhoneNumber(message?.from || message?.sender?.phone_number || message?.sender?.phone || message?.author?.phone_number || ''),
  to: formatPhoneNumber(message?.to || message?.recipient?.phone_number || message?.recipient?.phone || ''),
  contactPhone: extractKirimdevMessageNumber(message, message?.direction || message?.type || ''),
  text: extractKirimdevMessageText(message),
  content: typeof message?.content === 'string' ? message.content.trim() : null,
  mediaUrl: message?.media_url || message?.mediaUrl || null,
  status: String(message?.status || message?.delivery_status || '').toLowerCase(),
  createdAt: message?.created_at || message?.sent_at || message?.timestamp || message?.date || null,
  raw: message,
});

const listKirimdevConversations = async (gateway, options = {}) => {
  const phoneNumberId = String(options.phoneNumberId || '').trim() || await resolveKirimdevPhoneNumberId(gateway);
  const { data } = await kirimdevApiRequest(gateway, `/${encodeURIComponent(phoneNumberId)}/conversations`, {
    query: {
      limit: clampKirimdevLimit(options.limit ?? 50, 50),
      cursor: options.cursor,
    },
  });

  const conversations = normalizeKirimdevCollection(data).map(normalizeKirimdevConversation);
  return {
    phoneNumberId,
    conversations,
    meta: {
      hasMore: Boolean(data?.has_more),
      nextCursor: data?.next_cursor || null,
    },
    raw: data,
  };
};

const listKirimdevMessages = async (gateway, options = {}) => {
  const phoneNumberId = String(options.phoneNumberId || '').trim() || await resolveKirimdevPhoneNumberId(gateway);
  const { data } = await kirimdevApiRequest(gateway, `/${encodeURIComponent(phoneNumberId)}/messages`, {
    query: {
      limit: clampKirimdevLimit(options.limit ?? 100, 100),
      cursor: options.cursor,
    },
  });

  const messages = normalizeKirimdevCollection(data).map(normalizeKirimdevMessage);
  return {
    phoneNumberId,
    messages,
    meta: {
      hasMore: Boolean(data?.has_more),
      nextCursor: data?.next_cursor || null,
    },
    raw: data,
  };
};

const fetchKirimdevConversation = async (gateway, conversationId, options = {}) => {
  const phoneNumberId = String(options.phoneNumberId || '').trim() || await resolveKirimdevPhoneNumberId(gateway);
  const { data } = await kirimdevApiRequest(gateway, `/${encodeURIComponent(phoneNumberId)}/conversations/${encodeURIComponent(conversationId)}`);
  return {
    phoneNumberId,
    conversation: normalizeKirimdevConversation(data?.data || data),
    raw: data,
  };
};

const sendViaCustomGatewayPayload = async (gateway, payload) => {
  const timeoutMs = Math.max(1000, Number(gateway.timeoutMs ?? 20000));
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(new Error('Kirimdev timeout')), timeoutMs);

  try {
    const phoneNumberId = String(gateway.phoneNumberId || '').trim() || await resolveKirimdevPhoneNumberId(gateway);
    const requestUrl = `${KIRIMDEV_BASE_URL}/v1/${encodeURIComponent(phoneNumberId)}/messages`;
    const requestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(gateway.apiKey || '').trim()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    };

    const response = await fetch(requestUrl, requestInit);
    const responseText = await normalizeResponseText(response);
    let responseData = null;
    if (responseText) {
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }
    }

    if (!response.ok) {
      return {
        success: false,
        ...extractKirimdevFailureDetails(responseData, responseText, response.status),
      };
    }

    return {
      success: true,
      transport: 'custom',
      providerMessageId: typeof responseData === 'object'
        ? String(responseData?.data?.id || responseData?.id || responseData?.message_id || responseData?.messageId || '').trim() || null
        : null,
      gatewayMessage: typeof responseData === 'object' ? responseData : null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to send message via Kirimdev.';
    return { success: false, error: errorMessage };
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const sendViaCustomGateway = async (phoneNumber, message) => {
  const gateway = normalizeCustomGatewayConfig(runtimeSettings?.whatsapp?.customGateway);
  if (!String(gateway.apiKey || '').trim()) {
    return { success: false, error: 'Kirimdev API key is required.' };
  }

  return sendViaCustomGatewayPayload(gateway, buildKirimdevPayload(gateway, phoneNumber, message));
};

const sendViaCustomGatewayTemplate = async (phoneNumber, message, templateName, templateLanguage) => {
  const gateway = normalizeCustomGatewayConfig(runtimeSettings?.whatsapp?.customGateway);
  if (!String(gateway.apiKey || '').trim()) {
    return { success: false, error: 'Kirimdev API key is required.' };
  }

  const name = String(templateName || gateway.outsideWindowTemplateName || '').trim();
  const language = String(templateLanguage || gateway.outsideWindowTemplateLanguage || 'id').trim() || 'id';
  if (!name) {
    return { success: false, error: 'Kirimdev fallback template is not configured.' };
  }

  const result = await sendViaCustomGatewayPayload(
    gateway,
    buildKirimdevTemplatePayload(phoneNumber, name, language, message),
  );

  if (result.success) {
    return {
      ...result,
      messageKind: 'template',
    };
  }

  return result;
};

const extractFonnteFailureDetails = (responseData, responseText, statusCode = null) => {
  const responseObject = typeof responseData === 'object' && responseData !== null ? responseData : null;
  const message = String(
    responseObject?.reason ||
    responseObject?.detail ||
    responseObject?.message ||
    responseText ||
    'Failed to send WhatsApp message via Fonnte.'
  ).trim();

  return {
    error: message,
    statusCode: Number.isFinite(Number(statusCode)) ? Number(statusCode) : null,
    rawResponse: responseObject,
  };
};

const isFonnteSuccess = (responseData) => {
  const statusValue = responseData?.status ?? responseData?.Status;
  if (typeof statusValue === 'boolean') {
    return statusValue;
  }

  if (typeof statusValue === 'string') {
    return statusValue.toLowerCase() === 'true';
  }

  return Boolean(responseData?.detail || responseData?.id);
};

const buildFonntePayload = (phoneNumber, message, gateway = {}) => {
  const payload = new FormData();
  const target = formatFonnteTarget(phoneNumber, gateway.countryCode);

  payload.append('target', target);
  payload.append('message', String(message || ''));
  payload.append('countryCode', String(gateway.countryCode || '0'));
  payload.append('preview', String(Boolean(gateway.preview)));
  payload.append('typing', String(Boolean(gateway.typing)));

  return payload;
};

const sendViaFonnte = async (phoneNumber, message) => {
  const gateway = normalizeFonnteGatewayConfig(runtimeSettings?.whatsapp?.fonnteGateway);
  if (!String(gateway.apiKey || '').trim()) {
    return { success: false, error: 'Fonnte API key is required.' };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(new Error('Fonnte timeout')), gateway.timeoutMs);

  try {
    const requestBody = buildFonntePayload(phoneNumber, message, gateway);
    const response = await fetch(`${FONNTE_BASE_URL}/send`, {
      method: 'POST',
      headers: {
        Authorization: gateway.apiKey,
        Accept: 'application/json',
      },
      body: requestBody,
      signal: controller.signal,
    });

    const responseText = await normalizeResponseText(response);
    let responseData = null;
    if (responseText) {
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }
    }

    if (!response.ok) {
      return {
        success: false,
        ...extractFonnteFailureDetails(responseData, responseText, response.status),
      };
    }

    if (!isFonnteSuccess(responseData)) {
      return {
        success: false,
        ...extractFonnteFailureDetails(responseData, responseText, response.status),
      };
    }

    const providerMessageId = Array.isArray(responseData?.id)
      ? String(responseData.id[0] || '').trim() || null
      : String(responseData?.id || responseData?.requestid || '').trim() || null;

    return {
      success: true,
      transport: 'fonnte',
      providerMessageId,
      gatewayMessage: typeof responseData === 'object' ? responseData : null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to send message via Fonnte.';
    return { success: false, error: errorMessage };
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const sendViaBaileys = async (phoneNumber, message) => {
  if (standbyEnabled) {
    return { success: false, error: 'WhatsApp Web service is in standby mode.' };
  }

  if (!sock || connectionStatus !== 'connected') {
    const errorMsg = `[WhatsApp] Cannot send message. Connection status: ${connectionStatus}`;
    console.warn(errorMsg);
    return { success: false, error: 'WhatsApp service is not connected.' };
  }
  
  const formattedNumber = formatPhoneNumber(phoneNumber);
  const jid = `${formattedNumber}@s.whatsapp.net`;
  
  try {
    const [result] = await sock.onWhatsApp(jid);

    if (!result || !result.exists) {
        const errorMsg = `[WhatsApp] Cannot send message. Number ${phoneNumber} is not on WhatsApp.`;
        console.warn(errorMsg);
        return { success: false, error: 'Number is not on WhatsApp.' };
    }

    const randomLength = Math.floor(Math.random() * 21) + 20; // 20 to 40 chars
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomSuffix = '';
    for (let i = 0; i < randomLength; i++) {
        randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const messageToSend = `${message}\n\n\n${randomSuffix}`;

    const sendResult = await sock.sendMessage(jid, { text: messageToSend });
    return {
      success: true,
      transport: 'baileys',
      providerMessageId: String(sendResult?.key?.id || sendResult?.messageId || '').trim() || null,
      gatewayMessage: sendResult || null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to send message via baileys.';
    console.error(`[WhatsApp] FAILED sending to ${jid}:`, err);
    return { success: false, error: errorMessage };
  }
};

const resolveTransportOrder = () => {
  const mode = normalizeDeliveryMode(runtimeSettings?.whatsapp?.deliveryMode || 'baileys');
  if (mode === 'fonnte') return ['fonnte'];
  if (mode === 'custom') return ['custom', 'fonnte', 'baileys'];
  return ['baileys', 'fonnte', 'custom'];
};

const applySettings = (settings = {}) => {
  const nextCustomGateway = normalizeCustomGatewayConfig(settings?.whatsapp?.customGateway);
  const nextFonnteGateway = normalizeFonnteGatewayConfig(settings?.whatsapp?.fonnteGateway);
  runtimeSettings = {
    ...runtimeSettings,
    whatsapp: {
      ...runtimeSettings.whatsapp,
      ...(settings?.whatsapp || {}),
      deliveryMode: normalizeDeliveryMode(settings?.whatsapp?.deliveryMode || runtimeSettings?.whatsapp?.deliveryMode),
      customGateway: nextCustomGateway,
      fonnteGateway: nextFonnteGateway,
    },
  };

  standbyEnabled = Boolean(settings?.whatsapp?.standbyEnabled);
  return runtimeSettings;
};

/** 
 * Send a simple message. Returns an object indicating success or failure.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const sendMessage = async (phoneNumber, message) => {
  if (standbyEnabled || process.env.DISABLE_WHATSAPP === 'true') {
    console.warn('[WhatsApp] Cannot send message. Service is in standby mode.');
    return { success: false, error: 'WhatsApp service is in standby mode.' };
  }

  const transportOrder = resolveTransportOrder();
  let lastError = null;

  for (const transport of transportOrder) {
    if (transport === 'fonnte') {
      const gateway = normalizeFonnteGatewayConfig(runtimeSettings?.whatsapp?.fonnteGateway);
      if (!gateway.apiKey) {
        lastError = lastError || 'Fonnte API key is not configured.';
        continue;
      }

      const result = await sendViaFonnte(phoneNumber, message);
      if (result.success) {
        return result;
      }

      lastError = result.error || lastError;
      continue;
    }

    if (transport === 'custom') {
      const gateway = normalizeCustomGatewayConfig(runtimeSettings?.whatsapp?.customGateway);
      if (!gateway.apiKey) {
        lastError = lastError || 'Kirimdev API key is not configured.';
        continue;
      }

      const result = await sendViaCustomGateway(phoneNumber, message);
      if (result.success) {
        return result;
      }

      if (isOutside24hWindowFailure(result)) {
        const fallbackTemplateName = String(gateway.outsideWindowTemplateName || '').trim();
        if (fallbackTemplateName) {
          console.warn(`[WhatsApp] Kirimdev rejected free-form message outside 24h window. Falling back to template "${fallbackTemplateName}".`);
          const templateResult = await sendViaCustomGatewayTemplate(
            phoneNumber,
            message,
            fallbackTemplateName,
            gateway.outsideWindowTemplateLanguage || 'id',
          );

          if (templateResult.success) {
            return {
              ...templateResult,
              fallbackUsed: true,
              fallbackReason: 'outside_24h_window',
              messageKind: 'template',
            };
          }

          lastError = templateResult.error || result.error || lastError;
          continue;
        }
      }

      lastError = result.error || lastError;
      continue;
    }

    if (transport === 'baileys') {
      if (standbyEnabled) {
        lastError = lastError || 'WhatsApp Web service is in standby mode.';
        continue;
      }

      if (!sock || connectionStatus !== 'connected') {
        lastError = lastError || 'WhatsApp service is not connected.';
        continue;
      }

      const result = await sendViaBaileys(phoneNumber, message);
      if (result.success) {
        return result;
      }

      lastError = result.error || lastError;
    }
  }

  return {
    success: false,
    error: lastError || 'No WhatsApp transport is available.',
  };
};


/**
 * The main function to initialize and manage the WhatsApp connection.
 * @param {Function} handler - The function to handle incoming messages.
 */
const connectToWhatsApp = async (handler) => {
    const mode = normalizeDeliveryMode(runtimeSettings?.whatsapp?.deliveryMode || 'baileys');
    if (mode !== 'baileys') {
        connectionStatus = 'standby';
        qrCode = null;
        connectedUser = null;
        console.warn('[WhatsApp] Non-Baileys mode is active. Skipping WhatsApp Web connection.');
        return;
    }

    if (standbyEnabled || process.env.DISABLE_WHATSAPP === 'true') {
        connectionStatus = 'standby';
        qrCode = null;
        connectedUser = null;
        console.warn('[WhatsApp] Standby is enabled. Skipping connection.');
        return;
    }
    // Reconnection Strategy Constants
    const MAX_RECONNECT_ATTEMPTS = 10;
    const BASE_DELAY_MS = 5000; // Start with 5 seconds
    const MAX_DELAY_MS = 300000; // Max delay of 5 minutes
    const JITTER_FACTOR = 0.5; // Use 50% jitter

    // Store the injected handler so it can be used in reconnects
    if(typeof handler === 'function') {
        messageHandler = handler;
    }

    try {
        const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = await import('@whiskeysockets/baileys');
        
        await fsp.mkdir(SESSION_DIR, { recursive: true });
        
        console.log('[WhatsApp] Starting new connection attempt...');
        connectionStatus = 'connecting';
        
        // Clear any lingering heartbeat before setting up new listeners
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        const { version } = await fetchLatestBaileysVersion();

        if (sock) {
            try { sock.ev.removeAllListeners(); } catch {}
            try { sock.ws.close(); } catch {}
            sock = null;
        }

        // Randomly select a user agent
        const selectedUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        console.log(`[WhatsApp] Using User-Agent: ${selectedUserAgent.join(' ')}`);

        sock = makeWASocket({
            auth: state,
            version,
            printQRInTerminal: false,
            browser: selectedUserAgent, // Use the randomly selected user agent
            syncFullHistory: false,
        });

        sock.ev.on('creds.update', saveCreds);

        const handleConnectionUpdate = async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrCode = await qrcode.toDataURL(qr);
                connectionStatus = 'qr';
                console.log('[WhatsApp] QR code generated. Please scan to connect.');
            }

            if (connection === 'open') {
                connectionStatus = 'connected';
                connectedUser = sock.user;
                qrCode = null;
                reconnectAttempts = 0; // Reset attempts on successful connection
                heartbeatFailures = 0;
                console.log(`[WhatsApp] Connection successful. Connected as ${sock.user?.name || 'Unknown'}`);

                if (heartbeatInterval) clearInterval(heartbeatInterval);
                console.log('[WhatsApp] Starting connection heartbeat (every 45 seconds).');
                heartbeatInterval = setInterval(() => {
                    if (sock && connectionStatus === 'connected') {
                        const heartbeatTimeout = 15000;
                        Promise.race([
                            sock.sendPresenceUpdate('available'),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Heartbeat timeout')), heartbeatTimeout)
                            )
                        ]).then(() => {
                            heartbeatFailures = 0;
                        }).catch(err => {
                            heartbeatFailures += 1;
                            console.error(`[WhatsApp Heartbeat] Heartbeat failed (${heartbeatFailures}): ${err.message}`);
                            if (heartbeatFailures >= 3) {
                                console.error('[WhatsApp Heartbeat] Consecutive failures reached. Forcing reconnection...');
                                sock?.end(new Boom('Heartbeat Failure', { statusCode: DisconnectReason.connectionLost }));
                            }
                        });
                    }
                }, 45000);
            }

            if (connection === 'close') {
                if (heartbeatInterval) {
                    clearInterval(heartbeatInterval);
                    heartbeatInterval = null;
                    console.log('[WhatsApp] Heartbeat stopped.');
                }

                connectionStatus = 'disconnected';
                connectedUser = null;
                qrCode = null;
                heartbeatFailures = 0;

                const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output.statusCode : 500;
                console.error(`[WhatsApp] Connection closed. Full details:`, lastDisconnect);

                if (standbyEnabled || process.env.DISABLE_WHATSAPP === 'true') {
                    connectionStatus = 'standby';
                    console.warn('[WhatsApp] Standby is enabled. Reconnect skipped.');
                    return;
                }

                let shouldReconnect = 
                    statusCode !== DisconnectReason.loggedOut &&
                    statusCode !== DisconnectReason.connectionReplaced;
                
                let reason = `(Code: ${statusCode})`;
                if (statusCode === DisconnectReason.loggedOut) reason = 'Logged Out';
                if (statusCode === DisconnectReason.connectionReplaced) reason = 'Connection Replaced';
                if (statusCode === DisconnectReason.connectionLost) reason = 'Connection Lost';
                if (statusCode === DisconnectReason.timedOut) reason = 'Connection Timed Out';
                
                console.error(`[WhatsApp] Disconnect reason: ${reason}.`);

                if (shouldReconnect) {
                    reconnectAttempts++;
                    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
                        console.warn(`[WhatsApp] Exceeded max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}). Resetting session.`);
                        shouldReconnect = false; // Stop trying to reconnect
                    }
                }

                if (shouldReconnect) {
                    // Exponential backoff with jitter
                    let backoffDelay = BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1);
                    const jitter = backoffDelay * JITTER_FACTOR * (Math.random() - 0.5); // Add/subtract up to 25% of the delay
                    backoffDelay += jitter;
                    const finalDelay = Math.min(backoffDelay, MAX_DELAY_MS);
                    
                    console.log(`[WhatsApp] Reconnection attempt #${reconnectAttempts}. Retrying in ~${Math.round(finalDelay / 1000)} seconds...`);
                    setTimeout(() => connectToWhatsApp(messageHandler), finalDelay);
                } else {
                    console.log('[WhatsApp] Permanent disconnection or max retries reached. Clearing session data for a fresh start...');
                    reconnectAttempts = 0; // Reset attempts for the next manual/automatic restart
                    try {
                        sock?.ev.removeAllListeners();
                        await fsp.rm(SESSION_DIR, { recursive: true, force: true });
                        console.log('[WhatsApp] Session directory cleared.');
                    } catch (e) {
                        if (e.code !== 'ENOENT') {
                          console.error('[WhatsApp] Failed to clear session directory:', e);
                        }
                    }
                    console.log('[WhatsApp] Restarting connection to generate new QR code...');
                    setTimeout(() => connectToWhatsApp(messageHandler), 5000); // Wait 5s before generating a new QR
                }
            }
        };

        sock.ev.on('connection.update', handleConnectionUpdate);

        sock.ev.on('messages.upsert', async (m) => {
            if (m.type && m.type !== 'notify') {
                return;
            }
            if (!Array.isArray(m.messages)) {
                return;
            }
            for (const msg of m.messages) {
                try {
                    // 1. Basic validation: Skip own messages and messages without a key or remoteJid
                    if (!msg.key || msg.key.fromMe || !msg.key.remoteJid) {
                        continue;
                    }
        
                    const remoteJid = msg.key.remoteJid;

                    // 2. Filtering: Ignore group chats and status updates to only process 1-on-1 user chats.
                    if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
                        continue;
                    }
                    
                    // 3. At this point, remoteJid is guaranteed to be the sender's JID.
                    const senderJid = remoteJid;
                    // Use the same formatter as sendMessage to ensure consistency.
                    // This handles cases where JID might not start with a country code (though rare)
                    // and ensures the number passed to the handler is always in '62...' format.                    
                    // IMPORTANT: If addressingMode is 'lid', use remoteJidAlt for the real number.
                    const fromJid = msg.key.addressingMode === 'lid' && msg.key.remoteJidAlt ? msg.key.remoteJidAlt : senderJid;
                    const from = formatPhoneNumber(fromJid.split('@')[0]);
                    
                    // 4. Extract message body from various possible locations

                    const messageContent = msg.message;
                    const body = extractMessageBody(messageContent);
        
                    // 5. Skip empty or unsupported messages
                    if (!body.trim()) {
                        continue;
                    }
        
                    // 6. Process the valid message
                    // console.log(`[WhatsApp] Received message from ${from}: "${body}"`);
                    if (typeof sock.readMessages === 'function') {
                        try {
                            await sock.readMessages([msg.key]);
                        } catch (readErr) {
                            console.warn('[WhatsApp] Failed to mark message as read:', readErr?.message || readErr);
                        }
                    }
                    
                    if (typeof messageHandler === 'function') {
                        await messageHandler({ from, body });
                    } else {
                        console.error(`[WhatsApp] CRITICAL: messageHandler is not a function! Cannot process message from ${from}.`);
                    }
        
                } catch (err) {
                    console.error('[WhatsApp] CRITICAL: Unhandled error in `messages.upsert` loop. The bot will continue processing other messages. Error:', err);
                    console.error('[WhatsApp] Failed message object:', JSON.stringify(msg, null, 2));
                }
            }
        });

    } catch (err) {
        console.error('[WhatsApp] Critical error during initialization:', err);
        console.log('[WhatsApp] Retrying initialization after 30 seconds due to critical error...');
        setTimeout(() => connectToWhatsApp(messageHandler), 30000);
    }
};

const getStatus = () => ({
    status: (standbyEnabled || process.env.DISABLE_WHATSAPP === 'true' || normalizeDeliveryMode(runtimeSettings?.whatsapp?.deliveryMode || 'baileys') !== 'baileys')
      ? 'standby'
      : connectionStatus,
    user: (standbyEnabled || process.env.DISABLE_WHATSAPP === 'true' || normalizeDeliveryMode(runtimeSettings?.whatsapp?.deliveryMode || 'baileys') !== 'baileys') ? null : connectedUser,
    providerMode: normalizeDeliveryMode(runtimeSettings?.whatsapp?.deliveryMode || 'baileys'),
    customGatewayEnabled: Boolean(runtimeSettings?.whatsapp?.customGateway?.apiKey),
    fonnteEnabled: Boolean(runtimeSettings?.whatsapp?.fonnteGateway?.apiKey),
    baileysConnectArmed,
});
const getQrCode = () => ({ qr: qrCode });

const logout = async () => {
    if (sock) {
        console.log('[WhatsApp] User requested logout.');
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
            console.log('[WhatsApp] Heartbeat stopped due to logout.');
        }
        await sock.logout();
        sock = null;
    }
    connectionStatus = (standbyEnabled || process.env.DISABLE_WHATSAPP === 'true') ? 'standby' : 'disconnected';
    connectedUser = null;
    qrCode = null;
    baileysConnectArmed = false;
};

const setStandby = async (enabled) => {
    const forcedStandby = process.env.DISABLE_WHATSAPP === 'true';
    const nextValue = forcedStandby ? true : Boolean(enabled);
    if (standbyEnabled === nextValue && !(nextValue && sock)) {
        return;
    }
    standbyEnabled = nextValue;

    if (standbyEnabled) {
        console.warn('[WhatsApp] Standby enabled. Disconnecting active session...');
        baileysConnectArmed = false;
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        heartbeatFailures = 0;
        qrCode = null;
        connectedUser = null;
        connectionStatus = 'standby';
        try {
            if (sock) {
                try { sock.end(); } catch {}
            }
        } finally {
            sock = null;
        }
        return;
    }

    console.log('[WhatsApp] Standby disabled. Waiting for manual Baileys connection request...');
    connectionStatus = 'disconnected';
    qrCode = null;
    connectedUser = null;
};

const requestBaileysConnection = async (handler = messageHandler) => {
    if (typeof handler === 'function') {
        messageHandler = handler;
    }

    const mode = normalizeDeliveryMode(runtimeSettings?.whatsapp?.deliveryMode || 'baileys');
    if (mode !== 'baileys') {
        return { mode, connected: false, armed: false };
    }

    baileysConnectArmed = true;
    standbyEnabled = false;
    connectionStatus = 'disconnected';
    qrCode = null;
    connectedUser = null;

    return ensureInboundTransport(handler);
};

const ensureInboundTransport = async (handler = messageHandler) => {
    if (typeof handler === 'function') {
        messageHandler = handler;
    }

    const mode = normalizeDeliveryMode(runtimeSettings?.whatsapp?.deliveryMode || 'baileys');
    const forcedStandby = process.env.DISABLE_WHATSAPP === 'true';

    if (forcedStandby || standbyEnabled || mode !== 'baileys') {
        if (sock) {
            try {
                await logout();
            } catch (err) {
                console.warn('[WhatsApp] Failed to disconnect Baileys while switching to standby mode:', err?.message || err);
            }
        }
        connectionStatus = 'standby';
        qrCode = null;
        connectedUser = null;
        return { mode: 'standby', connected: false };
    }

    if (connectionStatus === 'connected' || connectionStatus === 'connecting' || connectionStatus === 'qr') {
        return { mode: 'baileys', connected: connectionStatus === 'connected' };
    }

    if (!baileysConnectArmed) {
        connectionStatus = 'disconnected';
        qrCode = null;
        connectedUser = null;
        return { mode: 'baileys', connected: false, armed: false };
    }

    await connectToWhatsApp(messageHandler);
    return { mode: 'baileys', connected: true };
};

export default {
  connectToWhatsApp,
  sendMessage,
  sendTemplateMessage: sendViaCustomGatewayTemplate,
  applySettings,
  getStatus,
  getQrCode,
  logout,
  setStandby,
  requestBaileysConnection,
  ensureInboundTransport,
  resolveKirimdevPhoneNumberId,
  listKirimdevConversations,
  listKirimdevMessages,
  fetchKirimdevConversation,
};
