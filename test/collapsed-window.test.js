const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { COLLAPSED_WINDOW_SIZE, rightDockBounds } = require('../dist/window-position');
const { AppServerClient } = require('../dist/app-server-client');
const { startCompanion } = require('../dist/main');

test('collapsed window covers only the orb and keeps its center stationary', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const normal = rightDockBounds(workArea, 'normal', 320);
  const collapsed = rightDockBounds(workArea, 'collapsed', 320);

  assert.deepEqual(COLLAPSED_WINDOW_SIZE, { width: 100, height: 100 });
  assert.deepEqual(collapsed, { x: 1812, y: 328, width: 100, height: 100 });
  assert.equal(normal.x + normal.width - 50, collapsed.x + collapsed.width - 50);
  assert.equal(normal.y + 58, collapsed.y + 50);
});

test('native bounds and hit regions follow normal, picker, collapsed, and edge layouts', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-window-test-'));
  const handlers = new Map();
  const appEvents = new Map();
  let window;
  let cursor = { x: 1800, y: 600 };
  const originalStart = AppServerClient.prototype.start;
  AppServerClient.prototype.start = async () => { throw new Error('offline test'); };

  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.bounds = { x: 500, y: 200, width: options.width, height: options.height };
      this.webContents = { send() {}, on() {} };
      window = this;
    }
    loadFile() { return Promise.resolve(); }
    setMovable() {}
    setBounds(bounds) { this.bounds = { ...bounds }; }
    setShape(shape) { this.shape = shape; }
    getBounds() { return this.bounds; }
    on() {}
  }
  class FakeTray {
    setToolTip() {}
    setContextMenu() {}
    destroy() {}
  }

  try {
    startCompanion({
      app: {
        setAppUserModelId() {},
        on(name, listener) { appEvents.set(name, listener); },
        whenReady: () => Promise.resolve(),
        getPath: () => userData,
      },
      BrowserWindow: FakeWindow,
      Tray: FakeTray,
      ipcMain: { handle(name, handler) { handlers.set(name, handler); } },
      screen: {
        getCursorScreenPoint: () => cursor,
        getDisplayNearestPoint: (point) => ({ workArea: point.x >= 1920
          ? { x: 1920, y: 0, width: 1600, height: 900 }
          : { x: 0, y: 0, width: 1920, height: 1040 } }),
      },
      Menu: { buildFromTemplate: () => ({}) },
      nativeImage: { createFromDataURL: () => ({}) },
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(window.getBounds(), { x: 1812, y: 348, width: 100, height: 100 });
    assert.equal(typeof handlers.get('quota:set-layout'), 'function');
    const update = (mode, height, regions) => handlers.get('quota:set-layout')({}, { mode, height, regions });
    const circle = { x: 12, y: 12, width: 76, height: 76, radius: 38 };
    const expandedCircle = { ...circle, x: 198, y: 20 };
    const panel = { x: 12, y: 114, width: 262, height: 192, radius: 18 };
    const hits = (x, y) => window.shape.some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
    update('normal', 318, [expandedCircle, panel]);
    assert.deepEqual(window.getBounds(), { x: 1626, y: 340, width: 286, height: 318 });
    assert.equal(hits(140, 60), false);
    assert.equal(hits(140, 180), true);
    update('picker', 360, [{ x: 12, y: 12, width: 262, height: 336, radius: 18 }]);
    assert.equal(window.getBounds().height, 360);
    assert.equal(hits(140, 340), true);
    update('normal', 318, [expandedCircle, panel]);
    assert.equal(window.getBounds().height, 318);
    assert.equal(hits(140, 340), false);
    update('collapsed', 100, [circle]);
    assert.deepEqual(window.getBounds(), { x: 1812, y: 348, width: 100, height: 100 });
    assert.equal(hits(12, 12), false);
    assert.equal(hits(50, 50), true);
    assert.equal(window.options.backgroundColor, '#00000000');
    for (const invalid of [
      { mode: 'normal', height: NaN, regions: [panel] },
      { mode: 'normal', height: 318, regions: [] },
      { mode: 'normal', height: 318, regions: [{ ...panel, width: Infinity }] },
      { mode: 'normal', height: 318, regions: [{ ...panel, x: -1 }] },
      { mode: 'unknown', height: 318, regions: [panel] },
    ]) {
      handlers.get('quota:set-layout')({}, invalid);
      assert.equal(window.getBounds().width, 100, 'invalid reports must leave the usable layout untouched');
      assert.equal(hits(50, 50), true);
    }

    handlers.get('quota:move-to-y')({}, 600, 50);
    assert.deepEqual(window.getBounds(), { x: 1812, y: 550, width: 100, height: 100 });
    update('normal', 318, [expandedCircle, panel]);
    assert.deepEqual(window.getBounds(), { x: 1626, y: 542, width: 286, height: 318 });
    handlers.get('quota:move-to-y')({}, 658, 58);
    assert.deepEqual(window.getBounds(), { x: 1626, y: 600, width: 286, height: 318 });
    handlers.get('quota:set-edge-hidden')({}, true);
    assert.deepEqual(window.getBounds(), { x: 1906, y: 630, width: 14, height: 56 });
    update('normal', 318, [expandedCircle, panel]);
    assert.equal(window.getBounds().width, 14, 'a late renderer report must not reopen a hidden window');
    handlers.get('quota:set-edge-hidden')({}, false);
    assert.deepEqual(window.getBounds(), { x: 1812, y: 608, width: 100, height: 100 });
    cursor = { x: 2200, y: 350 };
    handlers.get('quota:start-drag')({}, 50);
    t.mock.timers.tick(16);
    handlers.get('quota:stop-drag')();
    assert.deepEqual(window.getBounds(), { x: 3412, y: 300, width: 100, height: 100 });
    update('normal', 318, [expandedCircle, panel]);
    assert.deepEqual(window.getBounds(), { x: 3226, y: 292, width: 286, height: 318 });
  } finally {
    appEvents.get('before-quit')?.();
    AppServerClient.prototype.start = originalStart;
    fs.rmSync(userData, { recursive: true });
  }
});
