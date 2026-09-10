// Optional UI test: install Playwright separately, then set WA_NOC_PLAYWRIGHT_MODULE
// to its module URL when it is not installed in the root project.
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.WA_NOC_PLAYWRIGHT_MODULE || 'playwright');
await mkdir('.tmp-wa-noc-validation', { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: process.env.WA_NOC_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html><body><div id="main"><header><div data-testid="conversation-info-header-chat-title"><span>+62 81234567890</span></div></header><p>WhatsApp fixture</p></div></body></html>');
    await page.evaluate(() => {
        // Open the root only in this fixture so Playwright can inspect it.
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
        window.testCalls = [];
        window.chrome = { runtime: { async sendMessage(message) {
            window.testCalls.push(message);
            const customer = id => ({ id, name: id === 'C1' ? 'Pelanggan Satu' : 'Pelanggan Dua', status: 'active', pppoeUsername: `ppp-${id}`, acsSerialNumber: `ONU-${id}`, packageName: 'Silver', packageSpeed: 30 });
            let data;
            switch (message.op) {
                case 'me': data = { username: 'admin', permissions: ['view', 'ping', 'reboot', 'map', 'history'] }; break;
                case 'lookup': {
                    const first = message.body.phone === '6281234567890';
                    await new Promise(resolve => setTimeout(resolve, first ? 800 : 20));
                    data = customer(first ? 'C1' : 'C2'); break;
                }
                case 'search': data = [customer('C2')]; break;
                case 'network': data = { status: 'ONLINE', ip: '10.20.30.15', uptime: '12h' }; break;
                case 'traffic': data = { status: 'ONLINE', downloadMbps: 18.42, uploadMbps: 3.21 }; break;
                case 'acs': case 'wifi': data = { status: 'ONLINE', rxPower: -19.8, serial: 'ONU-C2', model: 'F670L', lastInform: new Date().toISOString(), wifi: [{ ssid: 'RIZKITECH-TEST', band: '2.4' }] }; break;
                case 'ping': data = { target: '10.20.30.15', samples: [{ time: '8ms' }] }; break;
                case 'reboot': data = { message: 'Task restart dikirim ke ACS.' }; break;
                case 'history': data = []; break;
                default: data = {};
            }
            return { ok: true, data };
        } } };
    });
    await page.addScriptTag({ content: await readFile(new URL('../../extensions/wa-noc/dist/content.js', import.meta.url), 'utf8') });
    await page.waitForFunction(() => window.testCalls.some(call => call.op === 'lookup'));
    await page.locator('#main header [data-testid="conversation-info-header-chat-title"] span').evaluate(element => { element.textContent = '+62 89876543210'; });
    await page.getByRole('heading', { name: 'Pelanggan Dua', exact: true }).waitFor();
    await page.waitForTimeout(1000);
    assert.equal(await page.getByRole('heading', { name: 'Pelanggan Satu', exact: true }).count(), 0, 'Old lookup must not replace current customer');
    await page.getByText('↓ 18.42', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Periksa ping', exact: true }).click();
    await page.getByText('8ms', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Restart ONU', exact: true }).click();
    await page.getByRole('button', { name: 'Batal', exact: true }).click();
    assert.equal(await page.evaluate(() => window.testCalls.filter(call => call.op === 'reboot').length), 0);
    await page.getByRole('button', { name: 'Restart ONU', exact: true }).click();
    await page.getByRole('button', { name: 'Ya, restart ONU', exact: true }).click();
    await page.getByText('Task restart dikirim ke ACS.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.testCalls.filter(call => call.op === 'reboot').length), 1);
    await page.screenshot({ path: '.tmp-wa-noc-validation/sidebar.png', fullPage: true });
    await page.getByRole('button', { name: 'WIFI', exact: true }).click();
    await page.getByText('RIZKITECH-TEST', { exact: true }).waitFor();
    await page.locator('#main header [data-testid="conversation-info-header-chat-title"] span').evaluate(element => { element.textContent = 'Pelanggan Dua'; });
    await page.getByRole('heading', { name: 'Pelanggan Dua', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Tutup panel', exact: true }).click();
    const before = await page.evaluate(() => window.testCalls.filter(call => call.op === 'traffic').length);
    await page.waitForTimeout(5500);
    assert.equal(await page.evaluate(() => window.testCalls.filter(call => call.op === 'traffic').length), before, 'Collapsed panel must stop traffic polling');
    assert.equal(await page.evaluate(() => document.documentElement.style.marginRight), '');
    assert.deepEqual(errors, []);
    console.log('UI smoke passed: chat race, manual selection, ping, reboot confirmation, WiFi, collapse and polling cleanup.');
} finally { await browser.close(); }
