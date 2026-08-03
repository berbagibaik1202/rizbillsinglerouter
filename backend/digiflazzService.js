import axios from 'axios';
import crypto from 'crypto';
import './env.js';
import { getSettings } from './utils.js';

const DEFAULT_BASE_URL = 'https://api.digiflazz.com/v1';

const loadCredentials = async () => {
    const settings = await getSettings();
    const fromDb = settings.digiflazz || {};
    const username = (fromDb.username || process.env.DIGIFLAZZ_USERNAME || '').trim();
    const apiKey = (fromDb.apiKey || process.env.DIGIFLAZZ_API_KEY || '').trim();
    const baseUrl = DEFAULT_BASE_URL;

    if (!username || !apiKey) {
        throw new Error('Kredensial Digiflazz belum dikonfigurasi di Settings.');
    }

    return { username, apiKey, baseUrl };
};

const generateSignature = (apiKey, username, refId) => {
    const signString = `${username}${apiKey}${refId}`;
    return crypto.createHash('md5').update(signString).digest('hex');
};

export const getProductList = async (cmd = 'prepaid') => {
    const { username, apiKey, baseUrl } = await loadCredentials();
    const refId = `pricelist-${Date.now()}-${cmd}`;
    const signature = generateSignature(apiKey, username, refId);

    const payload = {
        cmd,
        username,
        sign: signature,
    };

    try {
        console.log('Fetching Digiflazz product list...');
        const response = await axios.post(`${baseUrl}/price-list`, payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        console.log('Successfully fetched Digiflazz product list.');
        return response.data;
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error fetching Digiflazz product list:', errorMessage);
        throw new Error(`Failed to fetch product list from Digiflazz: ${errorMessage}`);
    }
};

export const createTransaction = async (buyerSkuCode, customerNo, refId, command) => {
    const { username, apiKey, baseUrl } = await loadCredentials();
    const signature = generateSignature(apiKey, username, refId);

    const payload = {
        username,
        buyer_sku_code: buyerSkuCode,
        customer_no: customerNo,
        ref_id: refId,
        sign: signature,
    };

    if (command) {
        payload.commands = command;
    }

    try {
        console.log(`Creating Digiflazz transaction with ref_id: ${refId}`);
        const response = await axios.post(`${baseUrl}/transaction`, payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        console.log(`Successfully created Digiflazz transaction with ref_id: ${refId}`);
        return response.data;
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`Error creating Digiflazz transaction with ref_id: ${refId}:`, errorMessage);
        throw new Error(`Failed to create Digiflazz transaction: ${errorMessage}`);
    }
};

export const checkBill = async (buyerSkuCode, customerNo, amount) => {
    const { username, apiKey, baseUrl } = await loadCredentials();
    const refId = `inq-${Date.now()}`;
    const signature = generateSignature(apiKey, username, refId);

    const payload = {
        commands: 'inq-pasca',
        username,
        buyer_sku_code: buyerSkuCode,
        customer_no: customerNo,
        ref_id: refId,
        sign: signature,
    };
    if (amount !== undefined && amount !== null) {
        payload.amount = amount;
    }

    try {
        console.log(`Checking Digiflazz bill with ref_id: ${refId}`);
        const response = await axios.post(`${baseUrl}/transaction`, payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        console.log(`Successfully checked Digiflazz bill with ref_id: ${refId}`);
        return response.data;
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`Error checking Digiflazz bill with ref_id: ${refId}:`, errorMessage);
        throw new Error(`Failed to check Digiflazz bill: ${errorMessage}`);
    }
};
// Cek status transaksi Digiflazz berdasarkan ref_id
export const checkStatus = async (refId, buyerSkuCode, customerNo, isPostpaid = false) => {
    const { username, apiKey, baseUrl } = await loadCredentials();
    const payload = {
        username,
        buyer_sku_code: buyerSkuCode,
        customer_no: customerNo,
        ref_id: refId,
        sign: generateSignature(apiKey, username, refId),
    };

    if (isPostpaid) {
        payload.commands = 'status-pasca';
    }
    
    try {
        // Menurut dokumentasi, cek status prabayar dilakukan dengan mengirim ulang permintaan asli.
        // Cek status pascabayar menggunakan command 'status-pasca'.
        // Keduanya menggunakan endpoint /transaction.
        const response = await axios.post(`${baseUrl}/transaction`, payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        return response.data;
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`Error checking Digiflazz status for ${refId}:`, errorMessage);
        throw new Error(`Failed to check transaction status: ${errorMessage}`);
    }
};

// Inquiry PLN prabayar untuk mendapatkan nama pelanggan
export const inquiryPlnPrepaid = async (customerNo) => {
    const { username, apiKey, baseUrl } = await loadCredentials();
    const signature = crypto.createHash('md5').update(`${username}${apiKey}${customerNo}`).digest('hex');
    const payload = {
        customer_no: customerNo,
        username,
        sign: signature,
    };
    try {
        const response = await axios.post(`${baseUrl}/inquiry-pln`, payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        return response.data;
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error inquiry PLN prepaid:', errorMessage);
        throw new Error(`Failed to inquiry PLN prepaid: ${errorMessage}`);
    }
};
// Ambil saldo admin Digiflazz
export const checkBalance = async () => {
    const { username, apiKey, baseUrl } = await loadCredentials();
    // Sesuai dokumentasi Digiflazz: cmd=deposit, sign = md5(username + apiKey + "depo")
    // Beberapa akun memakai kata kunci "deposit". Kita coba beberapa varian untuk menghindari RC 41 (signature salah).
    const cmd = 'deposit';
    const tokens = [
        (process.env.DIGIFLAZZ_BALANCE_TOKEN || 'depo').trim(),
    ];
    if (!tokens.includes('depo')) tokens.push('depo');
    if (!tokens.includes('deposit')) tokens.push('deposit');
    const variants = [];
    for (const token of tokens) {
        const base = `${username}${apiKey}${token}`;
        variants.push({ token, sign: crypto.createHash('md5').update(base).digest('hex') });
        // Jaga-jaga jika ada kasus campuran huruf
        const upper = token.toUpperCase();
        const lower = token.toLowerCase();
        if (upper !== token) variants.push({ token, sign: crypto.createHash('md5').update(`${username}${apiKey}${upper}`).digest('hex') });
        if (lower !== token) variants.push({ token, sign: crypto.createHash('md5').update(`${username}${apiKey}${lower}`).digest('hex') });
    }

    let lastErr = null;
    for (const { token, sign } of variants) {
        const payload = { cmd, username, sign };
        try {
            const response = await axios.post(`${baseUrl}/cek-saldo`, payload, {
                headers: { 'Content-Type': 'application/json' },
            });
            const rc = response?.data?.rc ?? response?.data?.data?.rc;
            const msg = response?.data?.message ?? response?.data?.data?.message ?? '';
            if (rc === '41' && String(msg).toLowerCase().includes('signature')) {
                lastErr = `Signature rejected with token "${token}"`;
                continue;
            }
            return response.data;
        } catch (error) {
            const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            lastErr = errorMessage;
            if (!String(errorMessage).toLowerCase().includes('signature')) break;
        }
    }

    const errorMessage = lastErr || 'Unknown error';
    console.error('Error fetching Digiflazz balance:', errorMessage);
    throw new Error(`Failed to fetch Digiflazz balance: ${errorMessage}`);
};

export const createDeposit = async (amount, bank, ownerName) => {
    const { username, apiKey, baseUrl } = await loadCredentials();
    // Sesuai dokumentasi deposit, signature-nya adalah md5(username + apiKey + "deposit")
    const signature = crypto.createHash('md5').update(`${username}${apiKey}deposit`).digest('hex');

    const payload = {
        username,
        amount: Number(amount),
        Bank: bank,
        owner_name: ownerName,
        sign: signature,
    };

    try {
        console.log('Creating Digiflazz deposit ticket with payload:', { ...payload, sign: '***' });
        const response = await axios.post(`${baseUrl}/deposit`, payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        console.log('Successfully created Digiflazz deposit ticket.');
        return response.data;
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error creating Digiflazz deposit ticket:', errorMessage);
        throw new Error(`Failed to create Digiflazz deposit ticket: ${errorMessage}`);
    }
};

// Export default object untuk kemudahan impor
export default {
    getProductList,
    createTransaction,
    checkBill,
    checkBalance,
    checkStatus,
    createDeposit,
};
