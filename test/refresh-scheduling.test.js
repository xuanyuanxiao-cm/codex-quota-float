const assert = require('node:assert/strict');
const test = require('node:test');
const { RefreshController } = require('../dist/refresh-controller');
const reading = usedPercent => ({ rateLimits: {
  primary: { usedPercent, windowDurationMins: 300 },
  secondary: { usedPercent: 40, windowDurationMins: 10080 },
}, rateLimitResetCredits: null });
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1700000000000 });
  let reads = 0, listener;
  const queue = [];
  const controller = new RefreshController({
    readRateLimits() { reads++; return queue.length ? queue.shift()() : Promise.resolve(reading(20)); },
    onRateLimitsUpdated(fn) { listener = fn; return () => { listener = undefined; }; },
  });
  const states = [];
  controller.subscribe(state => states.push(state));
  t.after(() => controller.stop());
  return { controller, states, queue, reads: () => reads, emit: update => listener?.(update),
    async tick(ms) { t.mock.timers.tick(ms); await flush(); } };
}

test('startup reads once and automatic reads occur every five minutes', async t => {
  const s = setup(t); await s.controller.start(); await s.controller.start();
  assert.equal(s.reads(), 1);
  await s.tick(299999); assert.equal(s.reads(), 1);
  await s.tick(1); assert.equal(s.reads(), 2);
  await s.tick(300000); assert.equal(s.reads(), 3);
  assert.equal(s.controller.state.fiveHour.remainingPercent, 80);
  assert.equal(s.controller.state.weekly.remainingPercent, 60);
});

test('manual refresh coalesces concurrent calls and resets the timer from completion', async t => {
  const s = setup(t); await s.controller.start(); await s.tick(100000);
  let resolve;
  s.queue.push(() => new Promise(done => { resolve = done; }));
  const first = s.controller.refreshNow();
  assert.equal(s.controller.refreshNow(), first);
  await s.tick(10000); resolve(reading(30)); await first;
  await s.tick(299999); assert.equal(s.reads(), 2);
  await s.tick(1); assert.equal(s.reads(), 3);
});

test('retry waits two then five seconds and coalesces manual calls during the wait', async t => {
  const s = setup(t);
  s.queue.push(() => Promise.reject(Error('first')), () => Promise.reject(Error('second')));
  const pending = s.controller.start(); await flush();
  await s.tick(1999); assert.equal(s.reads(), 1);
  assert.equal(s.controller.refreshNow(), pending);
  await s.tick(1); assert.equal(s.reads(), 2);
  await s.tick(4999); assert.equal(s.reads(), 2);
  await s.tick(1); await pending;
  assert.equal(s.reads(), 3); assert.equal(s.controller.state.status, 'ready');
});

for (const hadSuccess of [false, true]) test(`exhausted retries produce ${hadSuccess ? 'stale data' : 'a safe initial error'}`, async t => {
  const s = setup(t);
  if (hadSuccess) await s.controller.start();
  const previous = s.controller.state;
  s.queue.push(...Array.from({ length: 3 }, () => () => Promise.reject(Error('secret token'))));
  const pending = hadSuccess ? s.controller.refreshNow() : s.controller.start();
  await flush(); await s.tick(2000); await s.tick(5000); await pending;
  assert.equal(s.controller.state.status, hadSuccess ? 'stale' : 'error');
  assert.equal(s.controller.state.lastUpdatedAt, previous.lastUpdatedAt);
  assert.equal(s.controller.state.errorMessage, '额度服务暂时无法连接');
  if (hadSuccess) assert.deepEqual(s.controller.state.weekly, previous.weekly);
});

test('sparse notifications retain the other window and leave only one refresh timer', async t => {
  const s = setup(t); await s.controller.start();
  s.emit({ primary: { usedPercent: 55 } });
  assert.equal(s.controller.state.fiveHour.remainingPercent, 45);
  assert.equal(s.controller.state.weekly.remainingPercent, 60);
  await s.tick(299999); assert.equal(s.reads(), 1);
  await s.tick(1); assert.equal(s.reads(), 2);
  const count = s.states.length;
  s.controller.stop(); await s.tick(300000); s.emit({ primary: { usedPercent: 90 } });
  await s.controller.refreshNow();
  assert.equal(s.reads(), 2); assert.equal(s.states.length, count);
});

test('stop during a retry prevents additional reads and state emissions', async t => {
  const s = setup(t); s.queue.push(() => Promise.reject(Error('offline')));
  const pending = s.controller.start(); await flush();
  const count = s.states.length;
  s.controller.stop(); await s.tick(7000); await pending;
  assert.equal(s.reads(), 1); assert.equal(s.states.length, count);
});
