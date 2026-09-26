const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { AppServerClient } = require('../dist/app-server-client');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function connectedClient(t) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  const requests = [];
  child.stdin = { write: (line) => requests.push(JSON.parse(line)), end() {} };
  child.kill = () => {};
  const reply = (message) => child.stdout.emit('data', `${JSON.stringify(message)}\n`);
  const client = new AppServerClient({ spawnImpl: () => child });
  t.after(() => client.stop());
  const starting = client.start();
  reply({ id: requests.at(-1).id, result: {} });
  await starting;
  return { client, requests, reply };
}

test('reset request includes the required UUID idempotency key and selected credit ID', async (t) => {
  const { client, requests, reply } = await connectedClient(t);
  const resetting = client.consumeRateLimitResetCredit('chosen-credit');
  const request = requests.at(-1);
  reply({ id: request.id, result: { outcome: 'reset' } });
  assert.deepEqual(await resetting, { outcome: 'reset' });
  assert.equal(request.method, 'account/rateLimitResetCredit/consume');
  assert.equal(request.params.creditId, 'chosen-credit');
  assert.match(request.params.idempotencyKey ?? '', uuid);
});

test('an uncertain failed reset reuses its key when the same credit is retried', async (t) => {
  const { client, requests, reply } = await connectedClient(t);
  const first = client.consumeRateLimitResetCredit('chosen-credit');
  const firstRequest = requests.at(-1);
  const rejected = assert.rejects(first, /connection lost/);
  reply({ id: firstRequest.id, error: { code: -32000, message: 'connection lost' } });
  await rejected;
  const retry = client.consumeRateLimitResetCredit('chosen-credit');
  const retryRequest = requests.at(-1);
  reply({ id: retryRequest.id, result: { outcome: 'alreadyRedeemed' } });
  assert.deepEqual(await retry, { outcome: 'alreadyRedeemed' });
  assert.match(firstRequest.params.idempotencyKey ?? '', uuid);
  assert.equal(retryRequest.params.idempotencyKey, firstRequest.params.idempotencyKey);
});

test('different credits never share an idempotency key', async (t) => {
  const { client, requests, reply } = await connectedClient(t);
  const first = client.consumeRateLimitResetCredit('first-credit');
  const firstRequest = requests.at(-1);
  const second = client.consumeRateLimitResetCredit('second-credit');
  const secondRequest = requests.at(-1);
  reply({ id: firstRequest.id, result: { outcome: 'reset' } });
  reply({ id: secondRequest.id, result: { outcome: 'reset' } });
  await Promise.all([first, second]);
  assert.notEqual(firstRequest.params.idempotencyKey, secondRequest.params.idempotencyKey);
});

for (const outcome of ['reset', 'alreadyRedeemed', 'nothingToReset', 'noCredit']) {
  test(`a definitive ${outcome} result ends the attempt so a later reset gets a fresh key`, async (t) => {
    const { client, requests, reply } = await connectedClient(t);
    const first = client.consumeRateLimitResetCredit('chosen-credit');
    const firstRequest = requests.at(-1);
    reply({ id: firstRequest.id, result: { outcome } });
    await first;
    const next = client.consumeRateLimitResetCredit('chosen-credit');
    const nextRequest = requests.at(-1);
    reply({ id: nextRequest.id, result: { outcome: 'reset' } });
    await next;
    assert.notEqual(firstRequest.params.idempotencyKey, nextRequest.params.idempotencyKey);
  });
}
