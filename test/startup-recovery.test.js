const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { RefreshController } = require('../dist/refresh-controller');

test('the actual Refresh IPC action can recover after startup failed', async (t) => {
  let offline = true;
  let startAttempts = 0;
  const states = [];
  const handlers = new Map();
  const appEvents = new Map();
  class FakeClient {
    async start() {
      startAttempts += 1;
      if (offline) throw new Error('offline');
    }
    async readRateLimits() {
      await this.start();
      return { rateLimits: {}, rateLimitResetCredits: null };
    }
    onRateLimitsUpdated() { return () => {}; }
    stop() {}
  }
  const filename = path.join(__dirname, '..', 'dist', 'main.js');
  const localRequire = createRequire(filename);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports, module: { exports }, __dirname: path.dirname(filename),
    require(name) {
      if (name === './app-server-client') return { AppServerClient: FakeClient };
      if (name === './refresh-controller') return {
        RefreshController: class extends RefreshController {
          constructor(client) { super(client, { retryDelaysMs: [] }); }
        },
      };
      return localRequire(name);
    },
  });
  t.after(() => appEvents.get('before-quit')?.());
  exports.startCompanion({
    app: {
      on: (name, listener) => appEvents.set(name, listener),
      whenReady: () => Promise.resolve(),
      getPath: () => path.join(os.tmpdir(), 'quota-recovery-test-unused-profile'),
    },
    BrowserWindow: class {
      constructor(options) {
        this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
        this.webContents = { send: (name, state) => { if (name === 'quota:state') states.push(state); }, on() {} };
      }
      loadFile() { return Promise.resolve(); }
      setMovable() {}
      setShape() {}
      setBounds(bounds) { this.bounds = bounds; }
      getBounds() { return this.bounds; }
      on() {}
    },
    Tray: class { setToolTip() {} setContextMenu() {} destroy() {} },
    ipcMain: { handle: (name, action) => handlers.set(name, action) },
    screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
    Menu: { buildFromTemplate: () => ({}) },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1).status, 'error');
  offline = false;
  await handlers.get('quota:refresh-now')();
  assert.equal(states.at(-1).status, 'ready');
  assert.equal(startAttempts, 2);
});
