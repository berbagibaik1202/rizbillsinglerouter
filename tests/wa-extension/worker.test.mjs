import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../extensions/wa-noc/background.js', import.meta.url), 'utf8');
async function fixture() {
    let listener;
    const calls = [];
    const local = { backend: 'https://billing.rizki-tech.com' };
    const temporary = { session: { accessToken: 'secret-access', refreshToken: 'secret-refresh', backend: 'https://billing.rizki-tech.com' } };
    const area = data => ({
        setAccessLevel: async () => {},
        get: async key => ({ [key]: data[key] }),
        set: async values => Object.assign(data, values),
        remove: async key => { delete data[key]; },
    });
    vm.runInNewContext(source, {
        URL, AbortSignal, Error, Promise,
        chrome: {
            runtime: { id: 'test-extension', getURL: file => `chrome-extension://test-extension/${file}`, openOptionsPage: async () => {}, onMessage: { addListener: callback => { listener = callback; } } },
            storage: { local: area(local), session: area(temporary) },
            action: { onClicked: { addListener() {} } },
            permissions: { contains: async () => true },
        },
        fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: true, json: async () => ({ username: 'operator', permissions: ['view'] }) };
        },
    });
    return {
        calls, local,
        send: (message, url = 'https://web.whatsapp.com/') => new Promise(resolve => listener(message, { id: 'test-extension', url, frameId: 0 }, resolve)),
    };
}

test('worker rejects auth/config operations from WhatsApp and messages from other pages', async () => {
    const f = await fixture();
    for (const op of ['login', 'logout', 'config']) assert.equal((await f.send({ op })).ok, false);
    assert.equal((await f.send({ op: 'me' }, 'https://example.com/')).ok, false);
    assert.equal(f.calls.length, 0);
});

test('worker keeps access tokens server-side and binds requests to session backend', async () => {
    const f = await fixture();
    f.local.backend = 'https://different-server.example';
    const result = await f.send({ op: 'me' });
    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(result).includes('secret-access'), false);
    assert.equal(f.calls[0].url, 'https://billing.rizki-tech.com/api/wa-extension/auth/me');
    assert.equal(f.calls[0].options.headers.Authorization, 'Bearer secret-access');
});

test('worker permits only known operations and encodes customer identifiers', async () => {
    const f = await fixture();
    assert.equal((await f.send({ op: 'fetch', id: 'C1', body: { url: 'https://evil.example' } })).ok, false);
    assert.equal((await f.send({ op: 'overview', id: 'C1/../../admin' })).ok, true);
    assert.equal(f.calls[0].url.endsWith('/customer/C1%2F..%2F..%2Fadmin/overview'), true);
});

test('worker rejects insecure remote backend and embedded credentials before any request', async () => {
    const f = await fixture();
    for (const backend of ['http://billing.rizki-tech.com', 'https://operator:secret@example.com', 'https://example.com/path']) {
        const result = await f.send({ op: 'login', body: { backend, username: 'x', password: 'x' } }, 'chrome-extension://test-extension/options.html');
        assert.equal(result.ok, false);
    }
    assert.equal(f.calls.length, 0);
});
