const assert = require('node:assert/strict');
const test = require('node:test');
const { createMainWindow, dockWindowOnRight, createAppServerUnavailableState } = require('../dist/main');
const { rightDockPosition, rightDockBounds } = require('../dist/window-position');

test('main window starts collapsed with its icon and isolated renderer', () => {
  let options, loaded;
  createMainWindow(class { constructor(value) { options = value; } loadFile(file) { loaded = file; } },
    'preload.js', 'index.html', 'quota.ico');
  assert.equal(options.width, 100); assert.equal(options.height, 100);
  assert.equal(options.icon, 'quota.ico'); assert.equal(loaded, 'index.html');
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
});

test('docking centers the window and clamps normal and edge layouts inside the work area', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(rightDockPosition(area, { width: 286, height: 300 }), { x: 1626, y: 370 });
  let bounds;
  dockWindowOnRight({ setBounds: next => { bounds = next; } }, area, 1200);
  assert.deepEqual(bounds, { x: 1626, y: 680, width: 286, height: 360 });
  assert.deepEqual(rightDockBounds(area, 'edgeHidden', 370), { x: 1906, y: 400, width: 14, height: 56 });
  assert.equal(rightDockBounds(area, 'edgeHidden', 2000).y, 984);
});

test('startup fallback contains no quota values or raw connection details', () => {
  const state = createAppServerUnavailableState();
  assert.equal(state.status, 'error'); assert.equal(state.lastUpdatedAt, null);
  assert.equal(state.fiveHour.remainingPercent, null); assert.equal(state.weekly.remainingPercent, null);
  assert.equal(state.resetCredits, null); assert.equal(state.isResetting, false);
  assert.equal(state.errorMessage, 'Codex app-server unavailable. Sign in in Codex and try again.');
});
