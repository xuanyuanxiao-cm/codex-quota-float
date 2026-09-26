const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const { AppServerClient } = require('../dist/app-server-client');
const { startCompanion } = require('../dist/main');
const { HOUR } = require('../dist/notices');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-notices-ui-'));
app.setPath('userData', dir);
let now = Date.now() - HOUR;
const originalTime = now - HOUR;
let items = [{ id: '12345678901', time: originalTime }, ...Array.from({ length: 15 }, (_, i) => ({ id: String(12345678000 + i), time: now - (i + 1) * 48 * HOUR }))];
const postText = "We'll reset usage limits for all paid users across Codex.";
const url = id => `https://x.com/thsottiaux/status/${id}`;
let remaining = 19;
let weeklyOnly = false;
AppServerClient.prototype.start = async () => {};
AppServerClient.prototype.stop = async () => {};
AppServerClient.prototype.onRateLimitsUpdated = () => () => {};
AppServerClient.prototype.readRateLimits = async () => ({ rateLimits: {
    planType: weeklyOnly ? 'pro' : 'plus',
    primary: weeklyOnly ? null : { usedPercent: 100 - remaining, windowDurationMins: 300, resetsAt: (now + HOUR) / 1000 },
    secondary: { usedPercent: 32, windowDurationMins: 10080, resetsAt: (now + 3 * 24 * HOUR) / 1000 },
}, rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'test-card', status: 'available', expiresAt: (now + 18 * HOUR) / 1000 }] } });
AppServerClient.prototype.consumeRateLimitResetCredit = async () => { throw new Error('Must never consume a card'); };
const windows = [], notifications = [], handlers = new Map(), opened = [];
let shape;
startCompanion({ ...electron,
    noticeOptions: { now: () => now, scrapePage: async address => address.endsWith('/timeline') ?
        '<h1>Tibo desk</h1>' + items.map(r => `<article><time datetime="${new Date(r.time).toISOString()}"></time><blockquote>${postText}</blockquote><a href="${url(r.id)}">Original</a></article>`).join('') :
        `<p>Author: Tibo @thsottiaux URL: ${address}</p><h2>Post</h2><p>${postText}</p><h2>Thread</h2>` },
    BrowserWindow: class extends BrowserWindow {
        constructor(options) { super({ ...options, show: false }); windows.push(this); }
        setShape(value) { shape = value; super.setShape(value); }
        show() {} focus() {}
    },
    ipcMain: { handle(channel, fn) { handlers.set(channel, fn); ipcMain.handle(channel, fn); } },
    shell: { openExternal: async address => opened.push(address) },
    Tray: class { setToolTip() {} setContextMenu() {} destroy() {} },
    Menu: { buildFromTemplate: items => items },
    Notification: class extends EventEmitter {
        static isSupported() { return true; }
        constructor(options) { super(); this.options = options; notifications.push(this); }
        show() {} close() {}
    },
});
async function until(predicate) {
    const deadline = Date.now() + 5000;
    while (!await predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 25)); }
}
const evaluate = (win, code) => win.webContents.executeJavaScript(code);
async function capture(win, name) {
    const dest = path.join(__dirname, '..', 'release', 'notices-preview'); fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
(async () => {
    await app.whenReady();
    await until(() => windows.length && !windows[0].webContents.isLoading() && handlers.has('quota:read-notices'));
    await until(() => handlers.get('quota:read-notices')().lastSuccessAt);
    assert.equal(notifications.filter(n => n.options.title.includes('收到')).length, 0);
    now += HOUR; items.unshift({ id: '12345678902', time: now - 1000 });
    await handlers.get('quota:refresh-notices')();
    assert.equal(handlers.get('quota:read-notices')().error, null);
    await until(() => evaluate(windows[0], '!document.querySelector("[data-orb-notice]").hidden'));
    assert.equal(notifications.filter(n => n.options.title.includes('收到')).length, 1);
    windows[0].webContents.send('quota:open-details', 'details');
    await until(() => evaluate(windows[0], 'document.querySelector(".quota-app").classList.contains("is-pinned")'));
    await evaluate(windows[0], 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const badges = await evaluate(windows[0], `['[data-orb-low]', '[data-orb-expiring]', '[data-orb-notice]', '[data-probability-tag]'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })`);
    assert.ok(badges.every(p => shape.some(r => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height)), 'all three badges remain inside the native shape');
    assert.equal(await evaluate(windows[0], 'document.querySelector(".details").scrollWidth > document.querySelector(".details").clientWidth'), false);
    await capture(windows[0], 'expanded');
    await evaluate(windows[0], 'document.querySelector("[data-action=notices]").click()');
    await until(() => windows.length === 2 && !windows[1].webContents.isLoading());
    await until(() => evaluate(windows[1], 'document.getElementById("status").textContent.includes("已宣布")'));
    const folds = () => evaluate(windows[1], `['account-fold','history-fold'].map(id => document.getElementById(id).open)`);
    assert.deepEqual(await folds(), [false, false], 'account and history start collapsed');
    await evaluate(windows[1], `['account-fold','history-fold'].forEach(id => document.getElementById(id).querySelector('summary').click())`);
    await handlers.get('quota:refresh-now')();
    assert.deepEqual(await folds(), [true, true], 'updates preserve manual expansion');
    await evaluate(windows[1], `['account-fold','history-fold'].forEach(id => document.getElementById(id).querySelector('summary').click())`);
    await evaluate(windows[1], 'document.getElementById("original").click()');
    await until(() => opened.length === 1); assert.equal(opened[0], url('12345678902'));
    await handlers.get('quota:open-notice-source')(null, 'https://evil.test'); assert.equal(opened.length, 1);
    await handlers.get('quota:read-all-notices')();
    await until(() => evaluate(windows[0], 'document.querySelector("[data-orb-notice]").hidden'));
    await until(() => evaluate(windows[1], '/^\\d+%$/.test(document.getElementById("forecast-value").textContent)'));
    await evaluate(windows[1], 'document.getElementById("show-probability").click()');
    await until(() => evaluate(windows[0], 'document.querySelector("[data-probability-tag]").hidden'));
    assert.equal(handlers.get('quota:read-notices')().showProbability, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'codex-reset-notices.json'), 'utf8')).showProbability, false);
    await evaluate(windows[1], 'document.getElementById("show-probability").click()');
    await until(() => evaluate(windows[0], '!document.querySelector("[data-probability-tag]").hidden'));
    remaining = 0; await handlers.get('quota:refresh-now')();
    await until(() => handlers.get('quota:read-notices')().account?.fiveHour === 0);
    remaining = 100; await handlers.get('quota:refresh-now')();
    await until(() => evaluate(windows[1], 'document.getElementById("account-status").classList.contains("recovered") && document.getElementById("account-values").textContent.includes("100%")'));
    assert.equal(await evaluate(windows[1], 'document.body.scrollWidth > innerWidth'), false);
    assert.deepEqual(await folds(), [false, false], 'updates never auto-expand either section');
    assert.equal(await evaluate(windows[1], 'document.documentElement.scrollHeight > innerHeight'), false, 'default detail fits without scrolling');
    await capture(windows[0], 'expanded');
    await capture(windows[1], 'detail');
    weeklyOnly = true;
    await handlers.get('quota:refresh-now')();
    await until(() => evaluate(windows[1], '!document.getElementById("account-values").textContent.includes("5 Hours")'));
    assert.equal(handlers.get('quota:read-notices')().account.planType, 'pro');
    assert.match(await evaluate(windows[1], 'document.getElementById("account-values").textContent'), /Weekly 68%/);
    assert.doesNotMatch(await evaluate(windows[1], 'document.getElementById("account-status").textContent'), /5 小时/);
    await evaluate(windows[1], 'document.getElementById("enabled").click()');
    await until(() => !handlers.get('quota:read-notices')().enabled);
    assert.equal(await evaluate(windows[1], 'document.getElementById("check").disabled'), true);
    console.log(JSON.stringify({ noticesUI: 'passed', announcements: 1, collapsedSections: 2, probability: handlers.get('quota:read-notices')().forecast.percent, originalLinks: opened.length, cardConsumption: 0 }));
    app.quit();
})().catch(error => { console.error(error); app.exit(1); });
