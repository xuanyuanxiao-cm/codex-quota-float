const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { configureWindowsAppIdentity } = require('../dist/main');

test('sets a stable Windows AppUserModelID for taskbar pinning', () => {
  const calls = [];

  configureWindowsAppIdentity({
    setAppUserModelId(value) {
      calls.push(value);
    },
  });

  assert.deepEqual(calls, ['com.openai.codex-quota-float']);
});

test('build configuration produces both installer and portable packages', () => {
  const config = fs.readFileSync(
    path.join(__dirname, '..', 'electron-builder.yml'),
    'utf8',
  );

  assert.match(config, /- target: nsis/);
  assert.match(config, /- target: portable/);
  assert.match(config, /createStartMenuShortcut: true/);
});
