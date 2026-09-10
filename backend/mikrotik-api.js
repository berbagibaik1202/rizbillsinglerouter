// Import RouterOSAPI dan pool database
import { RouterOSAPI } from 'node-routeros';
import pool from './db.js';
import { Channel } from 'node-routeros/dist/Channel.js';
import { Receiver } from 'node-routeros/dist/connector/Receiver.js';

// Guard against node-routeros throwing UNREGISTEREDTAG and crashing the process.
// Some Mikrotik versions respond with unexpected tags; we choose to log and ignore.
const originalSendTagData = Receiver.prototype.sendTagData;
Receiver.prototype.sendTagData = function (tag, data) {
    try {
        return originalSendTagData.call(this, tag, data);
    } catch (err) {
        if (err && (err.errno === 'UNREGISTEREDTAG' || err.message === 'UNREGISTEREDTAG')) {
            console.warn('[Mikrotik API] Ignoring UNREGISTEREDTAG from router (likely a noisy reply).');
            return; // swallow to keep process alive
        }
        throw err;
    }
};

const originalChannelOnUnknown = Channel.prototype.onUnknown;
Channel.prototype.onUnknown = function (reply) {
    const normalizedReply = typeof reply === 'string' ? reply.trim().toLowerCase() : reply;
    if (normalizedReply === '!empty') {
        console.warn('[Mikrotik API] Router returned !empty; treating the reply as an empty response.');
        if (!this.trapped) {
            this.emit('done', Array.isArray(this.data) ? this.data : []);
        }
        this.close();
        return;
    }
    return originalChannelOnUnknown.call(this, reply);
};

// Konstanta untuk komentar aturan NAT
const NAT_RULE_COMMENT = 'RIZKITECHBILL-REMOTE-ONT';

/**
 * Menjalankan perintah API MikroTik dengan timeout yang ditentukan.
 * @param {RouterOSAPI} conn - Objek koneksi node-routeros yang aktif.
 * @param {string|Array} command - Perintah yang akan dijalankan.
 * @param {Array} [args] - Argumen opsional untuk perintah.
 * @param {number} [timeout=15000] - Timeout dalam milidetik.
 * @returns {Promise<any>} Promise yang akan resolve dengan hasil perintah atau reject pada timeout/error.
 */
const executeWriteWithTimeout = (conn, command, args = undefined, timeout = 15000) => {
    return new Promise((resolve, reject) => {
        const commandName = Array.isArray(command) ? command[0] : command;
        const timer = setTimeout(() => {
            reject(new Error(`Panggilan API MikroTik ke '${commandName}' timeout setelah ${timeout / 1000} detik. Router mungkin sibuk, memiliki dataset besar, atau tidak responsif.`));
        }, timeout);

        let writePromise;
        // Library node-routeros memiliki fungsi write yang overload.
        // Dapat dipanggil sebagai write(command, args) atau write(commandAndArgsArray).
        // Melewatkan array sebagai argumen pertama dan `undefined` sebagai argumen kedua menyebabkan error internal.
        // Logika ini menangani kedua konvensi pemanggilan dengan benar.
        if (Array.isArray(command) && args === undefined) {
            writePromise = conn.write(command);
        } else {
            writePromise = conn.write(command, args || []);
        }

        writePromise
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timer);
                reject(error);
            });
    });
};


const getSettingsFromDb = async () => {
    try {
        const [rows] = await pool.query("SELECT settings_value FROM settings WHERE settings_key = 'main'");
        if (rows.length === 0) {
            throw new Error('Pengaturan tidak ditemukan di database.');
        }
        const settings = JSON.parse(rows[0].settings_value);
        if (!settings.mikrotik) {
             throw new Error('Pengaturan Mikrotik tidak dikonfigurasi di database.');
        }
        return settings;
    } catch (error) {
        console.error("Gagal mendapatkan pengaturan dari DB:", error);
        throw new Error('Tidak dapat membaca pengaturan dari database.');
    }
};

const withTimeout = (promise, ms, timeoutError = new Error('Operation timed out.')) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(timeoutError);
        }, ms);

        promise.then(
            res => {
                clearTimeout(timer);
                resolve(res);
            },
            err => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
};

// Helper untuk membuat koneksi dengan router Mikrotik
const connectToRouter = async () => {
    let host = ''; // Definisikan di luar untuk logging error
    try {
        const settings = await getSettingsFromDb();
        const mikrotikSettings = settings.mikrotik;
        host = mikrotikSettings.host;

        if (!host || !host.trim() || !mikrotikSettings.user || !mikrotikSettings.user.trim()) {
            console.error('[Mikrotik API] Koneksi dilewati: Host atau Username tidak dikonfigurasi.');
            return null;
        }
        
        const connectionConfig = {
            host,
            user: mikrotikSettings.user,
            password: mikrotikSettings.password,
            port: mikrotikSettings.port ? parseInt(mikrotikSettings.port, 10) : 8728,
            timeout: 10 // deteksi cepat, tapi tidak terlalu singkat agar tidak sering timeout
        };

        const conn = new RouterOSAPI(connectionConfig);

        // Hindari crash karena event 'error' yang tidak ditangani
        conn.on('error', (err) => {
            console.error(`[Mikrotik API] RouterOS error event untuk host '${host}':`, err?.message || err);
        });

        try {
            await withTimeout(conn.connect(), 10000, new Error(`Connection attempt to router timed out after 10 seconds.`));
        } catch (connectErr) {
            let errorDetail = connectErr.message;
            if (connectErr.name === 'AggregateError' && Array.isArray(connectErr.errors)) {
                errorDetail = connectErr.errors.map(e => e.message).join('; ');
            }
            console.error(`[Mikrotik API] Gagal pada tahap koneksi ke host '${host}': ${errorDetail}`);
            return null; // Keluar dengan baik
        }

        return conn;
    } catch (err) {
        console.error(`[Mikrotik API] Kesalahan Koneksi (blok luar) saat mencoba terhubung ke '${host}':`, err.message);
        return null;
    }
};

/**
 * Fungsi sederhana untuk menguji koneksi ke router Mikrotik.
 * Fungsi ini SENGAJA dirancang untuk melempar error saat gagal untuk tombol tes UI.
 * @throws Error jika koneksi atau pembacaan gagal.
 */
const testMikrotikConnection = async () => {
    const settings = await getSettingsFromDb();
    const { host, user, password, port } = settings.mikrotik;
    if (!host || !host.trim() || !user || !user.trim()) {
        throw new Error('Host dan Username API Mikrotik tidak dikonfigurasi.');
    }
    const conn = new RouterOSAPI({ host, user, password, port: port || 8728, timeout: 10 });
    try {
        await conn.connect();
        const identity = await executeWriteWithTimeout(conn, '/system/identity/print');
        console.log(`[Mikrotik API] Tes koneksi berhasil. Identitas router: ${identity[0].name}`);
        conn.close();
    } catch (err) {
        console.error("Tes koneksi Mikrotik gagal:", err);
        let errorMessage = 'Gagal terhubung. Harap periksa kredensial dan konektivitas jaringan.';
        if (err.name === 'AggregateError') {
            errorMessage = `DNS lookup failed for host '${host}'. Please check if the hostname is correct and resolvable.`;
        } else if (err.message && err.message.includes('Timed out')) {
            errorMessage = 'Koneksi Timeout. Harap verifikasi Host/IP dan Port, dan periksa pengaturan firewall.';
        } else if (err.message) {
            errorMessage = err.message;
        }
        throw new Error(errorMessage);
    }
};

/**
 * Mengambil daftar semua interface dari router.
 * @returns {Promise<Array<Object>>} Promise yang resolve dengan array interface.
 */
const fetchInterfaces = async () => {
    const conn = await connectToRouter();
    if (!conn) return [];
    try {
        const interfaces = await executeWriteWithTimeout(conn, '/interface/print');
        if (!Array.isArray(interfaces)) return [];
        return interfaces.map(iface => ({
            id: iface['.id'],
            name: iface.name,
            type: iface.type,
            running: iface.running === 'true'
        }));
    } catch (error) {
        console.error("Gagal mengambil interface, mengembalikan array kosong:", error.message);
        return [];
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Memantau lalu lintas untuk interface tertentu selama satu siklus.
 * @param {string} interfaceName - Nama interface yang akan dipantau.
 * @returns {Promise<Object>} Promise yang resolve dengan objek yang berisi tx dan rx bps.
 */
const monitorInterfaceTraffic = async (interfaceName) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error('Router sedang offline');
    try {
        const result = await executeWriteWithTimeout(conn, '/interface/monitor-traffic', [`=interface=${interfaceName}`, '=once=']);
        if (result && Array.isArray(result) && result.length > 0) {
            return {
                tx: parseInt(result[0]['tx-bits-per-second'], 10) || 0,
                rx: parseInt(result[0]['rx-bits-per-second'], 10) || 0,
            };
        }
        return { tx: 0, rx: 0 };
    } catch (error) {
        console.error(`Gagal memantau lalu lintas untuk ${interfaceName}, mengembalikan nol:`, error.message);
        return { tx: 0, rx: 0 };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Mengambil daftar semua simple queue dari router.
 * @returns {Promise<Array<Object>>} Promise yang resolve dengan array simple queue.
 */
const fetchSimpleQueues = async () => {
    const conn = await connectToRouter();
    if (!conn) return [];
    try {
        const queues = await executeWriteWithTimeout(conn, '/queue/simple/print');
        if (!Array.isArray(queues)) return [];
        return queues.map(queue => ({
            id: queue['.id'],
            name: queue.name,
            target: queue.target,
        }));
    } catch (error) {
        console.error("Gagal mengambil simple queue, mengembalikan array kosong:", error.message);
        return [];
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Memantau lalu lintas untuk simple queue tertentu selama satu siklus.
 * @param {string} queueId - .id dari queue yang akan dipantau.
 * @returns {Promise<Object>} Promise yang resolve dengan objek yang berisi tx dan rx bps.
 */
const monitorQueueTraffic = async (queueId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error('Router sedang offline');
    try {
        const result = await executeWriteWithTimeout(conn, '/queue/simple/print', [`?.id=${queueId}`]);
        if (result && Array.isArray(result) && result.length > 0) {
            const rate = result[0].rate || '0/0';
            const [txBps, rxBps] = rate.split('/');
            return {
                tx: parseInt(txBps, 10) || 0,
                rx: parseInt(rxBps, 10) || 0,
            };
        }
        return { tx: 0, rx: 0 };
    } catch (error) {
        console.error(`Gagal memantau lalu lintas untuk queue ${queueId}, mengembalikan nol:`, error.message);
        return { tx: 0, rx: 0 };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Memantau lalu lintas untuk pengguna PPPoE tertentu dengan menemukan antrian dinamisnya.
 * Mencoba beberapa strategi untuk menemukan antrian yang benar.
 * @param {string} username - Username PPPoE.
 * @returns {Promise<Object>} Promise yang resolve dengan objek berisi { rx, tx } dalam bit per detik.
 */
const monitorTrafficForPppoeUser = async (username) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error('Router sedang offline');

    try {
        // First, check if the user is actually online.
        const activeUsers = await executeWriteWithTimeout(conn, '/ppp/active/print', [`?name=${username}`]);
        if (!activeUsers || !Array.isArray(activeUsers) || activeUsers.length === 0) {
            // User is not online, so traffic is zero.
            return { rx: 0, tx: 0 };
        }

        // --- STRATEGY 1: Direct Interface Monitoring (Most Reliable) ---
        // The dynamic interface for a PPPoE session is typically named `<pppoe-USERNAME>`.
        const interfaceName = `<pppoe-${username}>`;
        try {
            const trafficResult = await executeWriteWithTimeout(conn, '/interface/monitor-traffic', [`=interface=${interfaceName}`, '=once=']);
            if (trafficResult && Array.isArray(trafficResult) && trafficResult.length > 0) {
                return {
                    tx: parseInt(trafficResult[0]['tx-bits-per-second'], 10) || 0,
                    rx: parseInt(trafficResult[0]['rx-bits-per-second'], 10) || 0,
                };
            }
        } catch (interfaceError) {
            // If this fails (e.g., interface name is different), we'll fall through to the queue method.
            console.warn(`[Traffic Monitor] Direct interface monitor for '${interfaceName}' failed. Falling back to queue method. Error: ${interfaceError.message}`);
        }

        // --- STRATEGY 2: Simple Queue Monitoring (Fallback) ---
        console.log(`[Traffic Monitor] Using fallback queue method for ${username}.`);
        const userIp = activeUsers[0].address;
        const allSimpleQueues = await executeWriteWithTimeout(conn, '/queue/simple/print');
        if (!Array.isArray(allSimpleQueues)) {
            return { rx: 0, tx: 0 };
        }
        
        // Find by target IP
        const targetQueue = allSimpleQueues.find(q => q.target && q.target.startsWith(userIp));
        if (targetQueue && targetQueue.rate) {
            const [txBps, rxBps] = targetQueue.rate.split('/');
            return { rx: parseInt(rxBps, 10) || 0, tx: parseInt(txBps, 10) || 0 };
        }

        // Find by dynamic name <pppoe-username>
        const dynamicNameQueue = allSimpleQueues.find(q => q.name === interfaceName); // Re-use interfaceName
        if (dynamicNameQueue && dynamicNameQueue.rate) {
            const [txBps, rxBps] = dynamicNameQueue.rate.split('/');
            return { rx: parseInt(rxBps, 10) || 0, tx: parseInt(txBps, 10) || 0 };
        }
        
        // Find by static name
        const namedQueue = allSimpleQueues.find(q => q.name === username);
        if (namedQueue && namedQueue.rate) {
            const [txBps, rxBps] = namedQueue.rate.split('/');
            return { rx: parseInt(rxBps, 10) || 0, tx: parseInt(txBps, 10) || 0 };
        }

        // If all methods fail, return zero.
        return { rx: 0, tx: 0 };

    } catch (error) {
        console.error(`Gagal memantau lalu lintas untuk ${username}, mengembalikan nol:`, error.message);
        return { rx: 0, tx: 0 };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Mengambil semua pppoe secret dan koneksi aktif untuk menentukan status langsung.
 * @returns {Promise<Array<Object>>} Promise yang resolve dengan array pengguna PPPoE dengan status langsung.
 */
const fetchPppoeUsers = async ({ includeActive = true } = {}) => {
    const conn = await connectToRouter();
    if (!conn) return [];
    try {
        const secrets = await executeWriteWithTimeout(conn, '/ppp/secret/print');
        const safeSecrets = Array.isArray(secrets) ? secrets : [];
        let activeUsernames = new Set();

        if (includeActive) {
            const activeConnections = await executeWriteWithTimeout(conn, '/ppp/active/print');
            const safeActiveConnections = Array.isArray(activeConnections) ? activeConnections : [];
            activeUsernames = new Set(safeActiveConnections.map(c => c.name));
        }

        return safeSecrets.map(secret => ({
            id: secret['.id'],
            name: secret.name,
            password: secret.password,
            service: secret.service,
            profile: secret.profile,
            comment: secret.comment || '',
            disabled: secret.disabled === 'true',
            active: activeUsernames.has(secret.name)
        }));
    } catch (error) {
        console.error("Gagal mengambil pengguna PPPoE, mengembalikan array kosong:", error.message);
        return [];
    } finally {
        conn.close();
    }
};

/**
 * Mengambil hanya koneksi PPPoE aktif dari router.
 * @returns {Promise<Array<Object>>} Promise yang resolve dengan array koneksi PPPoE aktif.
 */
const fetchActivePppoeConnections = async () => {
    const conn = await connectToRouter();
    if (!conn) return [];
    try {
        const connections = await executeWriteWithTimeout(conn, '/ppp/active/print');
        return Array.isArray(connections) ? connections : [];
    } catch (error) {
        console.error("Gagal mengambil koneksi PPPoE aktif, mengembalikan array kosong:", error.message);
        return [];
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menghapus sesi PPPoE aktif berdasarkan .id koneksi aktif.
 * @param {string} activeId - .id dari sesi aktif PPPoE.
 * @returns {Promise<{success: boolean}>}
 */
const removeActivePppoeConnection = async (activeId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat menghapus koneksi PPPoE aktif.");
    try {
        await executeWriteWithTimeout(conn, ['/ppp/active/remove', `=.id=${activeId}`]);
        return { success: true };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Memperbarui pppoe secret pengguna yang ada di router dengan hanya mengubah field yang disediakan.
 * @param {string} userId - .id pengguna dari router.
 * @param {object} userData - Objek yang hanya berisi field yang akan diperbarui.
 * @returns {Promise<object>}
 */
const updatePppoeUser = async (userId, userData) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat memperbarui pengguna.");
    try {
        const command = ['/ppp/secret/set', `=.id=${userId}`];
        if (userData.name) command.push(`=name=${userData.name}`);
        if (userData.password) command.push(`=password=${userData.password}`);
        if (userData.profile) command.push(`=profile=${userData.profile}`);
        if (typeof userData.comment !== 'undefined') command.push(`=comment=${userData.comment}`);
        return await executeWriteWithTimeout(conn, command);
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menonaktifkan pengguna PPPoE di router.
 * @param {string} userId - .id pengguna dari router.
 * @returns {Promise<{success: boolean}>}
 */
const disablePppoeUser = async (userId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat menonaktifkan pengguna.");
    try {
        await executeWriteWithTimeout(conn, ['/ppp/secret/set', '=disabled=yes', `=.id=${userId}`]);
        return { success: true };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Mengaktifkan pengguna PPPoE di router.
 * @param {string} userId - .id pengguna dari router.
 * @returns {Promise<{success: boolean}>}
 */
const enablePppoeUser = async (userId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat mengaktifkan pengguna.");
    try {
        await executeWriteWithTimeout(conn, ['/ppp/secret/set', '=disabled=no', `=.id=${userId}`]);
        return { success: true };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menghubungkan kembali pengguna PPPoE dengan memutus sesi aktif mereka.
 * @param {string} username - Username pengguna yang akan dihubungkan kembali.
 * @returns {Promise<{success: boolean}>}
 */
const reconnectPppoeUser = async (username) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat menghubungkan kembali pengguna.");
    try {
        const activeConnections = await executeWriteWithTimeout(conn, ['/ppp/active/print', `?name=${username}`]);
        if (activeConnections && Array.isArray(activeConnections) && activeConnections.length > 0) {
            const connectionId = activeConnections[0]['.id'];
            await executeWriteWithTimeout(conn, ['/ppp/active/remove', `=.id=${connectionId}`]);
        }
        return { success: true };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menghapus pppoe secret pengguna dari router.
 * @param {string} userId - .id dari pppoe secret yang akan dihapus.
 * @returns {Promise<object>} Hasil dari router.
 */
const deletePppoeUser = async (userId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat menghapus pengguna.");
    try {
        // Cek dulu apakah secret ada di router
        const secrets = await executeWriteWithTimeout(conn, ['/ppp/secret/print', `?.id=${userId}`]);
        
        // Hanya lanjutkan jika secret benar-benar ada.
        if (secrets && Array.isArray(secrets) && secrets.length > 0) {
            const username = secrets[0].name;
            // Hapus koneksi aktif jika ada
            const activeConnections = await executeWriteWithTimeout(conn, ['/ppp/active/print', `?name=${username}`]);
            if (activeConnections && Array.isArray(activeConnections) && activeConnections.length > 0) {
                await executeWriteWithTimeout(conn, ['/ppp/active/remove', `=.id=${activeConnections[0]['.id']}`]);
            }
            // Hapus secret itu sendiri
            await executeWriteWithTimeout(conn, ['/ppp/secret/remove', `=.id=${userId}`]);
        }
        // Jika secret tidak ditemukan, anggap sukses karena tujuan akhir tercapai.
        return { success: true };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menambahkan pppoe secret pengguna baru ke router.
 * @param {object} userData - Data untuk pengguna baru.
 * @returns {Promise<object>}
 */
const addPppoeUser = async (userData) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat menambahkan pengguna.");
    try {
        const command = [
            '/ppp/secret/add',
            `=name=${userData.name}`,
            `=password=${userData.password}`,
            `=service=pppoe`,
            `=profile=${userData.profile}`,
            `=comment=${userData.comment || ''}`,
        ];
        return await executeWriteWithTimeout(conn, command);
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menemukan pengguna PPPoE berdasarkan nama dan memperbarui field komentar mereka.
 * @param {string} username - Nama pengguna yang akan diperbarui.
 * @param {string} comment - Komentar baru yang akan diatur.
 * @returns {Promise<void>}
 */
const updatePppoeUserCommentByName = async (username, comment) => {
    if (!username) return;
    const conn = await connectToRouter();
    if (!conn) {
        console.warn(`[Mikrotik API] Melewati pembaruan komentar untuk ${username}: router sedang offline.`);
        return;
    }
    try {
        const users = await executeWriteWithTimeout(conn, ['/ppp/secret/print', `?name=${username}`]);
        if (users && Array.isArray(users) && users.length > 0) {
            const userId = users[0]['.id'];
            await executeWriteWithTimeout(conn, ['/ppp/secret/set', `=.id=${userId}`, `=comment=${comment || ''}`]);
        }
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Mengambil semua pengguna Hotspot dari router.
 * @returns {Promise<Array<Object>>}
 */
const fetchHotspotUsers = async () => {
    const conn = await connectToRouter();
    if (!conn) return [];
    try {
        const users = await executeWriteWithTimeout(conn, '/ip/hotspot/user/print');
        if (!Array.isArray(users)) return [];
        return users.map(user => ({
            id: user['.id'],
            name: user.name,
            password: user.password,
            profile: user.profile,
            comment: user.comment || '',
            disabled: user.disabled === 'true',
            totalUptime: user.uptime,
        }));
    } catch (error) {
        console.error("Gagal mengambil pengguna Hotspot, mengembalikan array kosong:", error.message);
        return [];
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Mengambil hanya sesi Hotspot aktif dari router.
 * @returns {Promise<Array<Object>>} Promise yang resolve dengan array sesi Hotspot aktif.
 */
const fetchActiveHotspotConnections = async () => {
    const conn = await connectToRouter();
    if (!conn) return [];
    try {
        const connections = await executeWriteWithTimeout(conn, '/ip/hotspot/active/print');
        return Array.isArray(connections) ? connections : [];
    } catch (error) {
        console.error("Gagal mengambil koneksi Hotspot aktif, mengembalikan array kosong:", error.message);
        return [];
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menambahkan pengguna Hotspot baru ke router.
 * @param {object} userData - Data untuk pengguna baru.
 * @returns {Promise<{id: string}|null>} Objek yang berisi ID pengguna baru, atau null jika gagal.
 */
const addHotspotUser = async (userData) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat menambahkan pengguna hotspot.");
    try {
        const command = [
            '/ip/hotspot/user/add',
            `=name=${userData.name}`,
            `=password=${userData.password}`,
            `=profile=${userData.profile}`,
            `=comment=${userData.comment || ''}`,
        ];
        // Tambahkan parameter 'disabled' jika disediakan, untuk membuat pengguna nonaktif secara default
        if (userData.disabled) {
            command.push(`=disabled=${userData.disabled}`);
        }
        const result = await executeWriteWithTimeout(conn, command);
        if (result && Array.isArray(result) && result.length > 0 && result[0].ret) {
            return { id: result[0].ret };
        }
        throw new Error('API MikroTik tidak mengembalikan ID yang valid untuk pengguna hotspot baru.');
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menghapus sesi Hotspot aktif.
 * @param {string} activeId - .id dari sesi aktif yang akan dihapus.
 * @returns {Promise<object>}
 */
const removeActiveHotspotUser = async (activeId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat menghapus pengguna aktif.");
    try {
        return await executeWriteWithTimeout(conn, ['/ip/hotspot/active/remove', `=.id=${activeId}`]);
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menghapus pengguna Hotspot dari router.
 * @param {string} userId - .id pengguna yang akan dihapus.
 * @returns {Promise<object>}
 */
const deleteHotspotUser = async (userId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat menghapus pengguna hotspot.");
    try {
        const users = await executeWriteWithTimeout(conn, ['/ip/hotspot/user/print', `?.id=${userId}`]);
        if (users && Array.isArray(users) && users.length > 0) {
            const username = users[0].name;
            const activeUsers = await executeWriteWithTimeout(conn, ['/ip/hotspot/active/print', `?user=${username}`]);
            if (activeUsers && Array.isArray(activeUsers) && activeUsers.length > 0) {
                // gunakan koneksi yang ada alih-alih memanggil removeActiveHotspotUser
                await executeWriteWithTimeout(conn, ['/ip/hotspot/active/remove', `=.id=${activeUsers[0]['.id']}`]);
            }
            await executeWriteWithTimeout(conn, ['/ip/hotspot/user/remove', `=.id=${userId}`]);
        }
        return { success: true };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Menonaktifkan pengguna Hotspot di router.
 * @param {string} userId - .id pengguna dari router.
 * @returns {Promise<{success: boolean}>}
 */
const disableHotspotUser = async (userId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat menonaktifkan pengguna hotspot.");
    try {
        await executeWriteWithTimeout(conn, ['/ip/hotspot/user/set', '=disabled=yes', `=.id=${userId}`]);
        return { success: true };
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Mengaktifkan pengguna Hotspot di router.
 * @param {string} userId - .id pengguna dari router.
 * @returns {Promise<{success: boolean}>}
 */
const enableHotspotUser = async (userId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline. Tidak dapat mengaktifkan pengguna hotspot.");
    try {
        await executeWriteWithTimeout(conn, ['/ip/hotspot/user/set', '=disabled=no', `=.id=${userId}`]);
        return { success: true };
    } finally {
        if (conn) conn.close();
    }
};


/**
 * Mengambil semua profil pengguna Hotspot dari router.
 * @returns {Promise<Array<Object>>}
 */
const fetchHotspotProfiles = async () => {
    const conn = await connectToRouter();
    if (!conn) return [];
    try {
        const profiles = await executeWriteWithTimeout(conn, '/ip/hotspot/user/profile/print');
        if (!Array.isArray(profiles)) return [];
        return profiles.map(profile => ({
            id: profile['.id'],
            name: profile.name,
            rateLimit: profile['rate-limit'] || '',
            sharedUsers: profile['shared-users'] ? parseInt(profile['shared-users'], 10) : 1,
        }));
    } catch (error) {
        console.error("Gagal mengambil profil Hotspot, mengembalikan array kosong:", error.message);
        return [];
    } finally {
        if (conn) conn.close();
    }
};

/**
 * Mengambil semua profil PPP dari router.
 * @returns {Promise<Array<PppoeProfile>>}
 */
const fetchPppoeProfiles = async () => {
    const conn = await connectToRouter();
    if (!conn) return [];
    try {
        const profiles = await executeWriteWithTimeout(conn, '/ppp/profile/print');
        if (!Array.isArray(profiles)) return [];
        return profiles.map(profile => ({
            id: profile['.id'],
            name: profile.name,
            localAddress: profile['local-address'] || '',
            remoteAddressPool: profile['remote-address'] || '',
            rateLimit: profile['rate-limit'] || '',
        }));
    } catch (error) {
        console.error("Gagal mengambil profil PPPoE, mengembalikan array kosong:", error.message);
        return [];
    }
    finally {
        if (conn) conn.close();
    }
};

const addHotspotProfile = async (profileData) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline.");
    try {
        return await executeWriteWithTimeout(conn, ['/ip/hotspot/user/profile/add', `=name=${profileData.name}`, `=rate-limit=${profileData.rateLimit || ''}`, `=shared-users=${profileData.sharedUsers || 1}`]);
    } finally {
        if (conn) conn.close();
    }
};

const updateHotspotProfile = async (profileId, profileData) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline.");
    try {
        const command = ['/ip/hotspot/user/profile/set', `=.id=${profileId}`];
        if (profileData.name) command.push(`=name=${profileData.name}`);
        if (typeof profileData.rateLimit !== 'undefined') command.push(`=rate-limit=${profileData.rateLimit}`);
        if (profileData.sharedUsers) command.push(`=shared-users=${profileData.sharedUsers}`);
        return await executeWriteWithTimeout(conn, command);
    } finally {
        if (conn) conn.close();
    }
};

const deleteHotspotProfile = async (profileId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline.");
    try {
        const profileResult = await executeWriteWithTimeout(conn, ['/ip/hotspot/user/profile/print', `?.id=${profileId}`]);
        if (!profileResult || !Array.isArray(profileResult) || profileResult.length === 0) throw new Error('Profil tidak ditemukan.');
        const usersOnProfile = await executeWriteWithTimeout(conn, ['/ip/hotspot/user/print', `?profile=${profileResult[0].name}`]);
        if (Array.isArray(usersOnProfile) && usersOnProfile.length > 0) throw new Error(`Tidak dapat menghapus profil: digunakan oleh ${usersOnProfile.length} pengguna.`);
        return await executeWriteWithTimeout(conn, ['/ip/hotspot/user/profile/remove', `=.id=${profileId}`]);
    } finally {
        if (conn) conn.close();
    }
};

const addPppoeProfile = async (profileData) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline.");
    try {
        const command = ['/ppp/profile/add', `=name=${profileData.name}`];
        if (profileData.localAddress) command.push(`=local-address=${profileData.localAddress}`);
        if (profileData.remoteAddressPool) command.push(`=remote-address=${profileData.remoteAddressPool}`);
        if (profileData.rateLimit) command.push(`=rate-limit=${profileData.rateLimit}`);
        return await executeWriteWithTimeout(conn, command);
    } finally {
        if (conn) conn.close();
    }
};

const updatePppoeProfile = async (profileId, profileData) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline.");
    try {
        const command = ['/ppp/profile/set', `=.id=${profileId}`];
        if (profileData.name) command.push(`=name=${profileData.name}`);
        if (typeof profileData.localAddress !== 'undefined') command.push(`=local-address=${profileData.localAddress}`);
        if (typeof profileData.remoteAddressPool !== 'undefined') command.push(`=remote-address=${profileData.remoteAddressPool}`);
        if (typeof profileData.rateLimit !== 'undefined') command.push(`=rate-limit=${profileData.rateLimit}`);
        return await executeWriteWithTimeout(conn, command);
    } finally {
        if (conn) conn.close();
    }
};

const deletePppoeProfile = async (profileId) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router Mikrotik sedang offline.");
    try {
        const profileResult = await executeWriteWithTimeout(conn, ['/ppp/profile/print', `?.id=${profileId}`]);
        if (!profileResult || !Array.isArray(profileResult) || profileResult.length === 0) throw new Error('Profil tidak ditemukan.');
        const usersOnProfile = await executeWriteWithTimeout(conn, ['/ppp/secret/print', `?profile=${profileResult[0].name}`]);
        if (Array.isArray(usersOnProfile) && usersOnProfile.length > 0) throw new Error(`Tidak dapat menghapus profil: digunakan oleh ${usersOnProfile.length} pengguna.`);
        return await executeWriteWithTimeout(conn, ['/ppp/profile/remove', `=.id=${profileId}`]);
    } finally {
        if (conn) conn.close();
    }
};

const setupRemoteOntNatRule = async (mikrotikSettings) => {
    const conn = await connectToRouter();
    if (!conn) {
        if (mikrotikSettings.enableDynamicNat) {
            throw new Error("Router sedang offline. Tidak dapat mengatur aturan NAT.");
        }
        return;
    }
    try {
        const existingRules = await executeWriteWithTimeout(conn, '/ip/firewall/nat/print', [`?comment=${NAT_RULE_COMMENT}`]);
        if (Array.isArray(existingRules) && existingRules.length > 0) {
            await executeWriteWithTimeout(conn, '/ip/firewall/nat/remove', [`=.id=${existingRules[0]['.id']}`]);
            console.log(`[NAT Setup] Menghapus aturan yang ada: ${existingRules[0]['.id']}`);
        }

        if (mikrotikSettings.enableDynamicNat) {
            const { natInInterface, natPublicPort, natOntPort } = mikrotikSettings;
            
            // Validasi port, tapi bukan in-interface
            if (!natPublicPort || !natOntPort) {
                throw new Error("Public Port and ONT Port are required for dynamic NAT.");
            }
            
            const newRule = {
                chain: 'dstnat',
                protocol: 'tcp',
                'dst-port': natPublicPort,
                action: 'dst-nat',
                'to-addresses': '0.0.0.0', // Placeholder
                'to-ports': natOntPort,
                comment: NAT_RULE_COMMENT,
            };

            // Tambahkan 'in-interface' secara kondisional jika ada
            if (natInInterface) {
                newRule['in-interface'] = natInInterface;
                console.log(`[NAT Setup] Membuat aturan NAT dinamis dengan In-Interface: ${natInInterface}.`);
            } else {
                console.log(`[NAT Setup] Membuat aturan NAT dinamis tanpa In-Interface spesifik.`);
            }

            const command = ['/ip/firewall/nat/add'];
            for (const key in newRule) {
                command.push(`=${key}=${newRule[key]}`);
            }
            await executeWriteWithTimeout(conn, command);
            console.log(`[NAT Setup] Berhasil membuat aturan NAT dinamis.`);
        }
    } finally {
        conn.close();
    }
};

const updateRemoteOntNatTarget = async (targetIp) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error("Router sedang offline. Tidak dapat memperbarui target NAT.");
    try {
        const rules = await executeWriteWithTimeout(conn, '/ip/firewall/nat/print', [`?comment=${NAT_RULE_COMMENT}`]);
        if (!rules || !Array.isArray(rules) || rules.length === 0) {
            throw new Error(`Aturan NAT dinamis dengan komentar '${NAT_RULE_COMMENT}' tidak ditemukan di router. Harap konfigurasikan di pengaturan.`);
        }
        const ruleId = rules[0]['.id'];
        await executeWriteWithTimeout(conn, '/ip/firewall/nat/set', [`=.id=${ruleId}`, `=to-addresses=${targetIp}`]);
        console.log(`[NAT Update] Memperbarui aturan ${ruleId} untuk menargetkan IP: ${targetIp}`);
    } finally {
        if (conn) conn.close();
    }
};

// Strict NOC reads: a failed router must never be reported as an offline customer.
const getNocSnapshot = async (username, withTraffic = false) => {
    const conn = await connectToRouter();
    if (!conn) throw new Error('Router unavailable');
    try {
        const sessions = await executeWriteWithTimeout(conn, '/ppp/active/print', [`?name=${username}`], 5000);
        if (!Array.isArray(sessions)) throw new Error('Invalid router response');
        const session = sessions[0];
        if (!session) return { status: 'OFFLINE', online: false, ip: null, uptime: null, downloadMbps: 0, uploadMbps: 0 };
        const result = { status: 'ONLINE', online: true, ip: session.address, uptime: session.uptime, callerId: session['caller-id'] };
        if (withTraffic) {
            const rows = await executeWriteWithTimeout(conn, '/interface/monitor-traffic', [`=interface=<pppoe-${username}>`, '=once='], 5000);
            const tx = Number(rows?.[0]?.['tx-bits-per-second']);
            const rx = Number(rows?.[0]?.['rx-bits-per-second']);
            if (!Number.isFinite(tx) || !Number.isFinite(rx)) throw new Error('Traffic unavailable');
            result.downloadMbps = tx / 1000000;
            result.uploadMbps = rx / 1000000;
        }
        return result;
    } finally { conn.close(); }
};

const pingNocCustomer = async username => {
    const conn = await connectToRouter();
    if (!conn) throw new Error('Router unavailable');
    try {
        const sessions = await executeWriteWithTimeout(conn, '/ppp/active/print', [`?name=${username}`], 5000);
        const address = sessions?.[0]?.address;
        if (!address) throw new Error('No active customer session');
        const rows = await executeWriteWithTimeout(conn, '/ping', [`=address=${address}`, '=count=3', '=interval=300ms'], 5000);
        if (!Array.isArray(rows) || !rows.length) throw new Error('Ping unavailable');
        return { target: address, samples: rows.map(row => ({ time: row.time ?? null, status: row.status ?? null, sent: row.sent ?? null, received: row.received ?? null, packetLoss: row['packet-loss'] ?? null, average: row['avg-rtt'] ?? null })) };
    } finally { conn.close(); }
};

export default {
    getNocSnapshot,
    pingNocCustomer,
    testMikrotikConnection,
    fetchInterfaces,
    monitorInterfaceTraffic,
    fetchSimpleQueues,
    monitorQueueTraffic,
    monitorTrafficForPppoeUser,
    fetchPppoeUsers,
    updatePppoeUser,
    addPppoeUser,
    disablePppoeUser,
    enablePppoeUser,
    reconnectPppoeUser,
    deletePppoeUser,
    updatePppoeUserCommentByName,
    fetchHotspotUsers,
    addHotspotUser,
    deleteHotspotUser,
    disableHotspotUser,
    enableHotspotUser,
    removeActiveHotspotUser,
    fetchHotspotProfiles,
    addHotspotProfile,
    updateHotspotProfile,
    deleteHotspotProfile,
    fetchPppoeProfiles,
    addPppoeProfile,
    updatePppoeProfile,
    deletePppoeProfile,
    fetchActivePppoeConnections,
    removeActivePppoeConnection,
    fetchActiveHotspotConnections,
    setupRemoteOntNatRule,
    updateRemoteOntNatTarget,
};
