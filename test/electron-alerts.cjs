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
const fixture = (remaining, credits = []) => ({
  rateLimits: {
    primary: { usedPercent: 100 - remaining, windowDurationMins: 300, resetsAt: (now + hour) / 1000 },
    secondary: { usedPercent: 32, windowDurationMins: 10080, resetsAt: (now + 6 * 24 * hour) / 1000 },
  },
  rateLimitResetCredits: { availableCount: credits.length, credits },
});
let current = fixture(19);
let consumption = 0;
AppServerClient.prototype.readRateLimits = async () => current;
AppServerClient.prototype.consumeRateLimitResetCredit = async () => { consumption++; throw new Error('Consumption is forbidden'); };
const notifications = [];
const handlers = new Map();
let quotaWindow;
let shape = [];
let trayMenu;
startCompanion({
  ...electron,
  Notification: class extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() {}
    close() {}
  },
  BrowserWindow: class extends BrowserWindow {
    constructor(options) { super({ ...options, show: false }); quotaWindow = this; }
    setShape(value) { shape = value; super.setShape(value); }
    show() {} // Notification activation is tested without interrupting the user's desktop.
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
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].options.title, /额度偏低/);
  assert.equal(await isHidden('[data-orb-expiring]'), true);
  notifications[0].emit('click');
  await waitFor(() => evaluate(`document.querySelector('[data-quota-app]').classList.contains('is-pinned')`), 'notification opens details');
  await save('01-low');
  await refresh(fixture(18));
  assert.equal(notifications.length, 1);
  await refresh(fixture(0));
  assert.equal(notifications.length, 2);
  await refresh(fixture(100));
  assert.equal(notifications.length, 3);
  assert.match(notifications.at(-1).options.title, /额度已恢复/);
  assert.equal(await isHidden('[data-orb-recovered]'), false);
  assert.equal(await isHidden('[data-orb-low]'), true);
  await save('02-recovered');

  const credits = [{ id: 'soon', status: 'available', expiresAt: (now + 18 * hour) / 1000 }];
  await refresh(fixture(72, credits));
  assert.match(notifications.at(-1).options.title, /重置卡即将过期/);
  assert.equal(await isHidden('[data-orb-expiring]'), false);
  await save('03-expiring');
  notifications.at(-1).emit('click');
  await waitFor(async () => !await isHidden('[data-credit-picker]'), 'expiry notification opens picker');
  assert.equal(consumption, 0);
  assert.match(await evaluate(`document.querySelector('.credit-expiring').textContent`), /即将过期/);
  await save('04-picker');
  await evaluate(`document.querySelector('[data-action="cancel-reset"]').click()`);
  await refresh(fixture(19, credits));
  assert.equal(await isHidden('[data-orb-low]'), false);
  assert.equal(await isHidden('[data-orb-expiring]'), false);
  assert.equal(await isHidden('[data-orb-recovered]'), true);
  await save('05-combined');
  for (const selector of ['[data-orb-low]', '[data-orb-expiring]']) {
    const rect = await evaluate(`(() => {const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };})()`);
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    assert.ok(shape.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height), `${selector} must be inside native shape`);
  }
  const colors = await evaluate(`['[data-orb-low]', '[data-orb-recovered]', '[data-orb-expiring]'].map(s => getComputedStyle(document.querySelector(s)).backgroundColor)`);
  assert.deepEqual(colors, ['rgb(250, 204, 21)', 'rgb(52, 211, 153)', 'rgb(249, 115, 22)']);
  assert.equal(await evaluate(`document.querySelector('[data-details]').scrollWidth > document.querySelector('[data-details]').clientWidth`), false);
  const contentHeight = Math.ceil(await evaluate(`document.querySelector('[data-quota-app]').getBoundingClientRect().height`));
  assert.ok(Math.abs(quotaWindow.getBounds().height - contentHeight) <= 1, 'native height matches content within fractional-DPI rounding');
  trayMenu.find((item) => item.label === '桌面通知').click();
  assert.equal(trayMenu.find((item) => item.label === '桌面通知').checked, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'codex-quota-float-alerts.json'), 'utf8')).enabled, false);
  const count = notifications.length;
  await refresh(fixture(9, credits));
  assert.equal(notifications.length, count);
  await refresh(fixture(9, []));
  assert.equal(await isHidden('[data-orb-expiring]'), true);
  assert.equal(consumption, 0);
  console.log(JSON.stringify({ electronAlerts: 'passed', notifications: count, colors, cardConsumption: consumption }));
  app.quit();
})().catch((error) => { console.error(error); app.exit(1); });
