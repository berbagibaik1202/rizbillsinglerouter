import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountHotspotWebhook } from '../backend/routes/hotspotWebhook.js';

test('hotspot API key callback bypasses JWT only for the POST webhook', async t => {
    const app = express();
    app.use(express.json());
    let apiKey = 'router-secret';
    const events = [];
    mountHotspotWebhook(app, {
        getSettings: async () => ({ app: { apiKey } }),
        handleWebhook: async (req, res) => { events.push(req.body); res.send('processed'); },
    });
    app.use('/api', (_req, res) => res.status(401).send('JWT required'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (path, body, headers = {}, method = 'POST') => fetch(base + path, {
        method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const event = { event: 'login', username: 'voucher-1' };
    const endpoint = '/api/hotspot/webhook';
    for (const suffix of ['', '?apiKey=wrong', '?apiKey=', '?apiKey=a&apiKey=b']) {
        assert.equal((await send(endpoint + suffix, event)).status, 403);
    }
    assert.equal(events.length, 0);
    for (const contentType of ['application/json', 'application/x-www-form-urlencoded', 'text/plain']) {
        assert.equal((await send(endpoint + '?apiKey=router-secret', event, { 'Content-Type': contentType })).status, 200);
        assert.deepEqual(events.at(-1), event);
    }
    assert.equal((await send(endpoint, { ...event, event: 'logout' }, { 'x-api-key': apiKey })).status, 200);
    const count = events.length;
    assert.equal((await send(endpoint + '?apiKey=router-secret', { event: 'login' })).status, 400);
    assert.equal((await send(endpoint + '?apiKey=router-secret', '{broken')).status, 400);
    assert.equal(events.length, count);
    assert.equal((await send('/api/hotspot/users?apiKey=router-secret', undefined, {}, 'GET')).status, 401);
    assert.equal((await send(endpoint + '?apiKey=router-secret', undefined, {}, 'GET')).status, 401);
    apiKey = '';
    assert.equal((await send(endpoint, event)).status, 503);
    assert.equal(events.length, count);
});
