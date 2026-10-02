const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const { AppServerClient } = require('../dist/app-server-client');
const { startCompanion } = require('../dist/main');
const { snapshot } = require('./notice-fixtures.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-tibo-ui-'));
app.setPath('userData', profile);
let now = Date.now() - 3600000;
const record = (id, text = 'A product update.') => ({ id, url: `https://x.com/thsottiaux/status/${id}`, author: 'thsottiaux', type: 'post', publishedAt: now - 10000, originalText: text });
let rows = [record('12345678901')];
AppServerClient.prototype.start = async () => {};
AppServerClient.prototype.stop = async () => {};
AppServerClient.prototype.onRateLimitsUpdated = () => () => {};
AppServerClient.prototype.readRateLimits = async () => ({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 }, secondary: { usedPercent: 32, windowDurationMins: 10080 } }, rateLimitResetCredits: null });
AppServerClient.prototype.consumeRateLimitResetCredit = async () => { throw Error('Must not consume credits'); };
const windows = [], handlers = new Map(), opened = [], errors = [];
startCompanion({ ...electron,
    noticeOptions: { now: () => now, canVerify: () => false, loadCommunity: async () => snapshot(now, []) },
    tiboOptions: { now: () => now, source: { source: 'fixture', configured: () => true, canTranslate: () => true,
        loadPage: async () => ({ records: rows, cursor: null, coverage: '离线测试数据' }),
        hydrate: async r => ({ originalText: r.originalText, chineseText: r.originalText.includes('reset') ? '我们将为所有付费用户重置 Codex 使用额度。' : '一条产品更新。' }) } },
    BrowserWindow: class extends BrowserWindow {
        constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }); windows.push(this); this.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); }); }
        show() {} focus() {}
    },
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); ipcMain.handle(channel, handler); } },
    shell: { openExternal: async url => { opened.push(url); } },
    Tray: class { setToolTip() {} setContextMenu() {} destroy() {} }, Menu: { buildFromTemplate: items => items },
});
const evaluate = (win, code) => win.webContents.executeJavaScript(code);
async function until(predicate) { const end = Date.now() + 8000; while (!await predicate()) { if (Date.now() > end) throw Error('Timed out'); await new Promise(r => setTimeout(r, 30)); } }
(async () => {
    await app.whenReady(); await until(() => handlers.has('quota:read-tibo') && handlers.get('quota:read-tibo')().lastSuccessAt && !handlers.get('quota:read-tibo')().loading);
    assert.equal(handlers.get('quota:read-tibo')().unread, 0);
    now += 1800000; rows.push(record('12345678902'), record('12345678903'), record('12345678904', "We'll reset usage limits for all paid users across Codex."));
    await handlers.get('quota:refresh-tibo')();
    await until(() => evaluate(windows[0], 'document.querySelector("[data-tibo-badge]").textContent === "3"'));
    assert.equal(handlers.get('quota:read-notices')().unread, 1);
    handlers.get('quota:open-tibo')(); await until(() => windows[1] && !windows[1].webContents.isLoading());
    await until(() => evaluate(windows[1], 'document.querySelectorAll("#feed-list .history-item").length === 4'));
    assert.match(await evaluate(windows[1], 'document.querySelector(".post-body").textContent'), /中文|产品|额度/);
    await evaluate(windows[1], 'document.querySelector(".feed-post details").open=true');
    assert.equal(handlers.get('quota:read-tibo')().unread, 3);
    await evaluate(windows[1], 'Array.from(document.querySelectorAll("#feed-list .history-item")).find(b => b.dataset.id === "12345678904").click()');
    await until(() => handlers.get('quota:read-tibo')().unread === 2);
    assert.equal(handlers.get('quota:read-notices')().unread, 1, 'reading a related Tibo post does not acknowledge the announcement');
    await evaluate(windows[1], 'Array.from(document.querySelectorAll("#feed-list .history-item")).find(b => b.dataset.id === "12345678904").click()');
    assert.equal(handlers.get('quota:read-tibo')().unread, 2, 'clicking an already-read post leaves other posts unread');
    await evaluate(windows[1], 'document.getElementById("filter-unread").click(); Array.from(document.querySelectorAll("#feed-list .history-item")).find(b => b.dataset.id === "12345678903").click()');
    await until(() => handlers.get('quota:read-tibo')().unread === 1);
    await until(() => evaluate(windows[1], 'document.querySelectorAll("#feed-list .history-item").length === 1'));
    assert.equal(await evaluate(windows[1], 'document.getElementById("post-detail").dataset.id'), '12345678903', 'read detail stays visible after leaving the unread list');
    await evaluate(windows[1], 'document.getElementById("filter-all").click()');
    await evaluate(windows[1], 'document.getElementById("read-all").click()');
    await until(() => handlers.get('quota:read-tibo')().unread === 0);
    assert.equal(handlers.get('quota:read-notices')().unread, 1);
    await evaluate(windows[1], 'document.getElementById("open-source").click()'); await until(() => opened.length === 1);
    assert.match(opened[0], /^https:\/\/x.com\/thsottiaux\/status\//);
    await evaluate(windows[1], 'document.getElementById("post-original-wrap").open = true; window.bodyNode = document.getElementById("post-body").firstChild');
    now += 1800000; rows.push(record('12345678905'));
    await handlers.get('quota:refresh-tibo')();
    await until(() => evaluate(windows[1], '!document.getElementById("new-posts").hidden'));
    assert.equal(await evaluate(windows[1], 'document.querySelectorAll("#feed-list .history-item").length'), 4);
    assert.equal(await evaluate(windows[1], 'window.bodyNode === document.getElementById("post-body").firstChild && document.getElementById("post-original-wrap").open'), true);
    await evaluate(windows[1], 'document.getElementById("read-all").click()');
    assert.equal(handlers.get('quota:read-tibo')().unread, 1, 'a pending new arrival is not acknowledged by bulk read');
    await evaluate(windows[1], 'document.getElementById("new-posts").click()');
    await until(() => evaluate(windows[1], 'document.querySelectorAll("#feed-list .history-item").length === 5'));
    await until(() => handlers.get('quota:read-tibo')().unread === 0);
    await evaluate(windows[1], 'document.getElementById("nav-notices").click()'); await until(() => evaluate(windows[1], 'document.body.dataset.feedPage === "notices"'));
    await evaluate(windows[1], 'document.getElementById("nav-tibo").click()'); await until(() => evaluate(windows[1], 'document.body.dataset.feedPage === "tibo"'));
    await until(() => evaluate(windows[1], 'document.querySelectorAll("#feed-list .history-item").length === 5'));
    windows[1].setSize(380, 620); await new Promise(r => setTimeout(r, 150));
    assert.equal(await evaluate(windows[1], 'document.body.scrollWidth > innerWidth'), false);
    windows[0].webContents.send('quota:tibo', { ...handlers.get('quota:read-tibo')(), unread: 103 });
    await until(() => evaluate(windows[0], 'document.querySelector("[data-tibo-badge]").textContent === "99+"'));
    assert.equal(await evaluate(windows[0], 'document.querySelector("[data-orb-notice]").textContent'), '1');
    const dest = path.join(__dirname, '..', 'release', 'tibo-preview'); fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'tibo-offline.png'), (await windows[1].webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ tiboUI: 'passed', translated: true, unreadIsolation: true, narrowLayout: true, externalLinks: opened.length }));
    app.quit();
})().catch(error => { console.error(error); app.exit(1); });
