// backend/tripayService.js

import crypto from 'crypto';
import { getSettings } from './utils.js';

/**
 * Formats a phone number for Tripay API compatibility.
 * Removes non-digits, and ensures it starts with '62'.
 * @param {string} phone - The phone number to format.
 * @returns {string} The formatted phone number.
 */
const formatPhoneNumberForTripay = (phone) => {
    if (!phone) return ''; // Return empty string if no phone number is provided
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    // If it starts with '0', replace with '62'
    if (cleaned.startsWith('0')) {
        return '62' + cleaned.substring(1);
    }
    // If it already starts with '62', it's fine
    if (cleaned.startsWith('62')) {
        return cleaned;
    }
    // Fallback for numbers entered without a leading '0' (e.g., 8123...)
    if (cleaned.length >= 9 && cleaned.length <= 13) {
        return '62' + cleaned;
    }
    return cleaned; // Return the cleaned number if it's an unusual format
};

const normalizeChannelCode = (value) => String(value || '').trim().toUpperCase();


/**
 * Fetches available payment channels from Tripay, filtered by what's enabled in settings.
 * @returns {Promise<Array<object>>}
 */
const getPaymentChannels = async () => {
    const settings = await getSettings();
    const { apiKey, privateKey, merchantCode, sandboxMode } = settings.tripay;
    const enabledMethods = Array.isArray(settings.tripay?.enabledMethods)
        ? settings.tripay.enabledMethods.map(normalizeChannelCode).filter(Boolean)
        : [];
    
    if (!apiKey || !privateKey || !merchantCode) {
        console.error('[Tripay Service] ABORTING: Service is not fully configured. Cannot fetch payment channels.');
        // FIX: Throw an error instead of returning an empty array to make failures explicit.
        throw new Error('Tripay service is not fully configured.');
    }

    const apiUrl = sandboxMode
        ? 'https://tripay.co.id/api-sandbox/merchant/payment-channel'
        : 'https://tripay.co.id/api/merchant/payment-channel';

    try {
        const response = await fetch(apiUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[Tripay Service] Tripay API returned a non-OK status: ${response.status} ${response.statusText}`);
            console.error('[Tripay Service] Tripay API response body:', errorBody);
            throw new Error(`Tripay API Error: ${response.statusText}. Check server logs for response body.`);
        }

        const data = await response.json();

        if (!data.success) {
            console.error("[Tripay Service] Tripay API Error (getPaymentChannels):", data.message);
            throw new Error(data.message || 'Failed to fetch payment channels.');
        }
        
        if (!Array.isArray(data.data)) {
            console.error("[Tripay Service] Tripay API returned unexpected data format. 'data' is not an array.");
            return [];
        }

        if (!enabledMethods || enabledMethods.length === 0) {
            return data.data;
        }

        const enabledMethodsSet = new Set(enabledMethods);
        const filteredChannels = data.data.filter((channel) => enabledMethodsSet.has(normalizeChannelCode(channel.code)));
        return filteredChannels;

    } catch (error) {
        console.error("[Tripay Service] CRITICAL ERROR fetching Tripay payment channels:", error);
        throw error;
    }
};

/**
 * Creates a new transaction with Tripay.
 * @param {object} invoice - The invoice object.
 * @param {object} customer - The customer object.
 * @param {string} returnUrl - The URL to redirect to after payment.
 * @param {string} [method] - The specific payment method code (e.g., 'QRIS'). If omitted, an Open Payment is created.
 * @returns {Promise<object>} The response data from Tripay.
 */
const createTransaction = async (invoice, customer, returnUrl, method) => {
    const settings = await getSettings();
    const { tripay: tripaySettings, app: appSettings } = settings;
    const enabledMethods = Array.isArray(tripaySettings?.enabledMethods)
        ? tripaySettings.enabledMethods.map(normalizeChannelCode).filter(Boolean)
        : [];

    if (!tripaySettings.apiKey || !tripaySettings.privateKey || !tripaySettings.merchantCode) {
        throw new Error("Tripay payment gateway is not fully configured in the settings.");
    }
    if (!appSettings.baseUrl) {
        throw new Error("Application Base URL is not configured in the settings.");
    }

    const apiUrl = tripaySettings.sandboxMode 
        ? 'https://tripay.co.id/api-sandbox/transaction/create'
        : 'https://tripay.co.id/api/transaction/create';
    
    const merchantRef = invoice.id;
    const amount = Math.round(invoice.amount);
    
    const dataToSign = `${tripaySettings.merchantCode}${merchantRef}${amount}`;

    const signature = crypto.createHmac('sha256', tripaySettings.privateKey)
                            .update(dataToSign)
                            .digest('hex');
                            
    const sanitizedCustomerName = (customer.name || 'Customer').replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 100);
    const customerEmail = (customer.email && customer.email.includes('@')) 
        ? customer.email 
        : `customer-${customer.id}@yourdomain.com`;
    const customerPhone = formatPhoneNumberForTripay(customer.phone);
    
    const isTopUp = merchantRef.startsWith('TOPUP-');
    const itemName = isTopUp ? `Top Up Saldo Afiliasi` : `Tagihan Internet - ${sanitizedCustomerName}`;
    const itemSku = isTopUp ? `TOPUP-${customer.id}` : `INV-${customer.packageId || 'NA'}`;

    const payload = {
        merchant_ref: merchantRef,
        amount: amount,
        customer_name: sanitizedCustomerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        order_items: [{
            sku: itemSku,
            name: itemName.substring(0, 100),
            price: amount,
            quantity: 1,
        }],
        return_url: returnUrl,
        callback_url: `${appSettings.baseUrl.replace(/\/$/, '')}/api/billing/tripay-callback`,
        expired_time: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours expiry
        signature: signature
    };
    
    // Jika sebuah metode disediakan, itu adalah pembayaran tertutup. Jika tidak, lemparkan error.
    if (method) {
        payload.method = normalizeChannelCode(method);
    } else {
        // Ini memberlakukan pembayaran tertutup di seluruh aplikasi.
        throw new Error("Metode pembayaran diperlukan. Pembayaran terbuka dinonaktifkan.");
    }
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tripaySettings.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[Tripay Service] Tripay API returned a non-OK status on createTransaction: ${response.status} ${response.statusText}`);
        console.error('[Tripay Service] Tripay API response body:', errorBody);
        throw new Error(`Tripay API Error on createTransaction: ${response.statusText}. Check server logs for response body.`);
    }

    const data = await response.json();
    
    if (!data.success) {
        console.error("Tripay API Error (createTransaction):", data);
        throw new Error(`Tripay Error: ${data.message || 'Unknown error from payment gateway.'}`);
    }

    return data.data;
};

/**
 * Verifies the signature of an incoming callback from Tripay.
 * @param {Buffer} rawBody - The raw request body buffer from the callback.
 * @param {string} signature - The signature from the 'x-callback-signature' header.
 * @param {string} privateKey - The Tripay private key from settings.
 * @returns {boolean} True if the signature is valid.
 */
const verifySignature = (rawBody, signature, privateKey) => {
    const calculatedSignature = crypto.createHmac('sha256', privateKey)
                                       .update(rawBody)
                                       .digest('hex');
    return signature === calculatedSignature;
};


export default { createTransaction, verifySignature, getPaymentChannels };
