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
    noticeOptions: { now: () => now, loadCommunity: async () => {
        if (communityFail) throw new Error('offline');
        const data = snapshot(Math.min(now, Date.now()), items);
        data.dataHealth.stale = communityStale; return data;
    }, loadOriginal: async record => ({ ...original(record.id), chineseText: '我们将为所有付费用户重置 Codex 的使用额度。' }) },
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
    assert.equal(await evaluate(windows[0], 'document.querySelector(".details").lastElementChild.dataset.action'), 'trends');
    await until(() => evaluate(windows[0], '!document.querySelector("[data-notice-source]").hidden'));
    await evaluate(windows[0], 'document.querySelector("[data-notice-source]").click()');
    await until(() => opened.length === 1);
    assert.equal(opened.pop(), url('12345678902'), 'panel original link opens the exact displayed post');
    assert.equal(windows.length, 1, 'opening the original must not also open the reader');
    assert.equal(handlers.get('quota:read-notices')().unread, 1, 'opening an original does not acknowledge a reset announcement');
    const panelState = handlers.get('quota:read-notices')();
    for (const kind of ['reset', 'banked']) for (const stage of ['completed', 'in-progress']) {
        const tag = `原帖称${stage === 'completed' ? '已' : ''}${kind === 'reset' ? '重置' : '发卡'}${stage === 'in-progress' ? '中' : ''}`;
        windows[0].webContents.send('quota:notices', { ...panelState, activeNotice: null,
            records: [{ id: 'read-original', kind, stage, verified: true, publishedAt: Date.now() }] });
        await until(() => evaluate(windows[0], `document.querySelector('[data-probability-tag]').textContent === ${JSON.stringify(tag)}`));
        assert.equal(await evaluate(windows[0], `(() => { const el = document.querySelector('[data-probability-tag]'); return el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight; })()`), true, 'source-qualified labels fit the orb without a verification setting');
        assert.match(await evaluate(windows[0], 'document.querySelector("[data-probability-tag]").title'), /已读取/);
    }
    windows[0].webContents.send('quota:notices', { ...panelState, records: [], activeNotice: null });
    await until(() => evaluate(windows[0], 'document.querySelector("[data-notice-source]").hidden'));
    windows[0].webContents.send('quota:notices', { ...panelState, records: [{ id: 'arrival-test', kind: 'arrival', verified: true, stage: 'completed', count: 1, publishedAt: Date.now() }] });
    await until(() => evaluate(windows[0], 'document.querySelector("[data-probability-heading]").textContent === "账户检测"'));
    assert.equal(await evaluate(windows[0], 'document.querySelector("[data-notice-source]").hidden'), true, 'account detections have no X source');
    windows[0].webContents.send('quota:notices', panelState);
    await until(() => evaluate(windows[0], '!document.querySelector("[data-notice-source]").hidden'));
    const summaryFits = await evaluate(windows[0], `(() => {
        const el = document.querySelector('[data-probability-note]');
        const text = el.textContent; el.textContent = '这是一条很长的公告摘要。'.repeat(40);
        const fits = el.clientHeight <= parseFloat(getComputedStyle(el).lineHeight) * 2 + 1 && el.scrollHeight > el.clientHeight;
        el.textContent = text; return fits;
    })()`);
    assert.equal(summaryFits, true, 'long summaries are capped at two lines');
    await capture(windows[0], 'expanded');
    await evaluate(windows[0], 'document.querySelector("[data-action=notice-detail]").click()');
    await until(() => windows.length === 2 && !windows[1].webContents.isLoading());
    await until(() => evaluate(windows[1], 'document.getElementById("status").textContent.includes("已预告")'));
    assert.equal(await evaluate(windows[1], 'document.getElementById("status").textContent'), '已预告 · 原帖已读取');
    assert.equal(handlers.get('quota:read-notices')().unread, 1, 'opening announcements does not mark them read');
    assert.equal(await evaluate(windows[1], 'document.querySelector(".reader-filters").firstElementChild.id'), 'filter-unread');
    assert.equal(await evaluate(windows[1], 'document.querySelector("#coverage, #prediction-history")'), null, 'archive and forecast journal explanations are not shown');
    assert.equal(await evaluate(windows[1], 'document.getElementById("filter-unread").getAttribute("aria-pressed")'), 'true');
    assert.equal(await evaluate(windows[1], 'document.querySelectorAll("#history .history-item").length'), 1, 'the default view excludes read history');
    await evaluate(windows[1], 'document.getElementById("filter-all").click()');
    assert.equal(await evaluate(windows[1], 'document.querySelector(".history-item[aria-pressed=true]").dataset.id'), '12345678902', 'panel summary opens the displayed announcement');
    assert.equal(await evaluate(windows[1], 'document.getElementById("quote-zh").textContent'), '我们将为所有付费用户重置 Codex 的使用额度。');
    assert.equal(await evaluate(windows[1], 'document.getElementById("translation-wrap").hidden'), false);
    assert.equal(await evaluate(windows[1], 'document.getElementById("check").disabled'), true);
    assert.match(await evaluate(windows[1], 'document.getElementById("check").textContent'), /后可检查/);
    assert.equal(await evaluate(windows[1], 'document.getElementById("sync-status").hidden && document.getElementById("sync-reason").hidden'), true, 'successful checks show timestamps without redundant cooling messages');
    const folds = () => evaluate(windows[1], `['account-fold','forecast-fold'].map(id => document.getElementById(id).open)`);
    assert.deepEqual(await folds(), [false, false]);
    assert.equal(await evaluate(windows[1], 'document.querySelector("main > header").nextElementSibling.id'), 'sync-summary');
    assert.equal(await evaluate(windows[1], 'document.getElementById("history").children.length > 0'), true);
    await evaluate(windows[1], `['account-fold','forecast-fold'].forEach(id => document.getElementById(id).open = true)`);
    await evaluate(windows[1], 'window.bodyNode = document.getElementById("quote-zh").firstChild');
    await handlers.get('quota:refresh-now')();
    assert.deepEqual(await folds(), [true, true], 'updates preserve manual expansion');
    assert.equal(await evaluate(windows[1], 'window.bodyNode === document.getElementById("quote-zh").firstChild'), true, 'quota updates preserve selected body nodes');
    await evaluate(windows[1], `['account-fold','forecast-fold'].forEach(id => document.getElementById(id).open = false)`);
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
    await evaluate(windows[1], 'if (!document.getElementById("new-notice").hidden) document.getElementById("new-notice").click()');
    await evaluate(windows[1], 'document.getElementById("mark-all-read").click()');
    await until(() => handlers.get('quota:read-notices')().unread === 0);
    const many = { ...reported, unread: 103 };
    windows[0].webContents.send('quota:notices', many);
    await until(() => evaluate(windows[0], 'document.querySelector("[data-orb-notice]").textContent === "99+"'));
    assert.deepEqual(await folds(), [false, false]);
    assert.deepEqual(await evaluate(windows[1], 'Array.from(document.querySelectorAll("details[open]")).map(element => element.id)'), [], 'new community progress preserves the collapsed explanation');
    assert.equal(await evaluate(windows[1], 'document.body.scrollWidth > innerWidth'), false);
    await capture(windows[1], 'community-completion-explained');
    windows[1].setSize(380, 620);
    await evaluate(windows[1], 'document.querySelector(".history-item").click()');
    assert.equal(await evaluate(windows[1], 'document.body.classList.contains("reader-detail")'), true);
    await evaluate(windows[1], 'document.getElementById("reader-back").click()');
    assert.equal(await evaluate(windows[1], 'document.body.classList.contains("reader-detail")'), false);
    assert.equal(await evaluate(windows[1], 'document.body.scrollWidth > innerWidth'), false);

    console.log(JSON.stringify({ noticesUI: 'passed', announcements: 2, unreadIsolation: true, staleForecastHidden: true, cardArrival: true, originalLinks: opened.length, cardConsumption: 0 }));
    app.quit();
})().catch(error => { console.error(error); app.exit(1); });
