import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the production service with isolated ACS/DB boundaries, without startup side effects.
const source = readFileSync(new URL('../../backend/services.js', import.meta.url), 'utf8');
const service = source.slice(source.indexOf('export const updateCustomerWlan ='), source.indexOf('// Di services.js - tambahkan function ini')).replace('export const', 'const');

for (const indices of [[1, 5], [1], [5]]) {
    test(`WLAN updates available SSID ${indices.join('/')} without a band selection`, async () => {
        const tasks = [], writes = [];
        const path = index => `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${index}`;
        const context = vm.createContext({
            console: { log() {}, warn() {}, error() {} }, AbortController, setTimeout, clearTimeout,
            ACS_API_TIMEOUT: 1000,
            getDeviceProfileByModel: () => null,
            unwrapAcsValue: value => value,
            getCustomerDeviceDetailsWithRefresh: async () => ({ wlanConfigs: [...indices, 2].map(index => ({ ssidPath: `${path(index)}.SSID`, keyPath: `${path(index)}.KeyPassphrase` })) }),
            getSettings: async () => ({ acs: { apiUrl: 'https://acs.example' } }),
            pool: { query: async (sql, values) => {
                if (sql.startsWith('SELECT')) return [[{ acsSerialNumber: 'test-device' }]];
                writes.push({ sql, values }); return [];
            } },
            fetch: async (_url, options) => {
                tasks.push(JSON.parse(options.body));
                return { ok: true, json: async () => ({ _id: 'task-1' }) };
            },
        });
        const update = vm.runInContext(`${service}\nupdateCustomerWlan`, context);
        await update('customer-1', { ssid: 'New WiFi', key: 'password123' });
        assert.equal(tasks.length, 1);
        assert.deepEqual(tasks[0].parameterValues, indices.flatMap(index => [
            [`${path(index)}.SSID`, 'New WiFi', 'xsd:string'],
            [`${path(index)}.KeyPassphrase`, 'password123', 'xsd:string'],
        ]));
        assert.equal(writes.length, 1);
        for (const index of [1, 5]) assert.equal(writes[0].sql.includes(`ssid${index} = ?`), indices.includes(index));
        writes.length = 0;
        await update('customer-1', { key: 'password456' });
        assert.deepEqual(tasks[1].parameterValues, indices.map(index => [`${path(index)}.KeyPassphrase`, 'password456', 'xsd:string']));
        assert.equal(writes.length, 0);
    });
}
