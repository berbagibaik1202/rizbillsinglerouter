import { createHash, randomBytes } from 'node:crypto';

export const PERMISSIONS = ['view', 'ping', 'reboot', 'wifi_write', 'billing_write', 'map', 'history'];
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
export const fail = (status, message) => Object.assign(new Error(message), { status });

export function normalizePhone(value) {
    const raw = String(value ?? '').trim();
    if (!/^[+\d\s().-]+$/.test(raw)) return null;
    let phone = raw.replace(/\D/g, '');
    if (phone.startsWith('00')) phone = phone.slice(2);
    if (phone.startsWith('0')) phone = `62${phone.slice(1)}`;
    else if (phone.startsWith('8')) phone = `62${phone}`;
    return /^[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function permissionsFor(user, grants) {
    const permissions = new Set(user.role === 'admin' ? PERMISSIONS : []);
    for (const grant of grants) {
        if (!PERMISSIONS.includes(grant.permission)) continue;
        if (Number(grant.allowed)) permissions.add(grant.permission);
        else permissions.delete(grant.permission);
    }
    return [...permissions];
}

export function acsStatus(lastInform, now = Date.now(), onlineMinutes = 10, staleMinutes = 30) {
    if (!lastInform) return 'UNKNOWN';
    const age = now - new Date(lastInform).getTime();
    if (!Number.isFinite(age) || age < -60000) return 'UNKNOWN';
    return age < onlineMinutes * 60000 ? 'ONLINE' : age < staleMinutes * 60000 ? 'STALE' : 'OFFLINE';
}

// Share in-flight work and retain only a bounded number of short-lived results.
export function createCache(ttl = 3000, maxEntries = 500) {
    const entries = new Map();
    return (key, work) => {
        const existing = entries.get(key);
        if (existing && (existing.pending || existing.until > Date.now())) return existing.promise;
        for (const [name, entry] of entries) {
            if (!entry.pending && entry.until <= Date.now()) entries.delete(name);
        }
        if (entries.size >= maxEntries) throw fail(503, 'Collector sibuk. Coba lagi.');
        const entry = { pending: true, until: 0 };
        entry.promise = Promise.resolve().then(work).then(value => {
            entry.pending = false;
            entry.until = Date.now() + ttl;
            return value;
        }, error => { entries.delete(key); throw error; });
        entries.set(key, entry);
        return entry.promise;
    };
}
