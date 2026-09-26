const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { AppServerClient } = require('../dist/app-server-client');

test('large stderr output cannot block quota responses', async (t) => {
  const server = `
    const fs = require('node:fs');
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      if (!request.id) return;
      if (request.method === 'account/rateLimits/read') fs.writeSync(2, Buffer.alloc(4 * 1024 * 1024, 120));
      const result = request.method === 'initialize' ? {} : { rateLimits: { primary: { usedPercent: 25 } } };
      process.stdout.write(JSON.stringify({ id: request.id, result }) + '\\n');
    });
  `;
  const client = new AppServerClient({
    requestTimeoutMs: 5000,
    spawnImpl: () => spawn(process.execPath, ['-e', server], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    }),
  });
  t.after(() => client.stop());
  assert.equal((await client.readRateLimits()).rateLimits.primary.usedPercent, 25);
});
