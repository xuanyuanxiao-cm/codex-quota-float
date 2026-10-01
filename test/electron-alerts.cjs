// Offline end-to-end checks: real Electron renderer/window, fake quota and notifications.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const { AppServerClient } = require('../dist/app-server-client');
const { startCompanion } = require('../dist/main');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-alerts-test-'));
app.setPath('userData', profile);
const now = Date.now();
const hour = 3600000;
const fixture = (remaining, credits = [], weekly = 68) => ({
  rateLimits: {
    primary: { usedPercent: 100 - remaining, windowDurationMins: 300, resetsAt: (now + hour) / 1000 },
    secondary: { usedPercent: 100 - weekly, windowDurationMins: 10080, resetsAt: (now + 6 * 24 * hour) / 1000 },
  },
  rateLimitResetCredits: { availableCount: credits.length, credits },
});
let current = fixture(19);
let consumption = 0;
let fail = false, push;
AppServerClient.prototype.onRateLimitsUpdated = listener => { push = listener; return () => {}; };
AppServerClient.prototype.readRateLimits = async () => { if (fail) throw Error('Offline fixture'); return current; };
AppServerClient.prototype.consumeRateLimitResetCredit = async () => { consumption++; throw new Error('Consumption is forbidden'); };
const notifications = [];
const handlers = new Map();
let quotaWindow;
let shape = [];
let trayMenu;
startCompanion({
  tiboOptions: require('./tibo-fixtures.cjs').offlineTibo,
  ...electron,
  noticeOptions: { loadCommunity: async () => { throw Error('Offline fixture'); } },
  Notification: class extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() {}
    close() {}
  },
  BrowserWindow: class extends BrowserWindow {
    constructor(options) { super({ ...options, show: false }); quotaWindow = this; }
    setShape(value) { shape = value; super.setShape(value); }
    show() {} // Keep offline checks from interrupting the user's desktop.
    focus() {}
  },
  Tray: class { setToolTip() {} setContextMenu(menu) { trayMenu = menu; } destroy() {} },
  Menu: { buildFromTemplate: (items) => items },
  ipcMain: { handle(channel, listener) { handlers.set(channel, listener); ipcMain.handle(channel, listener); } },
});
const evaluate = (script) => quotaWindow.webContents.executeJavaScript(script);
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const rendered = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
const refresh = async (value) => { current = value; await handlers.get('quota:refresh-now')(); await rendered(); };
const isHidden = (selector) => evaluate(`document.querySelector('${selector}').hidden`);
const save = async (name) => {
  await rendered();
  fs.mkdirSync(path.join(__dirname, '..', 'release', 'alerts-preview'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'release', 'alerts-preview', name + '.png'), (await quotaWindow.webContents.capturePage()).toPNG());
};

(async () => {
  await app.whenReady();
  await waitFor(() => quotaWindow && !quotaWindow.webContents.isLoading(), 'renderer');
  await waitFor(async () => !await isHidden('[data-orb-low]'), 'initial low badge');
  const color = selector => evaluate(`getComputedStyle(document.querySelector('${selector}')).backgroundColor`);
  assert.equal(await color('[data-orb-low]'), 'rgb(250, 204, 21)');
  assert.equal(await isHidden('[data-alert-summary]'), false);
  assert.ok(Math.abs(quotaWindow.getBounds().width - 286) <= 2, 'summary width respects native DPI rounding');
  await save('01-low');
  push(fixture(18).rateLimits);
  await rendered();
  assert.equal(await isHidden('[data-orb-low]'), false, 'push retains pending badge');
  fail = true;
  await handlers.get('quota:refresh-now')(); await rendered();
  assert.equal(await isHidden('[data-orb-low]'), false, 'failed refresh retains pending badge');
  assert.match(await evaluate(`document.querySelector('[data-alert-summary]').textContent`), /更新失败/);
  fail = false;
  await refresh(fixture(18));
  assert.equal(await isHidden('[data-orb-low]'), true, 'next full refresh clears old threshold');
  assert.equal(await isHidden('[data-alert-summary]'), true);
  await refresh(fixture(8));
  assert.equal(await color('[data-orb-low]'), 'rgb(251, 146, 60)');
  await refresh(fixture(0));
  assert.equal(await color('[data-orb-low]'), 'rgb(248, 113, 113)');
  await refresh(fixture(100, [], 8));
  assert.equal(await isHidden('[data-orb-recovered]'), true);
  assert.equal(await color('[data-orb-low]'), 'rgb(251, 146, 60)');
  assert.match(await evaluate(`document.querySelector('[data-alert-summary]').textContent`), /5 小时额度已恢复.*周额度.*8%/);
  assert.match(await evaluate(`document.querySelector('.orb').title`), /已恢复.*周额度/);
  await save('02-partial-recovery');
  await refresh(fixture(0, [], 68));
  await refresh(fixture(100));
  assert.equal(await isHidden('[data-orb-recovered]'), false);
  assert.equal(await isHidden('[data-orb-low]'), true);
  assert.equal(await color('[data-orb-recovered]'), 'rgb(52, 211, 153)');
  await save('03-recovered');

  const credits = [{ id: 'soon', status: 'available', expiresAt: (now + 18 * hour) / 1000 }];
  await refresh(fixture(19, credits, 18));
  assert.equal(await isHidden('[data-orb-low]'), false);
  assert.equal(await isHidden('[data-orb-expiring]'), false);
  await save('04-combined');
  for (const selector of ['[data-orb-low]', '[data-orb-expiring]', '[data-alert-summary]']) {
    const rect = await evaluate(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; })()`);
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    assert.ok(shape.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height), `${selector} must be inside native shape`);
  }
  const notice = { id: 'preview-notice', revision: 1, kind: 'reset', stage: 'announced', verified: true, read: false, publishedAt: now, text: 'An upcoming reset.' };
  const noticeState = { records: [notice], unread: 1, lastSuccessAt: now, loading: false, enabled: true, showProbability: false };
  const sendNotices = async state => { quotaWindow.webContents.send('quota:notices', state); await rendered(); };
  await sendNotices(noticeState);
  assert.match(await evaluate(`document.querySelector('[data-alert-summary]').textContent`), /1 条未读/);
  assert.equal(await evaluate(`document.querySelector('[data-orb-notice]').textContent`), '1');
  await evaluate(`document.querySelector('.orb').dispatchEvent(new PointerEvent('pointerenter'))`);
  assert.equal(await isHidden('[data-alert-summary]'), true, 'hover uses native tooltip, not the reminder panel');
  assert.match(await evaluate(`document.querySelector('.orb').title`), /额度偏低.*\n.*额度偏低.*\n.*重置卡.*\n.*1 条未读/);
  await evaluate(`document.querySelector('.orb').dispatchEvent(new PointerEvent('pointerleave'))`);
  assert.equal(await isHidden('[data-alert-summary]'), false, 'remaining display time resumes after hover');
  await new Promise(resolve => setTimeout(resolve, 15500));
  await rendered();
  assert.equal(await isHidden('[data-alert-summary]'), true, 'text expires after 15 seconds');
  assert.equal(await isHidden('[data-orb-low]'), false, 'timeout keeps quota badge');
  assert.equal(await isHidden('[data-orb-expiring]'), false, 'timeout keeps credit badge');
  assert.equal(await isHidden('[data-orb-notice]'), false, 'timeout keeps unread badge');
  assert.ok(Math.abs(quotaWindow.getBounds().width - 100) <= 2, 'timeout shrinks native window');
  await sendNotices(noticeState);
  push(fixture(18, credits, 18).rateLimits); await rendered();
  assert.equal(await isHidden('[data-alert-summary]'), true, 'repeated notices and ordinary percentage changes do not replay text');
  await sendNotices({ ...noticeState, unread: 2, records: [notice, { ...notice, id: 'new-notice' }] });
  assert.equal(await isHidden('[data-alert-summary]'), false, 'new unread identity starts a new interval');
  await sendNotices({ ...noticeState, unread: 2, records: [notice, { ...notice, id: 'new-notice' }], lastSuccessAt: now + 1 });
  assert.equal(await isHidden('[data-alert-summary]'), true, 'successful notice check clears text without marking read');
  assert.equal(await evaluate(`document.querySelector('[data-orb-notice]').textContent`), '2');
  await evaluate(`document.querySelector('.orb').dispatchEvent(new PointerEvent('pointerenter'))`);
  assert.equal(await isHidden('[data-alert-summary]'), true, 'hover never reopens expired panel');
  assert.match(await evaluate(`document.querySelector('.orb').title`), /2 条未读/);
  await evaluate(`document.querySelector('.orb').dispatchEvent(new PointerEvent('pointerleave'))`);
  await sendNotices({ ...noticeState, unread: 0, records: [{ ...notice, read: true }], lastSuccessAt: now + 1 });
  assert.equal(await isHidden('[data-orb-notice]'), true);
  await evaluate(`document.querySelector('[data-orb-low]').click()`);
  await waitFor(() => isHidden('[data-orb-low]'), 'quota acknowledged');
  assert.equal(await isHidden('[data-orb-expiring]'), false, 'quota details leave credit reminder');
  assert.equal(await isHidden('[data-alert-window="fiveHour"]'), false, 'underlying low state remains in details');
  await evaluate(`document.querySelector('[data-orb-expiring]').click()`);
  await waitFor(async () => !await isHidden('[data-credit-picker]'), 'credit badge opens picker');
  await waitFor(() => isHidden('[data-orb-expiring]'), 'credit acknowledged');
  assert.equal(consumption, 0);
  assert.match(await evaluate(`document.querySelector('.credit-expiring').textContent`), /即将过期/);
  await save('05-picker');
  await evaluate(`document.querySelector('[data-action="cancel-reset"]').click()`);
  const more = [...credits, { ...credits[0], id: 'second' }];
  await refresh(fixture(8, more, 18));
  assert.equal(await isHidden('[data-orb-low]'), false);
  await evaluate(`document.querySelector('[data-orb-expiring]').click()`);
  await waitFor(() => isHidden('[data-orb-expiring]'), 'second credit acknowledged');
  assert.equal(await isHidden('[data-orb-low]'), false, 'credit details leave quota reminder');
  await evaluate(`document.querySelector('[data-action="cancel-reset"]').click()`);
  await refresh(fixture(8, more, 18));
  assert.equal(await isHidden('[data-orb-low]'), true);
  assert.equal(await isHidden('[data-orb-expiring]'), true);
  assert.equal(await isHidden('[data-action="expiring-credits"]'), false, 'current card expiry stays in details');
  assert.equal(await evaluate(`document.querySelector('[data-details]').scrollWidth > document.querySelector('[data-details]').clientWidth`), false);
  const contentHeight = Math.ceil(await evaluate(`document.querySelector('[data-quota-app]').getBoundingClientRect().height`));
  assert.ok(Math.abs(quotaWindow.getBounds().height - contentHeight) <= 2, `native height ${quotaWindow.getBounds().height}, content ${contentHeight}`);
  assert.equal(trayMenu.some(item => item.label === '桌面通知'), false);
  assert.equal(notifications.length, 0);
  assert.equal(consumption, 0);
  console.log(JSON.stringify({ electronAlerts: 'passed', notifications: 0, independentDismissal: true, cardConsumption: 0 }));
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
