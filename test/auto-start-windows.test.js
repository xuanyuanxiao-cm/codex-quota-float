const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CodexAutoStart } = require('../dist/auto-start');
const quote = (value) => `'${value.replace(/'/g, "''")}'`;
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const run = (code) => execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ProgressPreference = 'SilentlyContinue'; " + code, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000, encoding: 'utf8' }).trim();

test('Windows creates a real hidden startup shortcut in an isolated test directory and removes it', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-link-o'brien-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manager = new CodexAutoStart(dir, dir, 'C:\\Apps\\Quota Float.exe', {
    spawn() { const child = new EventEmitter(); child.unref = () => {}; process.nextTick(() => child.emit('spawn')); return child; },
  });
  await manager.setEnabled(true);
  assert.ok(fs.statSync(manager.shortcut).size > 0);
  const saved = JSON.parse(run(`$s = New-Object -ComObject WScript.Shell; $l = $s.CreateShortcut(${quote(manager.shortcut)}); @{target=$l.TargetPath;arguments=$l.Arguments;window=$l.WindowStyle} | ConvertTo-Json -Compress`));
  assert.equal(saved.target.toLowerCase(), powershell.toLowerCase());
  assert.ok(saved.arguments.includes(`-File "${manager.script}"`));
  assert.ok(saved.arguments.includes('-WindowStyle Hidden'));
  await manager.setEnabled(false);
  assert.equal(fs.existsSync(manager.shortcut), false);
});

test('Windows process probe accepts the Codex Store GUI and excludes ChatGPT, CLI, and headless processes', { skip: process.platform !== 'win32' }, () => {
  const script = path.join(__dirname, '..', 'dist', 'follow-codex.ps1');
  for (const [exe, handle, expected] of [
    ['C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.924.0_x64__test\\app\\ChatGPT.exe', 123, true],
    ['C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1.0_x64__test\\app\\ChatGPT.exe', 123, false],
    ['C:\\Users\\Example\\AppData\\Local\\OpenAI\\Codex\\bin\\hash\\codex.exe', 123, false],
    ['C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.924.0_x64__test\\app\\ChatGPT.exe', 0, false],
  ]) {
    const result = run(`function Get-Process { param($Name,$ErrorAction) [pscustomobject]@{ MainWindowHandle=[IntPtr]${handle}; Path=${quote(exe)} } }; & ${quote(script)} -Probe`);
    assert.equal(JSON.parse(result).codexOpen, expected, exe);
  }
});
