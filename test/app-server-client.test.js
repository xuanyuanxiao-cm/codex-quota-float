const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const { AppServerClient, resolveAppServerCommand } = require('../dist/app-server-client');

function setup(t) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  const requests = [];
  child.stdin = { write: line => requests.push(JSON.parse(line)), end() { this.ended = true; } };
  child.kill = () => { child.killed = true; };
  const client = new AppServerClient({ spawnImpl: () => child });
  t.after(() => client.stop());
  const reply = message => child.stdout.emit('data', JSON.stringify(message) + '\n');
  return { client, child, requests, reply, async start() {
    const pending = client.start();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'initialize');
    assert.equal(requests[0].params.clientInfo.name, 'codex-quota-float');
    reply({ id: requests[0].id, result: {} });
    await pending;
    assert.deepEqual(requests[1], { method: 'initialized' });
  } };
}

test('CLI discovery honors explicit paths, finds bundled executables, and falls back to PATH', () => {
  assert.equal(resolveAppServerCommand({ env: { CODEX_CLI_PATH: 'custom-codex' } }), 'custom-codex');
  const root = path.join('local', 'OpenAI', 'Codex', 'bin');
  const expected = path.join(root, 'current', 'codex.exe');
  assert.equal(resolveAppServerCommand({ env: { LOCALAPPDATA: 'local' },
    readDirectory: () => ['older', 'current'], exists: candidate => candidate === expected }), expected);
  assert.equal(resolveAppServerCommand({ env: {} }), 'codex');
  assert.equal(resolveAppServerCommand({ env: { LOCALAPPDATA: 'missing' },
    readDirectory: () => { throw Error('missing'); } }), 'codex');
});

test('environment command override is used when no explicit command is supplied', async t => {
  const previous = process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND;
    else process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND = previous;
  });
  process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND = 'mock-codex';
  const s = setup(t);
  const spawn = s.client.spawnImpl;
  s.client.spawnImpl = (command, args) => {
    assert.equal(command, 'mock-codex');
    assert.deepEqual(args, ['app-server', '--stdio']);
    return spawn();
  };
  await s.start();
});

test('initialization precedes reads and a response preserves quota and reset credits', async t => {
  const s = setup(t); await s.start();
  const result = { rateLimits: { primary: { usedPercent: 15 } },
    rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'one', status: 'available' }] } };
  const pending = s.client.readRateLimits();
  assert.equal(s.requests.at(-1).method, 'account/rateLimits/read');
  s.reply({ id: 999, result: {} });
  s.reply({ id: s.requests.at(-1).id, result });
  assert.deepEqual(await pending, result);
});

test('notifications unsubscribe and malformed, unknown, and split messages do not break replies', async t => {
  const s = setup(t); await s.start();
  const snapshots = [];
  const unsubscribe = s.client.onRateLimitsUpdated(value => snapshots.push(value));
  s.child.stdout.emit('data', '{not-json}\n');
  s.reply({ method: 'unknown/event', params: {} });
  const update = { primary: { usedPercent: 20 } };
  s.reply({ method: 'account/rateLimits/updated', params: { rateLimits: update } });
  unsubscribe();
  s.reply({ method: 'account/rateLimits/updated', params: { rateLimits: {} } });
  assert.deepEqual(snapshots, [update]);
  const pending = s.client.readRateLimits();
  const line = JSON.stringify({ id: s.requests.at(-1).id, result: { rateLimits: {} } }) + '\n';
  s.child.stdout.emit('data', line.slice(0, 8));
  s.child.stdout.emit('data', line.slice(8));
  assert.deepEqual(await pending, { rateLimits: {}, rateLimitResetCredits: null });
});

test('RPC errors reject requests and stop ends the child and rejects pending reads', async t => {
  const s = setup(t); await s.start();
  const pending = s.client.readRateLimits();
  s.reply({ id: s.requests.at(-1).id, error: { message: 'not authorized' } });
  await assert.rejects(pending, /not authorized/);
  const stopped = s.client.readRateLimits();
  const rejected = assert.rejects(stopped, /stopped/);
  await s.client.stop(); await rejected;
  assert.equal(s.child.stdin.ended, true);
  assert.equal(s.child.killed, true);
});
