const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CodexAutoStart } = require('../dist/auto-start');

test('auto-start saves a stable executable, launches hidden, and removes startup registration on disable', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-follow-o'brien-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const manager = new CodexAutoStart(dir, dir, 'C:\\Apps\\Quota Float.exe', {
    execFile(exe, args, options, callback) { calls.push({ exe, args, options }); callback(null); },
    spawn(exe, args, options) { calls.push({ exe, args, options }); const child = new EventEmitter(); child.unref = () => {}; process.nextTick(() => child.emit('spawn')); return child; },
  });
  await manager.setEnabled(true);
  assert.equal(manager.enabled, true);
  assert.equal(JSON.parse(fs.readFileSync(manager.file)).executable, 'C:\\Apps\\Quota Float.exe');
  assert.equal(calls[1].options.windowsHide, true);
  assert.ok(calls[1].args.includes('Hidden'));
  const command = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le');
  assert.match(command, /o''brien/);
  fs.writeFileSync(manager.shortcut, 'test');
  await manager.setEnabled(false);
  assert.equal(fs.existsSync(manager.shortcut), false);
  assert.equal(JSON.parse(fs.readFileSync(manager.file)).enabled, false);
  assert.equal(new CodexAutoStart(dir, dir, 'unused').enabled, false);
});

test('failed registration rolls back and does not report auto-start enabled', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-follow-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manager = new CodexAutoStart(dir, dir, 'C:\\Apps\\Quota Float.exe', {
    execFile(_exe, _args, _options, callback) { callback(new Error('denied')); },
  });
  await assert.rejects(manager.setEnabled(true), /denied/);
  assert.equal(manager.enabled, false);
  assert.equal(JSON.parse(fs.readFileSync(manager.file)).enabled, false);
});
