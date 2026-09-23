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

test('the native window shrinks on collapse and expands on orb click', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-window-test-'));
  const handlers = new Map();
  let window;
  const originalStart = AppServerClient.prototype.start;
  AppServerClient.prototype.start = async () => { throw new Error('offline test'); };

  class FakeWindow {
    constructor(options) {
      this.bounds = { x: 500, y: 200, width: options.width, height: options.height };
      this.webContents = { send() {}, on() {} };
      window = this;
    }
    loadFile() { return Promise.resolve(); }
    setMovable() {}
    setBounds(bounds) { this.bounds = { ...bounds }; }
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
        on() {},
        whenReady: () => Promise.resolve(),
        getPath: () => userData,
      },
      BrowserWindow: FakeWindow,
      Tray: FakeTray,
      ipcMain: { handle(name, handler) { handlers.set(name, handler); } },
      screen: {
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      },
      Menu: { buildFromTemplate: () => ({}) },
      nativeImage: { createFromDataURL: () => ({}) },
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(window.getBounds(), { x: 1812, y: 348, width: 100, height: 100 });
    handlers.get('quota:set-expanded')({}, true);
    assert.deepEqual(window.getBounds(), { x: 1626, y: 340, width: 286, height: 360 });
    handlers.get('quota:set-expanded')({}, false);
    assert.deepEqual(window.getBounds(), { x: 1812, y: 348, width: 100, height: 100 });

    handlers.get('quota:move-to-y')({}, 600, 50);
    assert.deepEqual(window.getBounds(), { x: 1812, y: 550, width: 100, height: 100 });
    handlers.get('quota:set-expanded')({}, true);
    assert.deepEqual(window.getBounds(), { x: 1626, y: 542, width: 286, height: 360 });
    handlers.get('quota:set-edge-hidden')({}, true);
    assert.deepEqual(window.getBounds(), { x: 1906, y: 572, width: 14, height: 56 });
    handlers.get('quota:set-edge-hidden')({}, false);
    assert.deepEqual(window.getBounds(), { x: 1812, y: 550, width: 100, height: 100 });
  } finally {
    AppServerClient.prototype.start = originalStart;
    fs.rmSync(userData, { recursive: true });
  }
});
