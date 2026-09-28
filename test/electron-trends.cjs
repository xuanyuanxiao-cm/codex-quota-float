const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const { AppServerClient } = require('../dist/app-server-client');
const { startCompanion } = require('../dist/main');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-trends-test-'));
app.setPath('userData', profile);
const now = Date.now(), hour = 3600000, start = now - 24 * hour;
const samples = [];
for (let i = 0; i <= 288; i++) {
  const t = i / 12;
  if (t >= 8 && t < 10) continue;
  const remaining = t < 4 ? 80 - t * 15 : t < 8 ? 100 - (t - 4) * 14 : t < 15 ? 75 - (t - 10) * 13 : 100 - (t - 15) * 9;
  samples.push({ at: start + t * hour, gapBefore: t === 10, fiveHour: { remainingPercent: remaining }, weekly: { remainingPercent: 92 - t }, events: t === 4 ? { fiveHour: 'period' } : t === 15 ? { fiveHour: 'manual' } : {}, manualReset: t === 15 });
}
fs.writeFileSync(path.join(profile, 'codex-quota-history.json'), JSON.stringify({ samples }));
AppServerClient.prototype.readRateLimits = async () => ({ rateLimits: { primary: { usedPercent: 81, windowDurationMins: 300 }, secondary: { usedPercent: 32, windowDurationMins: 10080 } }, rateLimitResetCredits: null });
AppServerClient.prototype.consumeRateLimitResetCredit = async () => { throw new Error('Consumption forbidden'); };
let orb, trend;
let overrideHistory;
const handlers = new Map();
const errors = [];
startCompanion({
  ...electron,
  noticeOptions: { loadCommunity: async () => { throw Error('Offline fixture'); } },
  Notification: undefined,
  BrowserWindow: class extends BrowserWindow {
    constructor(options) {
      super({ ...options, show: false });
      if (options.transparent) orb = this; else trend = this;
      this.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    }
    show() {} focus() {}
  },
  Tray: class { setToolTip() {} setContextMenu() {} destroy() {} },
  ipcMain: { handle(channel, listener) {
    handlers.set(channel, listener);
    ipcMain.handle(channel, (...args) => channel === 'quota:read-history' && overrideHistory ? overrideHistory : listener(...args));
  } },
});
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const evaluate = (code) => trend.webContents.executeJavaScript(code);
(async () => {
  await app.whenReady();
  await waitFor(() => orb && !orb.webContents.isLoading(), 'orb');
  await orb.webContents.executeJavaScript(`document.querySelector('[data-action="trends"]').click()`);
  await waitFor(() => trend && !trend.webContents.isLoading(), 'trend window');
  await waitFor(() => evaluate(`document.querySelectorAll('#chart path').length === 2`), 'two series');
  assert.equal(await evaluate(`document.querySelector('[data-hours="auto"]').getAttribute('aria-pressed')`), 'true');
  await evaluate(`document.querySelector('[data-hours="24"]').click()`);
  assert.ok((await handlers.get('quota:read-history')()).samples.length > 250);
  assert.match(await evaluate(`document.getElementById('events').textContent`), /周期恢复/);
  assert.match(await evaluate(`document.getElementById('events').textContent`), /手动重置/);
  assert.match(await evaluate(`document.getElementById('chart').textContent`), /无记录/);
  const paths = await evaluate(`Array.from(document.querySelectorAll('#chart path'), p => p.getAttribute('d'))`);
  assert.ok((paths[0].match(/M/g) || []).length >= 4, 'gaps and resets split the blue line');
  assert.ok((paths[1].match(/M/g) || []).length >= 2, 'missing observations split the weekly line too');
  assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
  const original = trend;
  handlers.get('quota:open-trends')();
  assert.equal(trend, original, 'reuse the existing history window');
  await evaluate(`document.querySelector('[data-hours="168"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-hours="168"]').getAttribute('aria-pressed')`), 'true');
  await evaluate(`document.querySelector('[data-hours="24"]').click()`);
  const svgBounds = await evaluate(`(() => { const b=document.getElementById('chart').getBoundingClientRect(); return { x:b.x,y:b.y,width:b.width,height:b.height }; })()`);
  const px = Math.round(svgBounds.x + 53 + (svgBounds.width - 110 - 53) * 20 / 24);
  trend.webContents.sendInputEvent({ type: 'mouseMove', x: px, y: Math.round(svgBounds.y + 120) });
  await waitFor(() => evaluate(`!document.getElementById('tooltip').hidden`), 'hover tooltip');
  assert.match(await evaluate(`document.getElementById('tooltip').textContent`), /5 小时剩余/);
  assert.equal(await evaluate(`document.querySelectorAll('[data-threshold]').length`), 2);
  assert.equal(await evaluate(`document.querySelectorAll('[data-latest-value]').length`), 2);
  assert.match(await evaluate(`document.getElementById('events').textContent`), /% →/);
  fs.writeFileSync(path.join(__dirname, '..', 'release', 'trends-preview.png'), (await trend.webContents.capturePage()).toPNG());
  overrideHistory = { samples: samples.map(sample => ({ ...sample, fiveHour: { remainingPercent: null }, events: {} })), now, error: null };
  trend.webContents.send('quota:history-updated');
  await waitFor(() => evaluate(`document.querySelectorAll('#chart path').length === 1`), 'weekly-only series');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('five-hour-legend')).display`), 'none');
  await evaluate(`document.getElementById('chart').dispatchEvent(new MouseEvent('pointermove', { clientX: ${px}, clientY: ${Math.round(svgBounds.y + 120)} }))`);
  assert.doesNotMatch(await evaluate(`document.getElementById('tooltip').textContent`), /5 小时/);
  assert.match(await evaluate(`document.getElementById('tooltip').textContent`), /每周剩余/);
  overrideHistory = { samples: Array.from({ length: 6 }, (_, i) => ({ at: now - (25 - i * 5) * 60000, weekly: { remainingPercent: 100 - i * 16 }, events: {} })), now, error: null };
  trend.webContents.send('quota:history-updated');
  await waitFor(() => evaluate(`document.querySelector('[data-latest-value="weekly"]').textContent.includes('20%')`), 'concentrated usage');
  assert.equal(await evaluate(`document.querySelector('[data-hours="24"]').getAttribute('aria-pressed')`), 'true', 'refresh preserves fixed range');
  await evaluate(`document.querySelector('[data-hours="auto"]').click()`);
  const bounds = await evaluate(`(() => { const p=document.querySelector('#chart path').getBBox(), c=document.getElementById('chart').getBoundingClientRect(); return { path:p.width, plot:c.width-163 }; })()`);
  assert.ok(bounds.path / bounds.plot > .8, '25-minute usage fills the automatic viewport');
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(__dirname, '..', 'release', 'trends-auto-preview.png'), (await trend.webContents.capturePage()).toPNG());
  await evaluate(`document.querySelector('[data-hours="168"]').click()`);
  const lastPoint = await evaluate(`(() => { const p=document.querySelector('[data-latest-point="weekly"]'), b=document.getElementById('chart').getBoundingClientRect(); return { x:b.x+Number(p.getAttribute('cx'))-1,y:b.y+120 }; })()`);
  await evaluate(`document.getElementById('chart').dispatchEvent(new MouseEvent('pointermove', {clientX:${lastPoint.x},clientY:${lastPoint.y}}))`);
  assert.match(await evaluate(`document.getElementById('tooltip').textContent`), /每周剩余/, 'weekly view uses pixel-distance snapping');
  trend.setContentSize(360, 700);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false, 'narrow layout fits');
  overrideHistory = { samples: [], now, error: null };
  trend.webContents.send('quota:history-updated');
  await waitFor(() => evaluate(`!document.getElementById('empty').hidden`), 'empty-history state');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ electronTrends: 'passed', seededSamples: samples.length, historyWindowCount: 1, realCardConsumption: 0 }));
  app.quit();
})().catch((error) => { console.error(error); app.exit(1); });
