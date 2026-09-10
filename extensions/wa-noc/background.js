const DEFAULT_BACKEND = 'https://billing.rizki-tech.com';
const ready = Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
let refreshing;
let authRevision = 0;
let authQueue = Promise.resolve();
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

function backendUrl(value) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Gunakan origin HTTPS, misalnya https://billing.rizki-tech.com');
    return url.origin;
}

async function raw(path, { method = 'GET', body, token, backend = DEFAULT_BACKEND } = {}) {
    const response = await fetch(`${backendUrl(backend)}/api/wa-extension${path}`, {
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
        const data = await raw(path, { ...options, token: session.accessToken, backend: session.backend });
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
            const fresh = await raw('/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken }, backend: session.backend });
            assertSession();
            fresh.backend = session.backend;
            await chrome.storage.session.set({ session: fresh });
            return fresh;
        })().catch(async failure => {
            if (revision === authRevision && [401, 403].includes(failure.status)) await chrome.storage.session.remove('session');
            throw failure;
        }).finally(() => { refreshing = undefined; });
        const fresh = await refreshing;
        assertSession();
        if (!fresh) throw Object.assign(new Error('Login kembali.'), { status: 401 });
        const data = await raw(path, { ...options, token: fresh.accessToken, backend: fresh.backend });
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
    if (op === 'config') {
        if (!optionsPage) throw new Error('Buka pengaturan extension.');
        const { backend = DEFAULT_BACKEND } = await chrome.storage.local.get('backend');
        return { backend };
    }
    if (op === 'login') {
        if (!optionsPage) throw new Error('Login hanya tersedia di pengaturan extension.');
        const backend = backendUrl(body.backend);
        if (!await chrome.permissions.contains({ origins: [`${backend}/*`] })) throw new Error('Izin backend belum diberikan.');
        authRevision++;
        refreshing = undefined;
        await chrome.storage.session.remove('session');
        await chrome.storage.local.set({ backend });
        const session = await raw('/auth/login', { method: 'POST', body: { username: body.username, password: body.password }, backend });
        session.backend = backend;
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
    if (['overview', 'network', 'traffic', 'acs', 'wifi', 'history'].includes(op)) return api(`/customer/${encodeURIComponent(id)}/${op}`);
    if (['ping', 'reboot', 'link'].includes(op)) return api(`/customer/${encodeURIComponent(id)}/${op}`, { method: 'POST', body: { confirm: body?.confirm === true, ...(op === 'link' ? { phone: body?.phone } : {}) } });
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
