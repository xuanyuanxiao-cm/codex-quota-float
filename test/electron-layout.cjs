// Run with Electron, not node:test. Only fake quota data is used; no server/card requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const { AppServerClient } = require('../dist/app-server-client');
const { startCompanion } = require('../dist/main');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'quota-layout-test-')));
const fixture = {
  rateLimits: {
    planType: 'plus',
    primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1800000000 },
    secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1800000000 },
  },
  rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'test-only', status: 'available', expiresAt: 1800000000 }] },
};
AppServerClient.prototype.readRateLimits = async () => fixture;
AppServerClient.prototype.consumeRateLimitResetCredit = async () => { throw new Error('Consumption is forbidden in this test'); };
let quotaWindow;
let updateBackdrop;
const layouts = [];
const shapes = [];
const nativeActions = new Map();
const dragActions = [];
startCompanion({
  tiboOptions: require('./tibo-fixtures.cjs').offlineTibo,
  ...electron,
  noticeOptions: { loadCommunity: async () => { throw Error('Offline fixture'); } },
  BrowserWindow: class extends BrowserWindow {
    constructor(options) {
      super({ ...options, show: process.argv.includes('--interactive') });
      quotaWindow = this;
      this.webContents.on('render-process-gone', (_event, details) => console.error('RENDERER_GONE', details));
    }
    setShape(shape) { shapes.push(shape); super.setShape(shape); }
  },
  Tray: class { setToolTip() {} setContextMenu() {} destroy() {} },
  ipcMain: {
    handle(channel, listener) {
      nativeActions.set(channel, listener);
      ipcMain.handle(channel, (event, ...args) => {
        if (channel === 'quota:set-layout') layouts.push(args[0]);
        if (channel === 'quota:start-drag' || channel === 'quota:stop-drag') dragActions.push(channel);
        if (process.argv.includes('--interactive') && ['quota:set-layout', 'quota:start-drag', 'quota:stop-drag'].includes(channel)) console.log(channel, JSON.stringify(args));
        const result = listener(event, ...args);
        if (channel === 'quota:set-layout' && updateBackdrop) setImmediate(updateBackdrop);
        return result;
      });
    },
  },
});

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const evaluate = (script) => quotaWindow.webContents.executeJavaScript(script);
const hit = (x, y) => shapes.at(-1).some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
const mouseClick = (x, y) => {
  quotaWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  quotaWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
};
// Native Windows bounds can round outward by two DIPs at fractional display scaling.
const matchesHeight = (height) => Math.abs(quotaWindow.getBounds().height - height) <= 2;

(async () => {
  await app.whenReady();
  await waitFor(() => quotaWindow && !quotaWindow.webContents.isLoading(), 'renderer');
  await waitFor(() => layouts.at(-1)?.mode === 'collapsed', 'initial collapsed layout report');
  await waitFor(() => matchesHeight(131), 'probability label height');
  assert.equal(hit(12, 12), false);
  assert.equal(hit(50, 50), true);
  const shadows = await evaluate(`['.orb', '.details'].map(s => getComputedStyle(document.querySelector(s)).boxShadow)`);
  assert.deepEqual(shadows, ['none', 'none'], 'the external shadow must not leave a rectangular halo');
  const background = await evaluate(`getComputedStyle(document.body).backgroundColor`);
  assert.equal(background, 'rgba(0, 0, 0, 0)');

  mouseClick(50, 50);
  await waitFor(() => layouts.at(-1)?.mode === 'normal', 'expanded layout');
  const normalHeight = Math.ceil(await evaluate(`document.querySelector('[data-quota-app]').getBoundingClientRect().height`));
  assert.ok(matchesHeight(normalHeight));
  assert.deepEqual(dragActions, ['quota:start-drag', 'quota:stop-drag'], 'a normal mouse click must release the drag timer');
  assert.ok(normalHeight < 680, 'details including forecast, trends and the independent Tibo entry remain compact');
  assert.equal(hit(140, 60), false);
  assert.equal(hit(140, 105), false);
  assert.equal(hit(140, 180), true);

  assert.equal(await evaluate(`document.querySelector('[data-plan]').textContent`), 'Plus');
  const dualWindows = fixture.rateLimits;
  fixture.rateLimits = { planType: 'pro', primary: { usedPercent: 27, windowDurationMins: 10080, resetsAt: 1800000000 }, secondary: null };
  await nativeActions.get('quota:refresh-now')();
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.equal(await evaluate(`document.querySelector('[data-plan]').textContent`), 'Pro');
  assert.deepEqual(await evaluate(`['[data-window="five-hour"]', '[data-center="five-hour"]', '[data-detail-window="five-hour"]', '.center-divider'].map(s => getComputedStyle(document.querySelector(s)).display)`), ['none', 'none', 'none', 'none']);
  assert.equal(await evaluate(`document.querySelector('[data-center="weekly"]').textContent`), '73%');
  const weeklyHeight = Math.ceil(await evaluate(`document.querySelector('[data-quota-app]').getBoundingClientRect().height`));
  assert.equal(layouts.at(-1).height, weeklyHeight, 'renderer reports the measured weekly-only content height');
  await waitFor(() => matchesHeight(weeklyHeight), 'weekly-only height');
  assert.ok(weeklyHeight < normalHeight, 'missing five-hour row leaves no empty space');
  const previewDir = path.join(__dirname, '..', 'release', 'plan-preview');
  fs.mkdirSync(previewDir, { recursive: true });
  fs.writeFileSync(path.join(previewDir, 'pro-expanded.png'), (await quotaWindow.webContents.capturePage()).toPNG());
  fixture.rateLimits = dualWindows;
  await nativeActions.get('quota:refresh-now')();
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-detail-window="five-hour"]')).display`), 'grid');
  assert.equal(await evaluate(`document.querySelector('[data-plan]').textContent`), 'Plus');
  fs.writeFileSync(path.join(previewDir, 'plus-expanded.png'), (await quotaWindow.webContents.capturePage()).toPNG());

  // Deliver after page load too, so this test does not depend on subscription timing.
  quotaWindow.webContents.send('quota:state', {
    status: 'ready', fiveHour: { remainingPercent: 60, resetsAt: 1800000000 },
    weekly: { remainingPercent: 40, resetsAt: 1800000000 }, resetCredits: fixture.rateLimitResetCredits,
    isResetting: false, lastUpdatedAt: Date.now(), errorMessage: null,
  });
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await waitFor(() => matchesHeight(layouts.at(-1).height), 'settled details before opening picker');
  const normalY = quotaWindow.getBounds().y;
  await evaluate(`document.querySelector('[data-action="reset"]').click()`);
  await waitFor(() => layouts.at(-1)?.mode === 'picker', 'picker layout');
  assert.equal(layouts.at(-1).height, 360);
  assert.ok(matchesHeight(360));
  assert.equal(hit(140, 340), true);
  assert.equal(hit(12, 12), false);
  await evaluate(`document.querySelector('[data-action="cancel-reset"]').click()`);
  await waitFor(() => layouts.at(-1)?.mode === 'normal', 'restored normal layout');
  assert.ok(matchesHeight(Math.ceil(await evaluate(`document.querySelector('[data-quota-app]').getBoundingClientRect().height`))));
  const restoredBounds = quotaWindow.getBounds();
  const restoredArea = electron.screen.getDisplayMatching(restoredBounds).workArea;
  assert.equal(restoredBounds.y, Math.min(normalY, restoredArea.y + restoredArea.height - restoredBounds.height), 'restore keeps the anchor unless the taller panel must fit above the screen edge');
  assert.equal(hit(140, Math.ceil(await evaluate(`document.querySelector('[data-quota-app]').getBoundingClientRect().height`)) + 2), false);

  // A message can change height without a click. ResizeObserver must update the native bounds.
  await evaluate(`document.querySelector('[data-note]').hidden = false; document.querySelector('[data-note]').textContent = '连接失败，请稍后重试。'.repeat(6)`);
  const larger = Math.ceil(await evaluate(`document.querySelector('[data-quota-app]').getBoundingClientRect().height`));
  await waitFor(() => matchesHeight(larger), 'content resize');
  mouseClick(236, 58);
  await waitFor(() => layouts.at(-1)?.mode === 'collapsed', 'collapse after error');
  await waitFor(() => matchesHeight(131), 'collapsed probability label height');
  assert.equal(hit(50, 110), true, 'probability label is clickable');
  await nativeActions.get('quota:show-probability')({}, false);
  await waitFor(() => matchesHeight(100), 'hidden probability label height');
  assert.equal(hit(50, 50), true);
  assert.equal(hit(12, 12), false);
  const image = await quotaWindow.webContents.capturePage();
  const bitmap = image.toBitmap();
  const { width, height } = image.getSize();
  assert.equal(bitmap[(Math.floor(height / 2) * width + 2) * 4 + 3], 0, 'orb padding must be fully transparent');
  assert.ok(bitmap[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3] > 0, 'the orb itself must still be rendered');
  console.log(JSON.stringify({ electronLayout: 'passed', scaleFactor: electron.screen.getPrimaryDisplay().scaleFactor, normalHeight, pickerHeight: 360, cardConsumption: 0 }));
  if (!process.argv.includes('--interactive')) {
    app.quit();
    return;
  }
  // Optional manual native hit-testing: clicks on these markers must reach this lower window.
  const area = electron.screen.getPrimaryDisplay().workArea;
  nativeActions.get('quota:move-to-y')({}, area.y + 150, 50);
  const backdrop = new BrowserWindow({
    x: area.x + area.width - 620, y: Math.max(area.y, quotaWindow.getBounds().y - 80),
    width: 620, height: 560, frame: false, title: 'Quota click-through test', backgroundColor: '#dae8ef',
  });
  await backdrop.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Quota click-through test</title>
    <style>body{margin:0;font:16px sans-serif;background:repeating-conic-gradient(#dae8ef 0 25%,#adc4d3 0 50%) 0/40px 40px}
    header{padding:18px;background:white}button{position:absolute;width:52px;height:24px;transform:translate(-50%,-50%);padding:0;border:1px solid #125780;background:#fff;color:#123}
    #status{position:absolute;bottom:18px;left:18px;background:white;padding:10px}</style>
    <header>离线点击穿透测试：点击 A / B，计数应增加。<br>只使用测试数据，不消耗重置卡。</header>
    <button id="a">A</button><button id="b">B</button><div id="status">计数 0</div>
    <script>let count=0; for(const id of ['a','b']) document.getElementById(id).onclick=()=>{
      document.getElementById('status').textContent='计数 '+(++count)+'，最后点击 '+id.toUpperCase();
      console.log('NATIVE_CLICK '+id+' '+count);
    };</script>`));
  backdrop.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith('NATIVE_CLICK')) console.log(message);
  });
  updateBackdrop = () => {
    if (backdrop.isDestroyed() || quotaWindow.isDestroyed()) return;
    const bounds = quotaWindow.getBounds();
    const base = backdrop.getContentBounds();
    const mode = layouts.at(-1).mode;
    const points = mode === 'collapsed' ? [[14, 14], [5, 50]] : mode === 'normal' ? [[140, 58], [236, 105]] : [[6, 200], [280, 200]];
    const offsets = points.map(([x, y]) => [bounds.x - base.x + x, bounds.y - base.y + y]);
    void backdrop.webContents.executeJavaScript(`['a','b'].forEach((id,i)=>{const e=document.getElementById(id);const p=${JSON.stringify(offsets)}[i];e.style.left=p[0]+'px';e.style.top=p[1]+'px'});`);
  };
  updateBackdrop();
  backdrop.show();
  quotaWindow.setTitle('Quota layout test');
  quotaWindow.on('closed', () => app.quit());
  quotaWindow.showInactive();
  backdrop.on('closed', () => app.quit());
  console.log('INTERACTIVE_READY');
})().catch((error) => { console.error(error); app.exit(1); });
