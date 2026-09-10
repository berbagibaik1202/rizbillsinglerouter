const DEFAULT_BACKEND = 'https://billing.rizki-tech.com';
const ready = Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
let refreshing;
let authRevision = 0;
let authQueue = Promise.resolve();
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function raw(path, { method = 'GET', body, token } = {}) {
    const response = await fetch(`${DEFAULT_BACKEND}/api/wa-extension${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25000), credentials: 'omit', redirect: 'error', cache: 'no-store',
    });
    const data = await response.json().catch(() => { throw new Error('Backend tidak mengembalikan JSON. Pastikan API WA NOC sudah diterapkan.'); });
    if (!response.ok) throw Object.assign(new Error(data.message || 'Permintaan gagal.'), { status: response.status });
    return data;
}

async function api(path, options = {}) {
    const revision = authRevision;
    const { session } = await chrome.storage.session.get('session');
    if (!session) throw Object.assign(new Error('Login melalui pengaturan extension.'), { status: 401 });
    const assertSession = () => { if (revision !== authRevision) throw Object.assign(new Error('Sesi berubah. Muat ulang panel.'), { status: 401 }); };
    try {
        const data = await raw(path, { ...options, token: session.accessToken });
        assertSession();
        return data;
    }
    catch (error) {
        assertSession();
        if (error.status !== 401) throw error;
        if (!refreshing) refreshing = (async () => {
            // Another request may have refreshed while this request was in flight.
            const current = (await chrome.storage.session.get('session')).session;
            if (current?.accessToken !== session.accessToken) return current;
            const fresh = await raw('/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } });
            assertSession();
            await chrome.storage.session.set({ session: fresh });
            return fresh;
        })().catch(async failure => {
            if (revision === authRevision && [401, 403].includes(failure.status)) await chrome.storage.session.remove('session');
            throw failure;
        }).finally(() => { refreshing = undefined; });
        const fresh = await refreshing;
        assertSession();
        if (!fresh) throw Object.assign(new Error('Login kembali.'), { status: 401 });
        const data = await raw(path, { ...options, token: fresh.accessToken });
        assertSession();
        return data;
    }
}

async function handle(message, sender) {
    await ready;
    const optionsPage = sender.url === chrome.runtime.getURL('options.html');
    const whatsapp = sender.id === chrome.runtime.id && sender.url?.startsWith('https://web.whatsapp.com/') && sender.frameId === 0;
    if (!optionsPage && !whatsapp) throw new Error('Sumber permintaan tidak valid.');
    const { op, id, body } = message || {};
    if (op === 'openOptions') { await chrome.runtime.openOptionsPage(); return {}; }
    if (op === 'login') {
        if (!optionsPage) throw new Error('Login hanya tersedia di pengaturan extension.');
        authRevision++;
        refreshing = undefined;
        await chrome.storage.session.remove('session');
        const session = await raw('/auth/login', { method: 'POST', body: { username: body.username, password: body.password } });
        await chrome.storage.session.set({ session });
        return session.user;
    }
    if (op === 'logout') {
        if (!optionsPage) throw new Error('Logout melalui pengaturan extension.');
        authRevision++;
        refreshing = undefined;
        try { await api('/auth/logout', { method: 'POST' }); }
        finally { await chrome.storage.session.remove('session'); }
        return {};
    }
    if (op === 'me') return api('/auth/me');
    if (op === 'lookup') return api(`/customer/by-phone/${encodeURIComponent(body.phone)}`);
    if (op === 'search') return api(`/customers?q=${encodeURIComponent(body.query)}`);
    if (typeof id !== 'string' || !id || id.length > 255) throw new Error('Pelanggan tidak valid.');
    if (['overview', 'network', 'traffic', 'acs', 'wifi', 'olt', 'billing', 'history'].includes(op)) return api(`/customer/${encodeURIComponent(id)}/${op}`);
    if (['ping', 'reboot', 'link'].includes(op)) return api(`/customer/${encodeURIComponent(id)}/${op}`, { method: 'POST', body: { confirm: body?.confirm === true, ...(op === 'link' ? { phone: body?.phone } : {}) } });
    if (op === 'wifiUpdate') return api(`/customer/${encodeURIComponent(id)}/wifi`, { method: 'POST', body: { confirm: body?.confirm === true, band: body?.band, ssid: body?.ssid, key: body?.key } });
    if (op === 'markInvoicePaid') return api(`/customer/${encodeURIComponent(id)}/invoice/${encodeURIComponent(body?.invoiceId || '')}/pay`, { method: 'POST', body: { confirm: body?.confirm === true, method: body?.method } });
    throw new Error('Operasi tidak dikenal.');
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
    // Login/logout must not change the backend while another auth change is running.
    const task = ['login', 'logout'].includes(message?.op)
        ? (authQueue = authQueue.catch(() => {}).then(() => handle(message, sender)))
        : handle(message, sender);
    task.then(data => reply({ ok: true, data }), error => reply({ ok: false, message: error.message, status: error.status || 0 }));
    return true;
});
