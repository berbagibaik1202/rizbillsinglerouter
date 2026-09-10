import pool from '../db.js';
import network from '../mikrotik-api.js';
import { getSettings } from '../utils.js';
import { parseDeviceDetails } from '../parsers/acsdeviceparser.js';
import { createWaExtensionRouter } from './router.js';

async function request(path, options = {}) {
    const { acs } = await getSettings();
    if (!acs?.apiUrl) throw new Error('ACS not configured');
    const headers = { 'Content-Type': 'application/json' };
    if (acs.username && acs.password) headers.Authorization = `Basic ${Buffer.from(`${acs.username}:${acs.password}`).toString('base64')}`;
    const response = await fetch(`${acs.apiUrl.replace(/\/$/, '')}${path}`, {
        ...options, headers, signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) throw new Error('ACS unavailable');
    return response;
}

async function device(serial) {
    const find = async query => (await request(`/devices?query=${encodeURIComponent(JSON.stringify(query))}`)).json();
    let devices = await find({ _id: serial });
    if (Array.isArray(devices) && devices.length === 0) devices = await find({ '_deviceId._SerialNumber': serial });
    if (!Array.isArray(devices) || devices.length !== 1 || !devices[0]._id) throw new Error('ACS device missing or ambiguous');
    return devices[0];
}

const acs = {
    async read(serial) {
        const raw = await device(serial);
        const parsed = parseDeviceDetails(raw);
        const rx = parsed.wan?.find(wan => /-?\d/.test(String(wan.rxPower)))?.rxPower;
        const rxPower = rx == null ? null : Number.parseFloat(rx);
        // Explicit allowlist: the parser also contains WiFi secrets and raw data.
        return {
            lastInform: raw._lastInform || null,
            model: parsed.general?.model || null,
            manufacturer: raw._deviceId?._Manufacturer || null,
            serial: raw._deviceId?._SerialNumber || serial,
            firmware: parsed.general?.firmware || null,
            rxPower: Number.isFinite(rxPower) ? rxPower : null,
            wifi: (parsed.wlan || []).map(wlan => ({ ssid: wlan.ssid || null, band: wlan.band || null })),
        };
    },
    async reboot(serial) {
        const raw = await device(serial);
        await request(`/devices/${encodeURIComponent(raw._id)}/tasks?connection_request`, { method: 'POST', body: JSON.stringify({ name: 'reboot' }) });
        return { status: 'QUEUED', message: 'Task restart dikirim ke ACS. Periksa status perangkat beberapa saat lagi.' };
    },
};

export default createWaExtensionRouter({ db: pool, network, acs });
