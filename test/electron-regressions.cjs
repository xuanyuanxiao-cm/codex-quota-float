// Offline lifecycle and small-screen regressions. Never connects to the quota service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const { AppServerClient } = require('../dist/app-server-client');
const { startCompanion } = require('../dist/main');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'quota-regressions-')));
let reads = 0, stopped = 0, trayDestroyed = false, trayItems;
AppServerClient.prototype.readRateLimits = async () => {
  reads++;
  return { rateLimits: {
    primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 18000 },
    secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 604800 },
  }, rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'offline-card', status: 'available', expiresAt: Math.floor(Date.now() / 1000) + 3600 }] } };
};
AppServerClient.prototype.stop = async () => { stopped++; };
AppServerClient.prototype.consumeRateLimitResetCredit = async () => { throw Error('Consumption forbidden'); };
const windows = [], handlers = new Map();
const screen = new EventEmitter();
let height = 500;
screen.getDisplayNearestPoint = () => ({ workArea: { x: 0, y: 0, width: 960, height } });
startCompanion({ ...electron, screen,
    tiboOptions: require('./tibo-fixtures.cjs').offlineTibo,
  noticeOptions: { loadCommunity: async () => { throw Error('Offline fixture'); } },
  BrowserWindow: class extends BrowserWindow {
    constructor(options) { super({ ...options, show: false }); windows.push(this); }
  },
  Tray: class {
    setToolTip() {} setContextMenu(items) { trayItems = items; }
    destroy() { trayDestroyed = true; }
  },
  Menu: { buildFromTemplate: items => items },
  ipcMain: { handle(name, fn) { handlers.set(name, fn); ipcMain.handle(name, fn); } },
});
const until = async predicate => {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw Error('Timed out waiting for regression state');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const evaluate = code => windows[0].webContents.executeJavaScript(code);
(async () => {
  await app.whenReady();
  await until(() => windows.length && !windows[0].webContents.isLoading() && reads);
  await evaluate(`document.querySelector('[data-action="toggle-pin"]').click()`);
  await until(() => evaluate(`document.querySelector('.quota-app').classList.contains('is-pinned')`));
  await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const small = await evaluate(`(() => {
    const details = document.querySelector('.details');
    const orb = document.querySelector('.orb').getBoundingClientRect();
    details.scrollTop = details.scrollHeight;
    const button = document.querySelector('[data-action="notices"]').getBoundingClientRect();
    return { scrollable: details.scrollHeight > details.clientHeight,
      overflow: getComputedStyle(details).overflowY, bottom: button.bottom, viewport: innerHeight,
      horizontalOverflow: details.scrollWidth > details.clientWidth,
      orbTop: orb.top, orbBottom: orb.bottom };
  })()`);
  assert.equal(small.scrollable, true);
  assert.equal(small.overflow, 'auto');
  assert.equal(small.horizontalOverflow, false);
  assert.ok(small.bottom <= small.viewport && small.orbTop >= 0 && small.orbBottom < small.viewport);
  const preview = path.join(__dirname, '..', 'release', 'regressions-preview');
  fs.mkdirSync(preview, { recursive: true });
  await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  fs.writeFileSync(path.join(preview, 'small-screen.png'), (await windows[0].webContents.capturePage()).toPNG());
  await evaluate(`document.querySelector('[data-action="reset"]').click()`);
  await until(() => evaluate(`!document.querySelector('[data-credit-picker]').hidden`));
  height = 320;
  screen.emit('display-metrics-changed');
  await until(() => windows[0].getBounds().height <= 321);
  assert.equal(await evaluate(`document.querySelector('[data-action="confirm-reset"]').getBoundingClientRect().bottom <= innerHeight`), true);
  await evaluate(`document.querySelector('[data-action="cancel-reset"]').click()`);
  height = 900;
  screen.emit('display-metrics-changed');
  await until(() => evaluate(`document.querySelector('.details').scrollHeight <= document.querySelector('.details').clientHeight`));
  assert.ok(windows[0].getBounds().height > 500, 'panel can grow again on a taller display');
  await handlers.get('quota:open-trends')();
  await until(() => windows.length === 2 && !windows[1].webContents.isLoading());
  windows[0].close();
  assert.equal(windows[0].isDestroyed(), false, 'close must preserve the main window');
  assert.equal(windows[0].isVisible(), false);
  const previousReads = reads;
  await handlers.get('quota:refresh-now')();
  assert.equal(reads, previousReads + 1);
  assert.ok(handlers.get('quota:read-history')().samples.length);
  trayItems.find(item => item.label === '显示悬浮球').click();
  assert.equal(windows[0].isVisible(), true);
  app.once('will-quit', () => {
    assert.ok(stopped && trayDestroyed);
    assert.ok(windows.every(window => window.isDestroyed()), 'Exit must close every window rather than hide it');
    assert.equal(screen.listenerCount('display-metrics-changed'), 0);
    console.log(JSON.stringify({ electronRegressions: 'passed', smallScreen: 500, closeRestore: true, cardConsumption: 0 }));
  });
  trayItems.find(item => item.label === '退出').click();
})().catch(error => { console.error(error); app.exit(1); });
