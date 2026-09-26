const assert = require('node:assert/strict');
const test = require('node:test');
const { RefreshController } = require('../dist/refresh-controller');

const reading = (usedPercent, availableCount) => ({
  rateLimits: { primary: { usedPercent, windowDurationMins: 300 } },
  rateLimitResetCredits: {
    availableCount,
    credits: availableCount ? [{ id: 'test-credit', status: 'available' }] : [],
  },
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t) {
  const reads = [];
  let finishReset;
  const controller = new RefreshController({
    onRateLimitsUpdated: () => () => {},
    readRateLimits: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    consumeRateLimitResetCredit: () => new Promise((resolve) => { finishReset = resolve; }),
  }, { retryDelaysMs: [] });
  t.after(() => controller.stop());
  const starting = controller.start();
  reads[0].resolve(reading(80, 1));
  await starting;
  return { controller, reads, finishReset: () => finishReset({ outcome: 'reset' }) };
}

test('a read begun before reset cannot replace the required post-reset refresh', async (t) => {
  const { controller, reads, finishReset } = await setup(t);
  const earlierRefresh = controller.refreshNow();
  const resetting = controller.resetQuota('test-credit');
  finishReset();
  await flush();
  reads[1].resolve(reading(80, 1));
  await earlierRefresh;
  await flush();
  assert.equal(reads.length, 3, 'reset must start a new read after the old read completes');
  assert.equal(controller.state.isResetting, true);
  reads[2].resolve(reading(0, 0));
  assert.deepEqual(await resetting, { outcome: 'reset' });
  assert.equal(controller.state.fiveHour.remainingPercent, 100);
  assert.equal(controller.state.resetCredits.availableCount, 0);
  assert.equal(controller.state.isResetting, false);
});

test('a concurrent refresh does not clear the busy state while consumption is pending', async (t) => {
  const { controller, reads, finishReset } = await setup(t);
  const resetting = controller.resetQuota('test-credit');
  const refreshing = controller.refreshNow();
  reads[1].resolve(reading(80, 1));
  await refreshing;
  assert.equal(controller.state.isResetting, true);
  assert.equal(controller.resetQuota('test-credit'), resetting);
  finishReset();
  await flush();
  reads[2].resolve(reading(0, 0));
  await resetting;
  assert.equal(controller.state.isResetting, false);
});

test('a post-reset refresh failure preserves the successful consume result and unlocks the controls', async (t) => {
  const { controller, reads, finishReset } = await setup(t);
  const resetting = controller.resetQuota('test-credit');
  finishReset();
  await flush();
  reads[1].reject(new Error('offline'));
  assert.deepEqual(await resetting, { outcome: 'reset' });
  assert.equal(controller.state.status, 'stale');
  assert.equal(controller.state.isResetting, false);
  assert.doesNotMatch(controller.state.errorMessage, /重置失败/);
});

test('stopping while waiting on a pre-reset read prevents another read', async (t) => {
  const { controller, reads, finishReset } = await setup(t);
  const earlierRefresh = controller.refreshNow();
  const resetting = controller.resetQuota('test-credit');
  finishReset();
  await flush();
  controller.stop();
  reads[1].resolve(reading(80, 1));
  await Promise.all([earlierRefresh, resetting]);
  assert.equal(reads.length, 2);
});
