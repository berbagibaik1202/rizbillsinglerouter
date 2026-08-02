// whatsappService.js (Robust, Multi-Device Ready Implementation)
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import qrcode from 'qrcode';
import { fileURLToPath } from 'url';
import { Boom } from '@hapi/boom';

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';
let connectedUser = null;
let reconnectAttempts = 0;
let heartbeatFailures = 0;
let standbyEnabled = false;
let manualDisconnectRequested = false;
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
    || process.env.APP_INSTANCE_NAME
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
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
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

/** 
 * Send a simple message. Returns an object indicating success or failure.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const sendMessage = async (phoneNumber, message) => {
  if (standbyEnabled || process.env.DISABLE_WHATSAPP === 'true') {
    console.warn('[WhatsApp] Cannot send message. Service is in standby mode.');
    return { success: false, error: 'WhatsApp service is in standby mode.' };
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

    // Append random string to the message to make it unique and more natural
    const randomLength = Math.floor(Math.random() * 21) + 20; // 20 to 40 chars
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomSuffix = '';
    for (let i = 0; i < randomLength; i++) {
        randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Add a few newlines to simulate more human-like behavior
    const messageToSend = `${message}\n\n\n${randomSuffix}`;


    // console.log(`[WhatsApp] SENDING to ${jid}: "${messageToSend}"`);
    await sock.sendMessage(jid, { text: messageToSend });
    // console.log(`[WhatsApp] SUCCESS sending to ${jid}`);
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to send message via baileys.';
    console.error(`[WhatsApp] FAILED sending to ${jid}:`, err);
    return { success: false, error: errorMessage };
  }
};


/**
 * The main function to initialize and manage the WhatsApp connection.
 * @param {Function} handler - The function to handle incoming messages.
 */
const connectToWhatsApp = async (handler) => {
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
    manualDisconnectRequested = false;

    try {
        const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = await import('@whiskeysockets/baileys');
        
        await fs.mkdir(SESSION_DIR, { recursive: true });
        
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

                if (manualDisconnectRequested) {
                    manualDisconnectRequested = false;
                    console.log('[WhatsApp] Manual disconnect completed. Waiting for Connect button.');
                    try {
                        sock?.ev.removeAllListeners();
                        await fs.rm(SESSION_DIR, { recursive: true, force: true });
                        console.log('[WhatsApp] Session directory cleared.');
                    } catch (e) {
                        if (e.code !== 'ENOENT') {
                            console.error('[WhatsApp] Failed to clear session directory:', e);
                        }
                    }
                    return;
                }

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
                        await fs.rm(SESSION_DIR, { recursive: true, force: true });
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
    status: (standbyEnabled || process.env.DISABLE_WHATSAPP === 'true') ? 'standby' : connectionStatus,
    user: (standbyEnabled || process.env.DISABLE_WHATSAPP === 'true') ? null : connectedUser
});
const getQrCode = () => ({ qr: qrCode });

const setMessageHandler = (handler) => {
    if (typeof handler === 'function') {
        messageHandler = handler;
    }
};

const logout = async () => {
    if (sock) {
        console.log('[WhatsApp] User requested logout.');
        manualDisconnectRequested = true;
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
};

const setStandby = async (enabled) => {
    const forcedStandby = process.env.DISABLE_WHATSAPP === 'true';
    const nextValue = forcedStandby ? true : Boolean(enabled);
    if (standbyEnabled === nextValue) {
        return;
    }
    standbyEnabled = nextValue;

    if (standbyEnabled) {
        console.warn('[WhatsApp] Standby enabled. Disconnecting active session...');
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

    console.log('[WhatsApp] Standby disabled. Reconnecting...');
    connectionStatus = 'disconnected';
    setTimeout(() => connectToWhatsApp(messageHandler), 1000);
};

export default {
  connectToWhatsApp,
  sendMessage,
  getStatus,
  getQrCode,
  logout,
  setStandby,
  setMessageHandler,
};
