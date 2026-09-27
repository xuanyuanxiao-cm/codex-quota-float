const assert = require('node:assert/strict');
const test = require('node:test');
const { RefreshController } = require('../dist/refresh-controller');
const { buildRendererViewModel } = require('../dist/renderer/view-model');
const { QuotaAlerts } = require('../dist/alerts');

const weekly = { usedPercent: 27, windowDurationMins: 10080, resetsAt: 1800000000 };
const fiveHour = { usedPercent: 18, windowDurationMins: 300, resetsAt: 1800000000 };
const pro = { planType: 'pro', primary: weekly, secondary: null };
const plus = { planType: 'plus', primary: fiveHour, secondary: weekly };

function setup(t, initial = pro) {
  let snapshot = initial, update, reads = 0;
  const controller = new RefreshController({
    async readRateLimits() {
      reads++;
      if (snapshot instanceof Error) throw snapshot;
      return { rateLimits: snapshot, rateLimitResetCredits: null };
    },
    onRateLimitsUpdated(listener) { update = listener; return () => {}; },
  }, { retryDelaysMs: [] });
  t.after(() => controller.stop());
  return { controller, set: value => { snapshot = value; }, update: value => update(value), reads: () => reads };
}

test('each startup reads the current plan instead of reusing the previous plan', async (t) => {
  const s = setup(t);
  assert.equal(s.controller.state.planType, null);
  assert.equal(s.controller.state.hasFiveHour, null);
  await s.controller.start();
  assert.equal(s.controller.state.planType, 'pro');
  assert.equal(s.controller.state.hasFiveHour, false);
  assert.equal(s.controller.state.weekly.remainingPercent, 73);
  assert.equal(buildRendererViewModel(s.controller.state).showFiveHour, false);
  s.controller.stop();
  s.set(plus);
  await s.controller.start();
  assert.equal(s.reads(), 2);
  assert.equal(s.controller.state.planType, 'plus');
  assert.equal(s.controller.state.hasFiveHour, true);
  assert.equal(buildRendererViewModel(s.controller.state).planText, 'Plus');
});

test('quota refresh and partial updates preserve the plan and follow actual windows', async (t) => {
  const s = setup(t, plus);
  await s.controller.start();
  s.update({ primary: { usedPercent: 20 } });
  assert.equal(s.controller.state.planType, 'plus');
  assert.equal(s.controller.state.hasFiveHour, true);
  s.set(pro);
  await s.controller.refreshNow();
  assert.equal(s.controller.state.planType, 'pro');
  assert.equal(s.controller.state.hasFiveHour, false);
  s.set({ ...plus, planType: 'pro' });
  await s.controller.refreshNow();
  assert.equal(s.controller.state.hasFiveHour, true, 'Pro must not forcibly hide an actual five-hour window');
});

test('startup failure and empty readings remain unknown; later failures retain confirmed layout', async (t) => {
  const s = setup(t, new Error('offline'));
  await s.controller.start();
  assert.equal(s.controller.state.status, 'error');
  assert.equal(s.controller.state.planType, null);
  assert.equal(s.controller.state.hasFiveHour, null);
  assert.equal(buildRendererViewModel(s.controller.state).planText, '套餐未确认');
  assert.equal(buildRendererViewModel(s.controller.state).showFiveHour, true);
  s.set({});
  await s.controller.refreshNow();
  assert.equal(s.controller.state.hasFiveHour, null);
  s.set(pro);
  await s.controller.refreshNow();
  s.set(new Error('offline'));
  await s.controller.refreshNow();
  assert.equal(s.controller.state.status, 'stale');
  assert.equal(s.controller.state.planType, 'pro');
  assert.equal(buildRendererViewModel(s.controller.state).showFiveHour, false);
});

test('weekly-only accounts retain weekly warnings and card expiry alerts', async (t) => {
  const s = setup(t, { ...pro, primary: { ...weekly, usedPercent: 95 } });
  await s.controller.start();
  const now = Date.now();
  const result = new QuotaAlerts({}, () => {}, () => now).update({
    ...s.controller.state,
    resetCredits: { credits: [{ id: 'test', status: 'available', expiresAt: (now + 3600000) / 1000 }] },
  });
  assert.equal(result.alerts.windows.fiveHour, undefined);
  assert.equal(result.alerts.windows.weekly.low, true);
  assert.equal(result.alerts.quotaBadge.severity, 'critical');
  assert.equal(result.alerts.creditBadges.length, 1);
});
