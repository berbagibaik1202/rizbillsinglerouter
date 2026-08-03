
import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { getSettings, formatRupiah, formatDateDisplay, formatBillingPeriod } from '../utils.js';
import pool from '../db.js';
import { getCustomerDeviceDetails, rebootCustomerDevice, updateCustomerWlan } from '../services.js';
import conversationManager from '../whatsappConversationManager.js';
import whatsappService from '../whatsappService.js';
import { Boom } from '@hapi/boom';

const router = express.Router();

const RATE_LIMIT_INDICATORS = [/too many requests/i, /quota exceeded/i, /resource_exhausted/i, /429/];

const formatGeminiQuotaWarning = (contextDescription, retryDelay) => {
  const waitMessage = retryDelay ? `Coba lagi dalam ${retryDelay}.` : 'Coba lagi nanti.';
  return `Maaf, layanan chatbot ${contextDescription} sedang penuh sementara karena kuota Gemini habis. ${waitMessage} ðŸ˜Š`;
};

const extractRetryDelayFromError = (error) => {
  if (!error) return null;
  const details = error?.details || error?.error?.details;
  if (Array.isArray(details)) {
    const retryInfo = details.find(detail => typeof detail === 'object' && detail?.['@type']?.includes('RetryInfo'));
    if (retryInfo?.retryDelay) return retryInfo.retryDelay;
  }

  try {
    const payload = JSON.stringify(error);
    const match = payload.match(/"retryDelay":"([^"]+)"/i);
    if (match) return match[1];
  } catch (e) {
    // Ignored; fallback to null.
  }

  return null;
};

const isRateLimitError = (error) => {
  if (!error) return false;
  const statusCode = Number(error.status || error.statusCode || error.code);
  if (!Number.isNaN(statusCode) && statusCode === 429) return true;

  const message = String(error?.message || error?.error?.message || '');
  if (RATE_LIMIT_INDICATORS.some(regex => regex.test(message))) return true;

  try {
    const serialized = JSON.stringify(error);
    return RATE_LIMIT_INDICATORS.some(regex => regex.test(serialized));
  } catch (e) {
    return false;
  }
};

const formatRateLimitWarning = (contextDescription, retryDelay, detail) => {
  const waitMessage = retryDelay ? ` dalam ${retryDelay}` : ' nanti';
  const detailSuffix = detail ? ` (${detail})` : '';
  return `Maaf, layanan chatbot ${contextDescription} sedang mengalami gangguan karena batas kuota API terlampaui${detailSuffix}. Silakan coba lagi${waitMessage}. 😊`;
};

// --- Function Declarations for Customer-Facing Chatbot ---
const rebootDeviceFunction = {
  name: 'reboot_device',
  description: 'Mulai ulang (restart/reboot) perangkat modem atau router internet milik pelanggan jika mereka memintanya secara eksplisit.',
  parameters: { type: Type.OBJECT, properties: {} } // No parameters needed
};

const changeWifiNameFunction = {
    name: 'change_wifi_name',
    description: 'Mengubah nama jaringan Wi-Fi (SSID) milik pelanggan.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            new_ssid: {
                type: Type.STRING,
                description: 'Nama Wi-Fi baru yang diinginkan pelanggan.'
            }
        },
        required: ['new_ssid']
    }
};

const changeWifiPasswordFunction = {
    name: 'change_wifi_password',
    description: 'Mengubah kata sandi atau password jaringan Wi-Fi milik pelanggan.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            new_password: {
                type: Type.STRING,
                description: 'Kata sandi Wi-Fi baru yang diinginkan pelanggan.'
            }
        },
        required: ['new_password']
    }
};

const checkWifiFunction = {
  name: 'check_wifi',
  description: 'Memeriksa nama Wi-Fi (SSID) dan menampilkan daftar perangkat yang terhubung ke jaringan Wi-Fi utama milik pelanggan. Gunakan fungsi ini jika pengguna bertanya "cek wifi", "apa nama wifi saya", "siapa saja yang pakai wifi saya", atau pertanyaan serupa.',
  parameters: { type: Type.OBJECT, properties: {} } // No parameters needed
};

const getBillingStatusFunction = {
    name: 'get_billing_status',
    description: 'Memeriksa status tagihan pelanggan saat ini, termasuk jumlah, tanggal jatuh tempo, dan link pembayaran jika ada tagihan yang belum lunas.',
    parameters: { type: Type.OBJECT, properties: {} } // No parameters needed
};

// --- Function Declarations for Admin-Facing Chatbot ---
const adminRebootDeviceFunction = {
    name: 'admin_reboot_device',
    description: 'Mulai ulang (restart/reboot) perangkat modem milik pelanggan tertentu berdasarkan ID Pelanggan.',
    parameters: {
        type: Type.OBJECT,
        properties: { customerId: { type: Type.STRING, description: 'ID Pelanggan yang perangkatnya akan direboot.' } },
        required: ['customerId']
    }
};

const adminChangeWifiNameFunction = {
    name: 'admin_change_wifi_name',
    description: 'Mengubah nama jaringan Wi-Fi (SSID) milik pelanggan tertentu.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            customerId: { type: Type.STRING, description: 'ID Pelanggan yang nama Wi-Fi-nya akan diubah.' },
            new_ssid: { type: Type.STRING, description: 'Nama Wi-Fi baru yang diinginkan.' }
        },
        required: ['customerId', 'new_ssid']
    }
};

const adminChangeWifiPasswordFunction = {
    name: 'admin_change_wifi_password',
    description: 'Mengubah kata sandi atau password jaringan Wi-Fi milik pelanggan tertentu.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            customerId: { type: Type.STRING, description: 'ID Pelanggan yang kata sandi Wi-Fi-nya akan diubah.' },
            new_password: { type: Type.STRING, description: 'Kata sandi Wi-Fi baru yang diinginkan.' }
        },
        required: ['customerId', 'new_password']
    }
};

const adminCheckWifiFunction = {
    name: 'admin_check_wifi',
    description: 'Memeriksa nama Wi-Fi (SSID) dan daftar perangkat yang terhubung ke jaringan Wi-Fi utama milik pelanggan tertentu.',
    parameters: {
        type: Type.OBJECT,
        properties: { customerId: { type: Type.STRING, description: 'ID Pelanggan yang perangkat Wi-Fi-nya akan diperiksa.' } },
        required: ['customerId']
    }
};


/**
 * Mengambil konteks yang relevan untuk pengguna, dengan grounding cerdas.
 * @param {string} customerId - ID pelanggan.
 * @param {string} message - Pesan dari pengguna untuk mendeteksi niat.
 * @returns {Promise<string>} Konteks dalam format JSON string.
 */
const getCustomerContext = async (customerId, message) => {
    let customer = null;
    try {
        const [[customerResult]] = await pool.query('SELECT id, name, status, activeDate, acsSerialNumber FROM customers WHERE id = ?', [customerId]);
        if (!customerResult) {
            return JSON.stringify({ error: 'Customer data not found.', customer: { id: customerId } });
        }
        customer = customerResult;

        const [invoices] = await pool.query('SELECT id, amount, status, dueDate, billingPeriodStart, billingPeriodEnd FROM invoices WHERE customerId = ? ORDER BY issueDate DESC LIMIT 5', [customerId]);
        const [[pkg]] = await pool.query('SELECT p.name, p.speed, p.price FROM packages p JOIN customers c ON p.id = c.packageId WHERE c.id = ?', [customerId]);

        const baseContext = {
            customer: { id: customer.id, name: customer.name, status: customer.status, activeDate: customer.activeDate },
            package: pkg || 'N/A',
            recent_invoices: invoices,
        };

        let deviceContext = {};
        const lowerCaseMessage = message.toLowerCase();
        const troubleshootingKeywords = ['internet', 'lambat', 'lemot', 'koneksi', 'jaringan', 'modem', 'router', 'restart', 'reboot', 'sinyal', 'wifi', 'ssid', 'password', 'sandi', 'nama wifi', 'sandi wifi', 'cek wifi', 'gangguan', 'jumlah perangkat'];

        if (customer.acsSerialNumber && troubleshootingKeywords.some(kw => lowerCaseMessage.includes(kw))) {
           // console.log(`[Chatbot] Detected troubleshooting/action intent for customer ${customerId}. Fetching device status...`);
            try {
                const deviceDetails = await getCustomerDeviceDetails(customerId);
                if (deviceDetails) {
                    deviceContext = { 
                        device_status: {
                            isOnline: deviceDetails.isOnline,
                            model: deviceDetails.model,
                            rxPower: deviceDetails.rxPower,
                            current_wifi_name: deviceDetails.wlanConfigs?.[0]?.ssid || 'N/A',
                        },
                        _internal_paths: {
                            wlanConfigs: deviceDetails.wlanConfigs
                        }
                    };
                }
            } catch (e) {
                //console.error(`[Chatbot] Error fetching device context for customer ${customerId}:`, e);
                // Tambahkan galat ke konteks alih-alih menggagalkan seluruhnya
                deviceContext = { device_status_error: 'Tidak dapat mengambil detail perangkat saat ini.' };
            }
        }
        
        return JSON.stringify({ ...baseContext, ...deviceContext }, null, 2);

    } catch (error) {
        //console.error(`Error fetching context for customer ${customerId}:`, error);
        // FIX: Selalu kembalikan string JSON yang valid, bahkan saat terjadi galat, untuk mencegah crash pada JSON.parse().
        return JSON.stringify({
            error: 'Gagal mengambil data pelanggan lengkap.',
            customer: { id: customerId, name: customer?.name || 'Unknown' } // Berikan info dasar jika tersedia
        });
    }
};

router.post('/chat', async (req, res) => {
    const { message, user, role } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }
    
    try {
        const settings = await getSettings();
        const apiKey = settings.gemini?.apiKey;

        if (!apiKey) {
            console.error('[Chatbot] Gemini API key is not configured in the database settings.');
            return res.status(503).json({ error: 'AI chatbot is not configured by the administrator.' });
        }
        
        const genAI = new GoogleGenAI({apiKey});

        let context = '';
        let systemInstruction = '';
        let toolsConfig = [];

        if (role === 'customer' && user?.id) {
            context = await getCustomerContext(user.id, message);
            toolsConfig = [{ functionDeclarations: [rebootDeviceFunction, changeWifiNameFunction, changeWifiPasswordFunction, checkWifiFunction, getBillingStatusFunction] }];
            systemInstruction = `Anda adalah asisten AI yang ramah dan membantu untuk ISP bernama '${settings.app.appName || 'perusahaan kami'}'.
Nama Anda 'RizkitechBill AI'.
Anda harus menjawab pertanyaan HANYA berdasarkan konteks yang diberikan di bawah ini.
Anda HARUS SELALU mengakhiri setiap balasan dengan emoji senyum 😊.

- Jika pengguna mengeluh tentang internet lambat, masalah koneksi, atau gangguan jaringan ('lambat', 'lemot', 'gangguan', 'koneksi jelek'):
  1. Pertama, Anda HARUS meminta maaf atas ketidaknyamanannya.
  2. Kemudian, periksa 'device_status.rxPower' dari konteks.
  3. Jika 'rxPower' tersedia dan nilainya bukan 'N/A', ambil angka numeriknya (misal dari "-22.5 dBm" menjadi -22.5). Jika nilainya lebih besar dari -25, beri tahu mereka: "Sinyal optik Anda saat ini ${context.device_status?.rxPower}, yang seharusnya aman 😊."
  4. Jika 'rxPower' tersedia dan nilainya bukan 'N/A', dan angka numeriknya -25 atau kurang, beri tahu mereka: "Sinyal optik Anda saat ini ${context.device_status?.rxPower}, sepertinya ada sedikit kendala pada koneksi kabel Anda 😊."
  5. Jika 'rxPower' tidak tersedia, lewati saja langkah ini.
  6. Setelah memberikan status sinyal, SELALU sarankan untuk me-reboot modem dengan bertanya "Apakah Anda mau saya coba restart modemnya dari sini? 😊".
  7. Jika mereka setuju untuk me-reboot, Anda HARUS memanggil fungsi 'reboot_device'.

- Perubahan pada Wi-Fi (nama/SSID atau kata sandi/password) akan diterapkan ke semua jaringan yang tersedia (misalnya 2.4GHz dan 5GHz).
- PENTING: Saat mengekstrak argumen untuk fungsi, seperti nama Wi-Fi (SSID) baru atau kata sandi baru, Anda TIDAK BOLEH mengubah besar kecilnya huruf. Nilainya harus persis seperti yang diketik pengguna. Contoh: jika pengguna mengatakan "ubah sandi menjadi YB1009", argumennya harus "YB1009", bukan "yb1009".
- Jika informasi tidak ada dalam konteks, katakan "Saya tidak memiliki informasi itu, tetapi saya dapat membantu dengan pertanyaan lain, misalnya cekwifi, gantinamawifi, gantisandi wifi 😊."
- Jika pengguna bertanya tentang tagihan mereka ('tagihan', 'pembayaran', 'sudah bayar?'), Anda HARUS menggunakan fungsi 'get_billing_status'.
- Jika pengguna secara eksplisit meminta untuk me-restart atau me-reboot modem mereka, gunakan fungsi 'reboot_device'.
- Jika pengguna ingin mengubah nama Wi-Fi (SSID) mereka, gunakan fungsi 'change_wifi_name'.
- Jika pengguna ingin mengubah kata sandi/sandi Wi-Fi mereka, gunakan fungsi 'change_wifi_password'.
- Jika pengguna meminta untuk memeriksa perangkat yang terhubung, jumlah perangkat aktif, 'cek wifi', 'apa nama wifi saya', atau 'siapa saja yang pakai wifi', gunakan fungsi 'check_wifi'.
- Jangan mengarang informasi. Jaga jawaban Anda tetap singkat, jelas, dan dalam Bahasa Indonesia.
---
KONTEKS:
${context}
---`;
        } else if (role === 'admin') {
            const customerIdMatch = message.match(/\b([A-Z0-9]{6,12})\b/);
            if (customerIdMatch) {
                context = await getCustomerContext(customerIdMatch[1], message);
            }
            toolsConfig = [{ functionDeclarations: [adminRebootDeviceFunction, adminChangeWifiNameFunction, adminChangeWifiPasswordFunction, adminCheckWifiFunction] }];
            systemInstruction = `Anda adalah asisten AI ahli untuk administrator ISP.
Anda dapat melakukan tindakan atas nama admin untuk pelanggan tertentu.
Anda HARUS SELALU mengakhiri setiap balasan dengan emoji senyum 😊.

- Perubahan pada Wi-Fi (nama/SSID atau kata sandi/password) akan diterapkan ke semua jaringan yang tersedia pada perangkat pelanggan.
- PENTING: Saat mengekstrak argumen untuk fungsi, seperti nama Wi-Fi (SSID) baru atau kata sandi baru, Anda TIDAK BOLEH mengubah besar kecilnya huruf. Nilainya harus persis seperti yang diketik pengguna.
- Untuk melakukan tindakan, Anda HARUS memiliki ID pelanggan. Jika permintaan admin menyiratkan tindakan khusus pelanggan tetapi tidak memberikan ID, Anda HARUS memintanya.
- Alat utama Anda adalah untuk mengelola perangkat pelanggan. Anda dapat me-reboot modem, mengubah nama Wi-Fi (SSID), mengubah kata sandi Wi-Fi, dan memeriksa perangkat yang terhubung.
- Ketika Anda memanggil sebuah fungsi, sistem akan menjalankannya dan memberikan hasilnya. Tugas Anda adalah mengonfirmasi tindakan tersebut kepada admin.
- Jika konteks untuk pelanggan tertentu disediakan di bawah ini, gunakan untuk menjawab pertanyaan secara langsung (misalnya, "Apa nama Wi-Fi untuk pelanggan X?").
- Jika informasi tidak ada dalam konteks dan tidak ada alat yang dapat mengambilnya, sebutkan bahwa Anda tidak memiliki informasi itu.
- Jaga jawaban Anda tetap singkat, langsung, dan dalam Bahasa Indonesia.
---
KONTEKS:
${context || 'Tidak ada konteks pelanggan spesifik yang dimuat. Menunggu prompt dengan ID pelanggan.'}
---`;
        }
        
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('AI assistant timed out after 20 seconds.')), 20000)
        );

        const generateContentPromise = genAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: message,
            config: {
                systemInstruction: systemInstruction,
                tools: toolsConfig.length > 0 ? toolsConfig : undefined,
            },
        });

        const response = await Promise.race([
            generateContentPromise,
            timeoutPromise
        ]);
        
        const functionCall = response.functionCalls?.[0];

        if (functionCall) {
            console.log(`[Chatbot] Gemini requested to call '${functionCall.name}' by ${role} ${user.username || user.name}`);
            try {
                const contextObject = JSON.parse(context || '{}');
                const wlanConfigs = contextObject?._internal_paths?.wlanConfigs;

                switch (functionCall.name) {
                    // --- CUSTOMER FUNCTIONS ---
                    case 'get_billing_status': {
                        const [invoices] = await pool.query("SELECT * FROM invoices WHERE customerId = ? AND status IN ('Unpaid', 'Overdue') ORDER BY issueDate DESC LIMIT 1", [user.id]);
                        const unpaidInvoice = invoices[0];
                        if (unpaidInvoice) {
                            const paymentLink = `${settings.app.baseUrl.replace(/\/$/, '')}/#pay/${unpaidInvoice.id}`;
                            return res.json({ reply: `Tentu, ada tagihan yang perlu dibayar.\n\nInvoice: *#${unpaidInvoice.id}*\nJumlah: *${formatRupiah(unpaidInvoice.amount)}*\nJatuh Tempo: ${formatDateDisplay(unpaidInvoice.dueDate)}\nPeriode: ${formatBillingPeriod(unpaidInvoice.billingPeriodStart, unpaidInvoice.billingPeriodEnd)}\n\nSilakan lakukan pembayaran melalui link berikut:\n${paymentLink} 😊` });
                        } else {
                            return res.json({ reply: 'Semua tagihan Anda sudah lunas. Terima kasih! 😊' });
                        }
                    }
                    case 'reboot_device':
                        await rebootCustomerDevice(user.id);
                        return res.json({ reply: 'Baik, saya telah mengirimkan perintah restart ke modem Anda. Proses ini akan memakan waktu beberapa menit. 😊' });
                    case 'change_wifi_name':
                        const { new_ssid } = functionCall.args;
                        await updateCustomerWlan(user.id, { ssid: new_ssid });
                        return res.json({ reply: `Oke, nama Wi-Fi untuk semua jaringan Anda telah diubah menjadi "${new_ssid}". Perubahan ini mungkin memerlukan beberapa saat. 😊` });
                    case 'change_wifi_password':
                        const { new_password } = functionCall.args;
                        await updateCustomerWlan(user.id, { key: new_password });
                        return res.json({ reply: `Baik, kata sandi Wi-Fi untuk semua jaringan Anda telah diubah. Perangkat Anda mungkin akan restart untuk menerapkan perubahan. 😊` });
                    case 'check_wifi': {
                        const deviceDetails = await getCustomerDeviceDetails(user.id);
                        const wlanConfig = deviceDetails.wlanConfigs?.[0];
                        const devices = wlanConfig?.associatedDevices;
                        const ssid = wlanConfig?.ssid;

                        if (!ssid) {
                            return res.json({ reply: "Maaf, saya tidak dapat mengambil informasi Wi-Fi Anda saat ini. Mungkin perangkat Anda sedang offline. 😊" });
                        }

                        if (!devices || devices.length === 0) {
                            return res.json({ reply: `Nama Wi-Fi Anda saat ini adalah *${ssid}*. Tidak ada perangkat yang terhubung. 😊` });
                        }
                        const deviceList = devices.map((dev, i) => `📱 ${i + 1}. ${dev.hostname || 'Perangkat tidak dikenal'}`).join('\n');
                        return res.json({ reply: `Nama Wi-Fi Anda adalah *${ssid}*. Ada ${devices.length} perangkat yang terhubung:\n${deviceList} 😊` });
                    }
                    
                    // --- ADMIN FUNCTIONS ---
                    case 'admin_reboot_device':
                        await rebootCustomerDevice(functionCall.args.customerId);
                        return res.json({ reply: `Perintah reboot telah dikirim ke modem pelanggan ${functionCall.args.customerId}. 😊` });
                    case 'admin_change_wifi_name':
                        await updateCustomerWlan(functionCall.args.customerId, { ssid: functionCall.args.new_ssid });
                        return res.json({ reply: `Nama Wi-Fi untuk semua jaringan pelanggan ${functionCall.args.customerId} telah diubah menjadi "${functionCall.args.new_ssid}". 😊` });
                    case 'admin_change_wifi_password':
                        await updateCustomerWlan(functionCall.args.customerId, { key: functionCall.args.new_password });
                        return res.json({ reply: `Kata sandi Wi-Fi untuk semua jaringan pelanggan ${functionCall.args.customerId} telah diubah. 😊` });
                    case 'admin_check_wifi': {
                        const checkDetails = await getCustomerDeviceDetails(functionCall.args.customerId);
                        const wlanConfigAdmin = checkDetails.wlanConfigs?.[0];
                        const connectedDevices = wlanConfigAdmin?.associatedDevices;
                        const ssidAdmin = wlanConfigAdmin?.ssid;
                        const customerId = functionCall.args.customerId;

                        if (!ssidAdmin) {
                            return res.json({ reply: `Tidak dapat mengambil informasi Wi-Fi untuk pelanggan ${customerId}. Perangkat mungkin sedang offline. 😊` });
                        }

                        if (!connectedDevices || connectedDevices.length === 0) {
                            return res.json({ reply: `Nama Wi-Fi pelanggan ${customerId} adalah *${ssidAdmin}*. Tidak ada perangkat yang terhubung. 😊` });
                        }
                        const checkedDeviceList = connectedDevices.map((dev, i) => `📱 ${i + 1}. ${dev.hostname || 'Perangkat tidak dikenal'}`).join('\n');
                        return res.json({ reply: `Nama Wi-Fi pelanggan ${customerId} adalah *${ssidAdmin}*. Ada ${connectedDevices.length} perangkat terhubung:\n${checkedDeviceList} 😊` });
                    }
                }
            } catch (actionError) {
                 console.error(`[Chatbot] Failed to execute '${functionCall.name}':`, actionError);
                 return res.json({ reply: `Maaf, terjadi kesalahan saat mencoba melakukan tindakan tersebut: ${actionError.message}. 😊` });
            }
        } else {
            const textReply = response.text;
            if (!textReply) {
                console.warn(`[Chatbot] Gemini returned no text or function call. Response:`, JSON.stringify(response, null, 2));
                res.json({ reply: 'Maaf, saya tidak dapat memproses permintaan Anda saat ini. Silakan coba ulangi dengan kalimat yang berbeda. 😊' });
            } else {
                res.json({ reply: textReply });
            }
        }

    } catch (error) {
        console.error('Gemini API Error:', error);

        const errorMessage = error?.message || '';
        const isApiKeyError = errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API Key not found');
        const retryDelay = extractRetryDelayFromError(error);

        if (isApiKeyError) {
            try {
                await pool.query(
                    `INSERT INTO admin_notifications (type, source, message) VALUES (?, ?, ?)`,
                    ['error', 'Gemini AI', 'Gemini API Key is invalid or has expired. Please update it in the settings.']
                );
            } catch (dbError) {
                console.error('[Chatbot] Failed to save API key error notification to database:', dbError);
            }
            return res.status(503).json({ error: 'AI Service Misconfigured: Invalid API Key.' });
        }
        
        if (isRateLimitError(error)) {
            const friendlyMessage = formatGeminiQuotaWarning('pada server kami', retryDelay);
            return res.status(429).json({ error: friendlyMessage, retryDelay });
        }

        res.status(500).json({ error: 'An error occurred while communicating with the AI assistant.' });
    }
});

// ** START OF MOVED/NEW FUNCTIONS for WhatsApp handling **

/**
 * Handles static (non-AI) commands from WhatsApp.
 * Returns TRUE if the message was handled as a command (executed or replied with help), FALSE otherwise.
 * @param {{from: string, body: string}} message - The message object.
 * @param {boolean} isChatbotEnabled - Whether the AI Chatbot is enabled.
 * @returns {Promise<boolean>}
 */
const handleStaticCommands = async ({ from, body }, customer, isChatbotEnabled) => {
  // Parse command and args. We convert command to lowercase, but KEEP args as is (case-sensitive for passwords).
  const parts = body.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1); // Arguments remain case-sensitive
  
  // List of known static commands to intercept
  const knownCommands = ['reboot', 'gantisandi', 'gantiwifi', 'gantinama', 'cekwifi', 'menu', 'help'];

  if (!knownCommands.includes(command)) {
      return false;
  }

  // Customer object is now passed directly. If it's null, the unified handler already dealt with it.
  // This function now only runs for registered customers.
  console.log(`[Static Command] Processing command "${command}" for customer ${customer.id}`);
  
  const getDeviceDetails = async () => await getCustomerDeviceDetails(customer.id);

  try {
      switch (command) {
        case 'reboot':
          await rebootCustomerDevice(customer.id);
          await whatsappService.sendMessage(from, 'Perangkat Anda sedang direboot. 😊');
          break;
        case 'gantisandi': {
          const newPass = args[0]; // Preserves case sensitivity
          if (!newPass || newPass.length < 8) {
              // If AI is enabled, let the AI handle the natural language response.
              if (isChatbotEnabled) return false; 
              await whatsappService.sendMessage(from, 'Gunakan format: gantisandi <password_baru_minimal_8_karakter>\nContoh: gantisandi Rumahku123 😊');
          } else {
              await updateCustomerWlan(customer.id, { key: newPass });
              await whatsappService.sendMessage(from, `Sandi Wi-Fi untuk semua jaringan Anda telah diubah ke "${newPass}". Perubahan akan diterapkan dalam beberapa saat. 😊`);
          }
          break;
        }
        case 'gantiwifi': // Alias for gantinama
        case 'gantinama': {
          const newSsid = args[0]; // Preserves case sensitivity
          if (!newSsid) {
              // If AI is enabled, let the AI handle the natural language response.
              if (isChatbotEnabled) return false; 
              await whatsappService.sendMessage(from, 'Gunakan format: gantinama <nama_wifi_baru_tanpa_spasi>\nContoh: gantinama RumahRizki 😊');
          } else {
              await updateCustomerWlan(customer.id, { ssid: newSsid });
              await whatsappService.sendMessage(from, `Nama Wi-Fi untuk semua jaringan Anda telah diubah ke "${newSsid}". Perubahan akan diterapkan dalam beberapa saat. 😊`);
          }
          break;
        }
        case 'cekwifi': {
          const checkDetails = await getDeviceDetails();
          const devs = checkDetails.wlanConfigs?.[0]?.associatedDevices;
          if (!devs?.length) {
            await whatsappService.sendMessage(from, 'Tidak ada perangkat yang terhubung saat ini. 😊');
          } else {
            const list = devs.map((d, i) => `📱 ${i + 1}. ${d.hostname || 'Perangkat'} (Sinyal: ${d.signal})`).join('\n');
            await whatsappService.sendMessage(from, `Perangkat terhubung:\n${list} 😊`);
          }
          break;
        }
        case 'menu':
        case 'help':
            await whatsappService.sendMessage(from, 'Perintah yang tersedia:\n\n• `reboot` : Restart modem\n• `gantiwifi <nama_baru>` : Ganti nama WiFi\n• `gantisandi <sandi_baru>` : Ganti password WiFi\n• `cekwifi` : Cek pengguna WiFi\n\nAtau tanyakan langsung ke saya jika AI aktif! 😊');
            break;
      }
  } catch (err) {
      console.error(`[Static Command Error] ${command}:`, err);
      await whatsappService.sendMessage(from, `Gagal memproses perintah: ${err.message} 😊`);
  } 

  return true; // Command handled (successfully or with error feedback)
};


/**
 * Handles incoming WhatsApp messages using the Gemini AI chatbot.
 * @param {{from: string, body: string}} message - The message object.
 */
const handleAiChatbot = async (message, customer) => {
    const { from, body } = message;
    try {
    
    // Normalize phone number to check for '0' vs '62' formats
    let otherFormatPhone = null;
    if (from.startsWith('62')) {
        otherFormatPhone = '0' + from.substring(2);
    } else if (from.startsWith('0')) {
        otherFormatPhone = '62' + from.substring(1);
    }

    // First, check if we're in the middle of a conversation
    const currentState = conversationManager.getConversationState(from);
    if (currentState) {
        // This block needs its own try-catch as it's a distinct flow
        try { // Customer is guaranteed to exist here
            if (currentState.step === 'awaiting_new_password') {
                await updateCustomerWlan(customer.id, { key: body });
                await whatsappService.sendMessage(from, `Siap. Password WiFi untuk semua jaringan Anda telah berhasil diubah menjadi \`${body}\`. Perangkat Anda mungkin akan restart untuk menerapkan perubahan. 😊`);
            } else if (currentState.step === 'awaiting_new_ssid') {
                await updateCustomerWlan(customer.id, { ssid: body });
                await whatsappService.sendMessage(from, `Oke, nama Wi-Fi untuk semua jaringan Anda telah diubah menjadi "${body}". Perubahan ini mungkin memerlukan beberapa saat untuk diterapkan pada perangkat Anda. 😊`);
            }
            conversationManager.clearConversationState(from);
            return;
        } catch (e) {
            console.error(`[Whatsapp Chat] Error in conversation step '${currentState.step}':`, e);
            await whatsappService.sendMessage(from, `Maaf, terjadi kesalahan: ${e.message} 😊`);
            conversationManager.clearConversationState(from);
            return;
        }
    }

    // If not in a conversation, proceed with Gemini. Errors here will bubble up.
    const settings = await getSettings();
    const apiKey = settings.gemini?.apiKey;
    if (!apiKey) {
        await whatsappService.sendMessage(from, 'Maaf, layanan chatbot AI sedang tidak aktif karena terjadi kesalahan di server kami. 😊');
        return;
    }

    const genAI = new GoogleGenAI({apiKey});
    const context = await getCustomerContext(customer.id, body);
    const systemInstruction = `Anda adalah asisten AI yang ramah dan membantu untuk ISP bernama '${settings.app.appName || 'perusahaan kami'}'.
    Nama Anda 'RizkitechBill AI'.
    Anda harus menjawab pertanyaan HANYA berdasarkan konteks yang diberikan di bawah ini.
    Anda HARUS SELALU mengakhiri setiap balasan dengan emoji senyum 😊.

    - Jika pengguna mengeluh tentang internet lambat, masalah koneksi, atau gangguan jaringan ('lambat', 'lemot', 'gangguan', 'koneksi jelek'):
      1. Pertama, Anda HARUS meminta maaf atas ketidaknyamanannya.
      2. Kemudian, periksa 'device_status.rxPower' dari konteks.
      3. Jika 'rxPower' tersedia dan nilainya bukan 'N/A', ambil angka numeriknya (misal dari "-22.5 dBm" menjadi -22.5). Jika nilainya lebih besar dari -25, beri tahu mereka: "Sinyal optik Anda saat ini ${JSON.parse(context).device_status?.rxPower}, yang seharusnya aman 😊."
      4. Jika 'rxPower' tersedia dan nilainya bukan 'N/A', dan angka numeriknya -25 atau kurang, beri tahu mereka: "Sinyal optik Anda saat ini ${JSON.parse(context).device_status?.rxPower}, sepertinya ada sedikit kendala pada koneksi kabel Anda 😊."
      5. Jika 'rxPower' tidak tersedia, lewati saja langkah ini.
      6. Setelah memberikan status sinyal, SELALU sarankan untuk me-reboot modem dengan bertanya "Apakah Anda mau saya coba restart modemnya dari sini? 😊".
      7. Jika mereka setuju untuk me-reboot, Anda HARUS memanggil fungsi 'reboot_device'.

    - Perubahan pada Wi-Fi (nama/SSID atau kata sandi/password) akan diterapkan ke semua jaringan yang tersedia (misalnya 2.4GHz dan 5GHz).
    - PENTING: Saat mengekstrak argumen untuk fungsi, seperti nama Wi-Fi (SSID) baru atau kata sandi baru, Anda TIDAK BOLEH mengubah besar kecilnya huruf. Nilainya harus persis seperti yang diketik pengguna. Contoh: jika pengguna mengatakan "ubah sandi menjadi YB1009", argumennya harus "YB1009", bukan "yb1009".
    - Jika pengguna bertanya tentang tagihan mereka ('tagihan', 'pembayaran', 'sudah bayar?'), Anda HARUS menggunakan fungsi 'get_billing_status'.
    - Jika pengguna meminta untuk mengubah password wifi tapi TIDAK memberikan password baru, Anda HARUS menanyakannya. Balasan Anda HANYA boleh "Tentu. Silakan ketik password baru yang Anda inginkan. 😊".
    - Jika pengguna meminta untuk mengubah nama wifi (SSID) tapi TIDAK memberikan nama baru, Anda HARUS menanyakannya. Balasan Anda HANYA boleh "Tentu. Silakan ketik nama Wi-Fi baru yang Anda inginkan. 😊".
    - Untuk semua permintaan lain untuk mengubah password atau SSID di mana mereka memberikan nilai baru, gunakan pemanggilan fungsi yang sesuai.
    - Jika pengguna secara eksplisit meminta untuk me-restart atau me-reboot modem mereka, gunakan fungsi 'reboot_device'.
    - Jika pengguna meminta untuk memeriksa perangkat yang terhubung, jumlah perangkat aktif, 'cek wifi', 'apa nama wifi saya', atau 'siapa saja yang pakai wifi', gunakan fungsi 'check_wifi'.
    ---
    KONTEKS:
    ${context}
    ---`;
    
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI assistant timed out after 20 seconds.')), 20000)
    );

    const generateContentPromise = genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: body,
        config: {
            systemInstruction,
            tools: [{ functionDeclarations: [rebootDeviceFunction, changeWifiNameFunction, changeWifiPasswordFunction, checkWifiFunction, getBillingStatusFunction] }]
        }
    });

    const response = await Promise.race([
        generateContentPromise,
        timeoutPromise
    ]);

    const functionCall = response.functionCalls?.[0];
    const textResponse = response.text;

    // FIX: Tambahkan blok try...catch khusus untuk eksekusi fungsi agar galat lebih spesifik.
    if (functionCall) {
        console.log(`[Whatsapp Chat] Gemini requested to call '${functionCall.name}' for customer ${customer.id}`);
        try {
            const contextObject = JSON.parse(context);
            const wlanConfigs = contextObject?._internal_paths?.wlanConfigs;
            let replyMessage = '';

            switch (functionCall.name) {
                case 'get_billing_status': {
                    const [invoices] = await pool.query("SELECT * FROM invoices WHERE customerId = ? AND status IN ('Unpaid', 'Overdue') ORDER BY issueDate DESC LIMIT 1", [customer.id]);
                    const unpaidInvoice = invoices[0];
                    if (unpaidInvoice) {
                        const paymentLink = `${settings.app.baseUrl.replace(/\/$/, '')}/#pay/${unpaidInvoice.id}`;
                        replyMessage = `Tentu, ada tagihan yang perlu dibayar.\n\nInvoice: *#${unpaidInvoice.id}*\nJumlah: *${formatRupiah(unpaidInvoice.amount)}*\nJatuh Tempo: ${formatDateDisplay(unpaidInvoice.dueDate)}\nPeriode: ${formatBillingPeriod(unpaidInvoice.billingPeriodStart, unpaidInvoice.billingPeriodEnd)}\n\nSilakan lakukan pembayaran melalui link berikut:\n${paymentLink} 😊`;
                    } else {
                        replyMessage = 'Semua tagihan Anda sudah lunas. Terima kasih! 😊';
                    }
                    break;
                }
                case 'reboot_device':
                    await rebootCustomerDevice(customer.id);
                    replyMessage = 'Baik, perintah untuk me-reboot modem Anda telah berhasil dikirim. Perangkat akan offline selama beberapa menit. Mohon ditunggu. 😊';
                    break;
                case 'change_wifi_name':
                    const { new_ssid } = functionCall.args;
                    await updateCustomerWlan(customer.id, { ssid: new_ssid });
                    replyMessage = `Oke, nama Wi-Fi untuk semua jaringan Anda telah diubah menjadi "${new_ssid}". Perubahan ini mungkin memerlukan beberapa saat. 😊`;
                    break;
                case 'change_wifi_password':
                    const { new_password } = functionCall.args;
                    await updateCustomerWlan(customer.id, { key: new_password });
                    replyMessage = 'Baik, kata sandi Wi-Fi untuk semua jaringan Anda telah diubah. Perangkat Anda mungkin akan restart untuk menerapkan perubahan. 😊';
                    break;
                case 'check_wifi': {
                    const deviceDetails = await getCustomerDeviceDetails(customer.id);
                    const devices = deviceDetails.wlanConfigs?.[0]?.associatedDevices;
                    const ssid = deviceDetails.wlanConfigs?.[0]?.ssid;

                    if (!ssid) {
                        replyMessage = "Maaf, saya tidak dapat mengambil informasi Wi-Fi Anda saat ini. Mungkin perangkat Anda sedang offline. 😊";
                    } else if (!devices || devices.length === 0) {
                        replyMessage = `Nama Wi-Fi Anda saat ini adalah *${ssid}*. Tidak ada perangkat yang terhubung. 😊`;
                    } else {
                        const deviceList = devices.map((dev, i) => `📱 ${i + 1}. ${dev.hostname || 'Perangkat tidak dikenal'}`).join('\n');
                        replyMessage = `Ada ${devices.length} perangkat yang terhubung ke SSID utama Anda:\n${deviceList} 😊`;
                    }
                    break;
                }
            }
            await whatsappService.sendMessage(from, replyMessage);
        } catch (actionError) {
            console.error(`[Whatsapp Chat] Failed to execute '${functionCall.name}' for customer ${customer.id}:`, actionError);
            await whatsappService.sendMessage(from, `Maaf, terjadi kesalahan saat mencoba melakukan tindakan: ${actionError.message}. 😊`);
        }
    } else if (textResponse) {
        // Handle conversational follow-ups
        const contextObject = JSON.parse(context);
        const wlanConfigs = contextObject?._internal_paths?.wlanConfigs;

        if (textResponse.includes('password baru yang Anda inginkan')) {
            conversationManager.setConversationState(from, 'awaiting_new_password', { wlanConfig: wlanConfigs?.[0] });
        } else if (textResponse.includes('nama Wi-Fi baru yang Anda inginkan')) {
            conversationManager.setConversationState(from, 'awaiting_new_ssid', { wlanConfig: wlanConfigs?.[0] });
        }
        await whatsappService.sendMessage(from, textResponse);
    } else {
        // NEW: Handle cases where Gemini returns nothing (e.g., blocked prompt)
        console.warn(`[Whatsapp Chat] Gemini returned no text or function call for customer ${customer.id}. Response:`, JSON.stringify(response, null, 2));
        await whatsappService.sendMessage(from, 'Maaf, saya tidak dapat memproses permintaan Anda saat ini. Silakan coba ulangi dengan kalimat yang berbeda. 😊');
    }
    } catch (error) {
        console.error(`[Whatsapp AI Chat] Error processing message from ${from}:`, error);

        const errorMessage = error?.message || '';
        const isApiKeyError = errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API Key not found');
        const retryDelay = extractRetryDelayFromError(error);

        let replyMessage;

        if (isApiKeyError) {
            replyMessage = 'Maaf, layanan chatbot kami sedang dalam perbaikan. Silakan coba lagi nanti. 😊';
            console.error('[Whatsapp AI Chat] CRITICAL: Gemini API Key is invalid or expired.');
             // Save notification to database
            try {
                await pool.query(
                    `INSERT INTO admin_notifications (type, source, message) VALUES (?, ?, ?)`,
                    ['error', 'Gemini AI', 'Gemini API Key is invalid or has expired. Please update it in the settings.']
                );
            } catch (dbError) {
                console.error('[Chatbot] Failed to save API key error notification to database:', dbError);
            }
        } else if (isRateLimitError(error)) {
            replyMessage = formatGeminiQuotaWarning('di server WhatsApp kami', retryDelay);
        } else {
            replyMessage = `Maaf, layanan chatbot sedang mengalami gangguan. Silakan coba lagi nanti. 😊`;
        }

        try {
            await whatsappService.sendMessage(from, replyMessage);
        } catch (sendError) {
            console.error('[Whatsapp AI Chat] Failed to notify user about chatbot error:', sendError);
        }
    }
};


/**
 * Unified handler for all incoming WhatsApp messages.
 * Decides whether to use the AI chatbot or the static command handler based on settings.
 * This function is exported and passed to the whatsappService during initialization.
 * @param {{from: string, body: string}} message - The message object.
 */
export const handleWhatsappMessage = async (message) => {
    const { from, body } = message;

    try {
        // 1. Retrieve settings and find customer in parallel for efficiency
        const settings = await getSettings();
        const isAiEnabled = settings.whatsapp?.chatbotEnabled || false;

        // Normalize phone number to check for '0' vs '62' formats
        let otherFormatPhone = null;
        if (from.startsWith('62')) otherFormatPhone = '0' + from.substring(2);
        else if (from.startsWith('0')) otherFormatPhone = '62' + from.substring(1);

        const [[customer]] = await pool.query('SELECT * FROM customers WHERE phone IN (?, ?)', [from, otherFormatPhone]);

        // 2. Handle non-customers immediately
        if (!customer) {
           // console.log(`[Unified Handler] Message from non-customer ${from}. Sending default reply.`);
            await whatsappService.sendMessage(from, 'Maaf, nomor Anda tidak terdaftar di sistem kami. Silakan hubungi dari nomor yang Anda daftarkan. 😊');
            return;
        }

        // 3. For customers, try static commands first (fast, robust, strict syntax)
        const staticHandled = await handleStaticCommands(message, customer, isAiEnabled);
        if (staticHandled) {
           // console.log(`[Unified Handler] Message from ${from} was handled by static command processor.`);
            return;
        }

        // 4. If not a static command, and AI is enabled, route to the AI chatbot
        if (isAiEnabled) {
           // console.log(`[Unified Handler] Routing message from ${from} to AI handler.`);
            await handleAiChatbot(message, customer);
        } else {
            // 5. If AI is disabled and it wasn't a static command, send a default message.
          //  console.log(`[Unified Handler] AI is disabled. Sending default reply to ${from}.`);
            await whatsappService.sendMessage(from, 'Maaf, chatbot AI sedang tidak aktif. Ketik `menu` untuk melihat daftar perintah yang tersedia. 😊');
        }
    } catch (error) {
        console.error(`[Unified Message Handler] ERROR processing message from ${from}:`, error);
        try {
            await whatsappService.sendMessage(from, "Maaf, terjadi kesalahan di pihak server saat memproses permintaan Anda. Silakan coba lagi nanti. 😊");
        } catch (sendError) {
            console.error('[Unified Message Handler] FAILED TO SEND FINAL ERROR MESSAGE:', sendError);
        }
    }
};

export default router;
