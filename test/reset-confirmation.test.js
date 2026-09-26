const assert = require('node:assert/strict');
const test = require('node:test');
const { registerQuotaActions } = require('../dist/main');
const { RefreshController } = require('../dist/refresh-controller');

async function setup(t, response) {
  const consumed = [];
  const dialogs = [];
  const credits = [
    { id: 'first-credit-1234', status: 'available', title: 'A very long original title', expiresAt: new Date(2027, 0, 15, 12).getTime() / 1000 },
    { id: 'second-credit-5678', status: 'available', expiresAt: new Date(2027, 1, 15, 12).getTime() / 1000 },
  ];
  const controller = new RefreshController({
    onRateLimitsUpdated: () => () => {},
    readRateLimits: async () => ({ rateLimits: {}, rateLimitResetCredits: { availableCount: 2, credits } }),
    consumeRateLimitResetCredit: async (id) => { consumed.push(id); return { outcome: 'reset' }; },
  });
  t.after(() => controller.stop());
  await controller.start();
  const handlers = new Map();
  const parent = {};
  const reset = registerQuotaActions({ handle: (name, handler) => handlers.set(name, handler) }, controller, {
    showMessageBox: async (window, options) => {
      dialogs.push({ window, options });
      return { response: await response };
    },
  }, () => parent);
  return { consumed, dialogs, handlers, parent, reset };
}

test('canceling the native confirmation sends no reset request', async (t) => {
  const { handlers, consumed, dialogs } = await setup(t, 0);
  const result = await handlers.get('quota:reset')({}, 'second-credit-5678');
  assert.deepEqual(consumed, []);
  assert.equal(dialogs.length, 1);
  assert.deepEqual(result, { outcome: 'cancelled' });
});

test('confirmation describes the selected card, defaults to Cancel, and redeems only that card', async (t) => {
  const { handlers, consumed, dialogs, parent } = await setup(t, 1);
  await handlers.get('quota:reset')({}, 'second-credit-5678');
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].window, parent);
  const { options } = dialogs[0];
  assert.match(options.message, /重置卡 2/);
  assert.match(options.detail, /2027\/2\/15.*…5678/);
  assert.match(options.detail, /消耗/);
  assert.deepEqual(options.buttons, ['取消', '确认使用']);
  assert.equal(options.defaultId, 0);
  assert.equal(options.cancelId, 0);
  assert.deepEqual(consumed, ['second-credit-5678']);
});

test('repeated clicks while confirmation is open share one prompt and one reset', async (t) => {
  let approve;
  const response = new Promise((resolve) => { approve = resolve; });
  const { handlers, consumed, dialogs } = await setup(t, response);
  const first = handlers.get('quota:reset')({}, 'first-credit-1234');
  const second = handlers.get('quota:reset')({}, 'first-credit-1234');
  assert.deepEqual(consumed, []);
  approve(1);
  await Promise.all([first, second]);
  assert.equal(dialogs.length, 1);
  assert.deepEqual(consumed, ['first-credit-1234']);
});

test('the shared tray reset action also requires confirmation for the earliest-expiring card', async (t) => {
  const { reset, consumed, dialogs } = await setup(t, 0);
  assert.equal(typeof reset, 'function');
  await reset();
  assert.match(dialogs[0].options.message, /重置卡 1/);
  assert.deepEqual(consumed, []);
});
