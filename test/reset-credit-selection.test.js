const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { RefreshController } = require('../dist/refresh-controller');
const { registerQuotaActions } = require('../dist/main');

const credits = {
  availableCount: 3,
  credits: [
    { id: 'later', status: 'available', title: 'Later', expiresAt: 1_800_000_000 },
    { id: 'undated', status: 'available', title: 'Undated' },
    { id: 'expired-first', status: 'consumed', title: 'Used', expiresAt: 1_700_000_000 },
    { id: 'sooner', status: 'available', title: 'Sooner', expiresAt: 1_750_000_000 },
  ],
};

async function startedController() {
  const consumed = [];
  const client = {
    onRateLimitsUpdated: () => () => {},
    readRateLimits: async () => ({ rateLimits: {}, rateLimitResetCredits: credits }),
    consumeRateLimitResetCredit: async (creditId) => {
      consumed.push(creditId);
      return { outcome: 'reset' };
    },
  };
  const controller = new RefreshController(client);
  let state;
  controller.subscribe((next) => { state = next; });
  await controller.start();
  return { controller, consumed, getState: () => state };
}

test('default reset consumes the available credit expiring soonest and presents available credits in that order', async () => {
  const { controller, consumed, getState } = await startedController();
  try {
    assert.deepEqual(getState().resetCredits.credits.filter((credit) => credit.status === 'available').map((credit) => credit.id), ['sooner', 'later', 'undated']);
    await controller.resetQuota();
    assert.deepEqual(consumed, ['sooner']);
  } finally {
    controller.stop();
  }
});

test('a chosen credit overrides the default and an unavailable ID cannot be consumed', async () => {
  const { controller, consumed } = await startedController();
  try {
    await controller.resetQuota('later');
    assert.deepEqual(consumed, ['later']);
    assert.deepEqual(await controller.resetQuota('expired-first'), { outcome: 'noCredit' });
    assert.deepEqual(await controller.resetQuota('unknown'), { outcome: 'noCredit' });
    assert.deepEqual(consumed, ['later']);
  } finally {
    controller.stop();
  }
});

test('the reset IPC handler forwards the chosen credit ID', async () => {
  const handlers = new Map();
  const received = [];
  registerQuotaActions({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    refreshNow: async () => {},
    resetQuota: async (creditId) => { received.push(creditId); return { outcome: 'reset' }; },
  });
  await handlers.get('quota:reset')({}, 'later');
  assert.deepEqual(received, ['later']);
});

test('the renderer bridge sends the chosen credit ID through IPC', async () => {
  let bridge;
  const calls = [];
  const preload = fs.readFileSync(path.join(__dirname, '..', 'dist', 'preload.js'), 'utf8');
  vm.runInNewContext(preload, {
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); } },
      };
    },
    exports: {},
  });
  await bridge.resetQuota('later');
  assert.deepEqual(calls, [['quota:reset', 'later']]);
});
