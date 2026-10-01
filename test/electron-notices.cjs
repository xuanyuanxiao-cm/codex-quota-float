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
const { snapshot, original } = require('./notice-fixtures.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-notices-ui-'));
app.setPath('userData', dir);
let now = Date.now() - HOUR;
const originalTime = now - HOUR;
let items = [{ id: '12345678901', time: originalTime }, ...Array.from({ length: 15 }, (_, i) => ({ id: String(12345678000 + i), time: now - (i + 1) * 48 * HOUR }))];
const url = id => `https://x.com/thsottiaux/status/${id}`;
let remaining = 19;
let weeklyOnly = false;
let credits = ['test-card'];
let communityStale = false, communityFail = false;
AppServerClient.prototype.start = async () => {};
AppServerClient.prototype.stop = async () => {};
AppServerClient.prototype.onRateLimitsUpdated = () => () => {};
AppServerClient.prototype.readRateLimits = async () => ({ accountKey: 'test-account', rateLimits: {
    planType: weeklyOnly ? 'pro' : 'plus',
    primary: weeklyOnly ? null : { usedPercent: 100 - remaining, windowDurationMins: 300, resetsAt: (now + HOUR) / 1000 },
    secondary: { usedPercent: 32, windowDurationMins: 10080, resetsAt: (now + 3 * 24 * HOUR) / 1000 },
}, rateLimitResetCredits: { availableCount: credits.length, credits: credits.map(id => ({ id, status: 'available', expiresAt: (now + 18 * HOUR) / 1000 })) } });
AppServerClient.prototype.consumeRateLimitResetCredit = async () => { throw new Error('Must never consume a card'); };
const windows = [], notifications = [], handlers = new Map(), opened = [];
let shape;
startCompanion({ ...electron,
    tiboOptions: require('./tibo-fixtures.cjs').offlineTibo,
    noticeOptions: { now: () => now, canVerify: () => true, loadCommunity: async () => {
        if (communityFail) throw new Error('offline');
        const data = snapshot(Math.min(now, Date.now()), items);
        data.dataHealth.stale = communityStale; return data;
    }, scrapePage: async address => ({ html: original(address.split('/').at(-1)), translation: { originalText: "We'll reset usage limits for all paid users across Codex.", chineseText: '我们将为所有付费用户重置 Codex 的使用额度。' } }) },
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
    await evaluate(win, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
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
    assert.equal(await evaluate(windows[0], 'document.querySelector("[data-orb-notice]").textContent'), '1');
    assert.equal(await evaluate(windows[0], 'document.querySelector("[data-probability-tag]").textContent'), '重置预告');
    assert.equal(notifications.filter(n => n.options.title.includes('收到')).length, 0);
    await capture(windows[0], 'three-badges');
    await handlers.get('quota:enable-notices')(null, false);
    await evaluate(windows[0], 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    assert.equal(await evaluate(windows[0], 'document.querySelector("[data-orb-notice]").hidden'), false, 'pausing checks preserves unread announcements');
    await handlers.get('quota:enable-notices')(null, true);
    windows[0].webContents.send('quota:open-details', 'details');
    await until(() => evaluate(windows[0], 'document.querySelector(".quota-app").classList.contains("is-pinned")'));
    await evaluate(windows[0], 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const badges = await evaluate(windows[0], `['[data-orb-expiring]', '[data-orb-notice]', '[data-probability-tag]'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })`);
    assert.ok(badges.every(p => shape.some(r => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height)), 'remaining badges stay inside the native shape');
    assert.equal(await evaluate(windows[0], 'document.querySelector(".details").scrollWidth > document.querySelector(".details").clientWidth'), false);
    await capture(windows[0], 'expanded');
    await evaluate(windows[0], 'document.querySelector("[data-action=notices]").click()');
    await until(() => windows.length === 2 && !windows[1].webContents.isLoading());
    await until(() => evaluate(windows[1], 'document.getElementById("status").textContent.includes("已预告")'));
    assert.equal(handlers.get('quota:read-notices')().unread, 1, 'opening announcements does not mark them read');
    assert.equal(await evaluate(windows[1], 'document.getElementById("quote-zh").textContent'), '我们将为所有付费用户重置 Codex 的使用额度。');
    assert.equal(await evaluate(windows[1], 'document.getElementById("translation-wrap").hidden'), false);
    assert.equal(await evaluate(windows[1], 'document.getElementById("check").disabled'), true);
    assert.match(await evaluate(windows[1], 'document.getElementById("check").textContent'), /后可检查/);
    assert.equal(await evaluate(windows[1], 'document.getElementById("sync-status").hidden && document.getElementById("sync-reason").hidden'), true, 'successful checks show timestamps without redundant cooling messages');
    const folds = () => evaluate(windows[1], `['account-fold','history-fold'].map(id => document.getElementById(id).open)`);
    assert.deepEqual(await evaluate(windows[1], 'Array.from(document.querySelectorAll("details[open]")).map(element => element.id)'), ['detail'], 'announcement details open while community explanation stays collapsed');
    assert.equal(await evaluate(windows[1], 'document.querySelector("main > header").nextElementSibling.id'), 'sync-panel');
    assert.equal(await evaluate(windows[1], 'document.getElementById("sync-panel").tagName'), 'SECTION', 'check status is always visible without a disclosure control');
    await evaluate(windows[1], `['forecast-fold','detail'].forEach(id => document.getElementById(id).querySelector('summary').click())`);
    await handlers.get('quota:refresh-now')();
    assert.equal(handlers.get('quota:read-notices')().unread, 1, 'quota refresh leaves announcements unread');
    assert.deepEqual(await evaluate(windows[1], `['forecast-fold','detail'].map(id => document.getElementById(id).open)`), [true, false], 'updates preserve manual choices for every panel');
    await evaluate(windows[1], `['forecast-fold','detail'].forEach(id => document.getElementById(id).querySelector('summary').click())`);
    assert.deepEqual(await folds(), [false, false], 'account and history start collapsed');
    await evaluate(windows[1], `['account-fold','history-fold'].forEach(id => document.getElementById(id).querySelector('summary').click())`);
    await handlers.get('quota:refresh-now')();
    assert.deepEqual(await folds(), [true, true], 'updates preserve manual expansion');
    await evaluate(windows[1], `['account-fold','history-fold'].forEach(id => document.getElementById(id).querySelector('summary').click())`);
    await evaluate(windows[1], 'document.getElementById("original").click()');
    await until(() => opened.length === 1); assert.equal(opened[0], url('12345678902'));
    await handlers.get('quota:open-notice-source')(null, 'https://evil.test'); assert.equal(opened.length, 1);
    await evaluate(windows[1], 'document.getElementById("mark-read").click()');
    await until(() => evaluate(windows[0], 'document.querySelector("[data-orb-notice]").hidden'));
    assert.match(await evaluate(windows[1], 'document.getElementById("source").textContent'), /已手动标记已读/);
    assert.equal(await evaluate(windows[1], 'document.getElementById("forecast-value").textContent'), '重置预告', 'reading does not erase the announcement');
    now += HOUR; items.unshift({ id: '12345678903', time: now - 1000 });
    await handlers.get('quota:refresh-notices')();
    await until(() => evaluate(windows[1], '!document.getElementById("new-notice").hidden'));
    assert.equal(handlers.get('quota:read-notices')().unread, 1, 'viewing an older record leaves the new one unread');
    await evaluate(windows[1], 'document.getElementById("new-notice").click(); document.getElementById("mark-read").click()');
    await until(() => handlers.get('quota:read-notices')().unread === 0);
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
    assert.deepEqual(await folds(), [false, false], 'updates preserve both sections');
    await capture(windows[0], 'expanded');
    await capture(windows[1], 'detail');
    credits.push('new-card'); await handlers.get('quota:refresh-now')();
    await until(() => evaluate(windows[1], 'document.getElementById("account-status").textContent.includes("新增 1 张")'));
    assert.match(await evaluate(windows[1], 'document.getElementById("account-values").textContent'), /重置卡 2/);
    communityStale = true; now += HOUR; await handlers.get('quota:refresh-notices')();
    await until(() => evaluate(windows[1], 'document.getElementById("forecast-value").textContent === "重置预告"'));
    assert.equal(handlers.get('quota:read-notices')().forecast.healthy, false, 'local evidence remains visible when forecast feed is stale');
    await capture(windows[1], 'stale');
    weeklyOnly = true;
    await handlers.get('quota:refresh-now')();
    await until(() => evaluate(windows[1], '!document.getElementById("account-values").textContent.includes("5 Hours")'));
    assert.equal(handlers.get('quota:read-notices')().account.planType, 'pro');
    assert.match(await evaluate(windows[1], 'document.getElementById("account-values").textContent'), /Weekly 68%/);
    assert.doesNotMatch(await evaluate(windows[1], 'document.getElementById("account-status").textContent'), /5 小时/);
    await evaluate(windows[1], 'document.getElementById("enabled").click()');
    await until(() => !handlers.get('quota:read-notices')().enabled);
    assert.equal(await evaluate(windows[1], 'document.getElementById("check").disabled'), true);
    now += HOUR;
    await evaluate(windows[1], `Date.now = () => ${now}; void 0`);
    await until(() => evaluate(windows[1], '!document.getElementById("check").disabled'));
    assert.match(await evaluate(windows[1], 'document.getElementById("sync-reason").textContent'), /仍可手动/);
    communityFail = true;
    await evaluate(windows[1], 'document.getElementById("check").click()');
    await until(() => evaluate(windows[1], 'document.getElementById("check").textContent === "30 秒后可重试"'));
    assert.equal(handlers.get('quota:read-notices')().enabled, false);
    await capture(windows[1], 'retry');
    now += 30000;
    await evaluate(windows[1], `Date.now = () => ${now}; void 0`);
    await until(() => evaluate(windows[1], 'document.getElementById("check").textContent === "立即重试"'));
    communityFail = false; communityStale = false;
    await evaluate(windows[1], 'document.getElementById("check").click()');
    await until(() => evaluate(windows[1], 'document.getElementById("check").textContent === "10 分 00 秒后可检查"'));
    assert.equal(handlers.get('quota:read-notices')().error, null);
    assert.equal(handlers.get('quota:read-notices')().enabled, false);
    await capture(windows[1], 'paused-manual-success');
    const reported = handlers.get('quota:read-notices')();
    reported.forecast.asOf = Date.now();
    reported.activeNotice.stage = 'completed'; reported.activeNotice.verified = false;
    windows[0].webContents.send('quota:notices', reported); windows[1].webContents.send('quota:notices', reported);
    await until(() => evaluate(windows[1], 'document.getElementById("forecast-value").textContent === "重置预告"'));
    assert.equal(await evaluate(windows[0], 'document.querySelector("[data-probability-tag]").textContent'), '重置预告');
    await evaluate(windows[1], 'document.getElementById("mark-all-read").click()');
    await until(() => handlers.get('quota:read-notices')().unread === 0);
    const many = { ...reported, unread: 103 };
    windows[0].webContents.send('quota:notices', many);
    await until(() => evaluate(windows[0], 'document.querySelector("[data-orb-notice]").textContent === "99+"'));
    assert.deepEqual(await folds(), [false, false]);
    assert.deepEqual(await evaluate(windows[1], 'Array.from(document.querySelectorAll("details[open]")).map(element => element.id)'), ['detail'], 'new community progress preserves the collapsed explanation');
    assert.equal(await evaluate(windows[1], 'document.body.scrollWidth > innerWidth'), false);
    await capture(windows[1], 'community-completion-explained');
    console.log(JSON.stringify({ noticesUI: 'passed', announcements: 2, unreadIsolation: true, staleForecastHidden: true, cardArrival: true, originalLinks: opened.length, cardConsumption: 0 }));
    app.quit();
})().catch(error => { console.error(error); app.exit(1); });
