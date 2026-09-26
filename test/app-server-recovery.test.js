const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { AppServerClient } = require('../dist/app-server-client');
const { RefreshController } = require('../dist/refresh-controller');

const reading = {
  rateLimits: { primary: { usedPercent: 80, windowDurationMins: 300 } },
  rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'test-credit', status: 'available' }] },
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(t, respond) {
  const children = [];
  const requests = [];
  const client = new AppServerClient({
    requestTimeoutMs: 100,
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.killed = false;
      child.kill = () => { child.killed = true; };
      child.reply = (message) => child.stdout.emit('data', `${JSON.stringify(message)}\n`);
      child.stdin = {
        end() {},
        write(line) {
          const request = JSON.parse(line);
          requests.push(request);
          queueMicrotask(() => {
            if (respond && respond(request, child, children.length) === false) return;
            if (request.method === 'initialize') child.reply({ id: request.id, result: {} });
            if (request.method === 'account/rateLimits/read') child.reply({ id: request.id, result: reading });
          });
        },
      };
      children.push(child);
      return child;
    },
  });
  const controller = new RefreshController(client, { retryDelaysMs: [] });
  t.after(() => { controller.stop(); return client.stop(); });
  return { client, controller, children, requests };
}

test('Refresh retries initialization after the initial connection fails', async (t) => {
  const { controller, children } = setup(t, (request, child, attempt) => {
    if (attempt === 1 && request.method === 'initialize') {
      child.emit('error', new Error('offline'));
      return false;
    }
  });
  await controller.start();
  assert.equal(controller.state.status, 'error');
  await controller.refreshNow();
  assert.equal(controller.state.status, 'ready');
  assert.equal(children.length, 2);
});

test('Refresh reconnects after the server exits and ignores late events from the old server', async (t) => {
  const { client, controller, children } = setup(t);
  await client.start();
  await controller.start();
  const oldChild = children[0];
  oldChild.emit('exit', 1, null);
  await controller.refreshNow();
  oldChild.emit('close', 1, null);
  oldChild.reply({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 99 } } } });
  assert.equal(controller.state.status, 'ready');
  assert.equal(controller.state.fiveHour.remainingPercent, 20);
  assert.equal(children.length, 2);
});

test('failed initialization cleans up the live child before a new attempt', async (t) => {
  const { client, children } = setup(t, (request, child, attempt) => {
    if (attempt === 1 && request.method === 'initialize') {
      child.reply({ id: request.id, error: { message: 'initialization rejected' } });
      return false;
    }
  });
  await assert.rejects(client.start(), /initialization rejected/);
  assert.equal(children[0].killed, true);
  await client.start();
  assert.deepEqual(await client.readRateLimits(), reading);
  assert.equal(children.length, 2);
});

for (const method of ['initialize', 'account/rateLimits/read']) {
  test(`${method} times out and the next read reconnects`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let silent = true;
    const { client, children } = setup(t, (request) => !(silent && request.method === method));
    if (method !== 'initialize') await client.start();
    const request = method === 'initialize' ? client.start() : client.readRateLimits();
    const rejected = assert.rejects(request, { code: 'APP_SERVER_TIMEOUT' });
    await flush();
    t.mock.timers.tick(100);
    await rejected;
    assert.equal(children[0].killed, true);
    silent = false;
    assert.deepEqual(await client.readRateLimits(), reading);
    assert.equal(children.length, 2);
    t.mock.timers.tick(100);
    assert.equal(children[1].killed, false, 'completed requests must cancel their timeouts');
  });
}

test('reset timeout releases the busy state without replaying consumption and retains the retry key', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { client, controller, children, requests } = setup(t);
  await client.start();
  await controller.start();
  const reset = controller.resetQuota('test-credit');
  const rejected = assert.rejects(reset, { code: 'APP_SERVER_TIMEOUT' });
  await flush();
  assert.equal(controller.state.isResetting, true);
  t.mock.timers.tick(100);
  await rejected;
  assert.equal(controller.state.isResetting, false);
  assert.match(controller.state.errorMessage, /超时.*尚未确认.*刷新/);
  const consumes = () => requests.filter((request) => request.method === 'account/rateLimitResetCredit/consume');
  assert.equal(consumes().length, 1);
  await controller.refreshNow();
  assert.equal(consumes().length, 1, 'read-only recovery must never replay consumption');
  const retry = controller.resetQuota('test-credit');
  await flush();
  assert.equal(consumes().length, 2);
  assert.equal(consumes()[1].params.idempotencyKey, consumes()[0].params.idempotencyKey);
  children[1].reply({ id: consumes()[1].id, result: { outcome: 'alreadyRedeemed' } });
  assert.deepEqual(await retry, { outcome: 'alreadyRedeemed' });
  assert.equal(controller.state.isResetting, false);
});

test('stopping a pending request clears its timeout and does not kill a later connection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let silent = true;
  const { client, children } = setup(t, (request) => !(silent && request.method === 'account/rateLimits/read'));
  await client.start();
  const rejected = assert.rejects(client.readRateLimits(), /stopped/);
  await client.stop();
  await rejected;
  silent = false;
  await client.start();
  assert.deepEqual(await client.readRateLimits(), reading);
  t.mock.timers.tick(100);
  assert.equal(children[1].killed, false);
});

test('an old initialization failure does not replace the shared start of the new connection', async (t) => {
  const { client, children } = setup(t, (request) => request.method !== 'initialize');
  const first = client.start();
  assert.equal(client.start(), first);
  const rejected = assert.rejects(first, /stopped/);
  await client.stop();
  const replacement = client.start();
  await rejected;
  assert.equal(client.start(), replacement);
  children[1].reply({ id: 1, result: {} });
  await replacement;
  assert.equal(children.length, 2);
  assert.deepEqual(await client.readRateLimits(), reading);
});

test('exit immediately after an initialize reply cannot mark a dead connection as ready', async (t) => {
  const { client, children } = setup(t, (request, child, attempt) => {
    if (attempt === 1 && request.method === 'initialize') {
      child.reply({ id: request.id, result: {} });
      child.emit('exit', 1, null);
      return false;
    }
  });
  await assert.rejects(client.start(), /connection ended/);
  assert.deepEqual(await client.readRateLimits(), reading);
  assert.equal(children.length, 2);
});

test('a read waiting for initialization cannot reconnect after an explicit stop', async (t) => {
  const { client, children } = setup(t);
  const stopping = client.start().then(() => client.stop());
  const rejected = assert.rejects(client.readRateLimits(), /not running|stopped/);
  await stopping;
  await rejected;
  assert.equal(children.length, 1);
});
