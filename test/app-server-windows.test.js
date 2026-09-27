const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AppServerClient } = require('../dist/app-server-client');

for (const entry of ['CODEX_CLI_PATH', 'PATH']) test(`Windows starts an offline npm-style shim through ${entry}`, { skip: process.platform !== 'win32' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota shim & test '));
  const saved = Object.fromEntries(['CODEX_CLI_PATH', 'CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND', 'LOCALAPPDATA', 'PATH'].map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const script = path.join(dir, 'server.cjs');
  fs.writeFileSync(script, `require('node:readline').createInterface({input:process.stdin}).on('line', line => {
    const request = JSON.parse(line);
    if (request.id) console.log(JSON.stringify({id:request.id,result:request.method === 'initialize' ? {} : {rateLimits:{primary:{usedPercent:25}},rateLimitResetCredits:null}}));
  });`);
  const shim = path.join(dir, 'codex.cmd');
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}"\r\n`);
  delete process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND;
  delete process.env.CODEX_CLI_PATH;
  process.env.LOCALAPPDATA = dir;
  if (entry === 'CODEX_CLI_PATH') process.env.CODEX_CLI_PATH = shim;
  else process.env.PATH = `${dir}${path.delimiter}${path.join(process.env.SystemRoot, 'System32')}`;
  const client = new AppServerClient({ requestTimeoutMs: 2000 });
  try {
    assert.deepEqual(await client.readRateLimits(), { rateLimits: { primary: { usedPercent: 25 } }, rateLimitResetCredits: null });
  } finally { await client.stop(); }
});
