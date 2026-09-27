const assert = require('node:assert/strict');
const test = require('node:test');
const { QuotaAlerts } = require('../dist/alerts');
const { RefreshController } = require('../dist/refresh-controller');
const now = 1800000000000, hour = 3600000;
const card = id => ({ id, status: 'available', expiresAt: (now + hour) / 1000 });
const state = (five = 18, weekly = 16, refreshId = 1, credits = [card('a')]) => ({
  status: 'ready', refreshId, hasFiveHour: five !== null,
  fiveHour: { remainingPercent: five, resetsAt: (now + hour) / 1000 },
  weekly: { remainingPercent: weekly, resetsAt: (now + 7 * 24 * hour) / 1000 },
  resetCredits: { credits },
});
const tracker = saved => new QuotaAlerts(saved, () => {}, () => now);

test('quota and credit badges clear only on the next successful full read', () => {
  const a = tracker();
  let view = a.update(state()).alerts;
  assert.equal(view.quotaBadge.severity, 'low'); assert.equal(view.creditBadges.length, 1);
  for (const status of ['loading', 'stale', 'error']) {
    view = a.update({ ...state(), status }).alerts;
    assert.ok(view.quotaBadge); assert.equal(view.creditBadges.length, 1);
  }
  view = a.update(state(17, 15)).alerts;
  assert.ok(view.quotaBadge, 'push with unchanged refreshId retains badge');
  view = a.update(state(17, 15, 2)).alerts;
  assert.equal(view.quotaBadge, null); assert.equal(view.creditBadges.length, 0);
  assert.equal(view.windows.fiveHour.low, true); assert.equal(view.expiringCredits.length, 1);
});

test('new thresholds and new cards replace old badges on the clearing refresh', () => {
  const a = tracker(); a.update(state());
  let view = a.update(state(8, 16, 2, [card('a'), card('b')])).alerts;
  assert.equal(view.quotaBadge.severity, 'critical'); assert.match(view.quotaBadge.text, /5 小时.*8%/);
  assert.deepEqual(view.creditBadges.map(c => c.id), ['b']);
  view = a.update(state(0, 16, 3)).alerts;
  assert.equal(view.quotaBadge.severity, 'exhausted');
  assert.match(view.quotaBadge.text, /已耗尽/);
});

test('viewing one category leaves the other category untouched', () => {
  const a = tracker(); a.update(state());
  assert.equal(a.dismiss('quota').quotaBadge, null);
  assert.equal(a.view.creditBadges.length, 1);
  assert.equal(a.dismiss('credits').creditBadges.length, 0);
  assert.equal(a.view.expiringCredits.length, 1);
  assert.equal(a.update(state(17, 16)).alerts.quotaBadge, null, 'same threshold cannot reappear');
});

test('jitter, restart and a jump across thresholds do not replay warnings', () => {
  const a = tracker(); a.update(state(8, 68)); a.dismiss('quota');
  for (const value of [12, 8, 21, 19, 8]) assert.equal(a.update(state(value, 68)).alerts.quotaBadge, null);
  const restarted = tracker(structuredClone(a.saved));
  assert.equal(restarted.update(state(8, 68)).alerts.quotaBadge, null);
  assert.equal(restarted.update(state(8, 18, 2)).alerts.quotaBadge.severity, 'critical', 'weekly threshold independently triggers');
  assert.equal(restarted.update(state(0, 18, 3)).alerts.quotaBadge.severity, 'exhausted');
});

for (const [weekly, expected] of [[68, 'recovered'], [18, 'low'], [8, 'critical'], [0, 'exhausted']]) {
  test(`recovery combines with the other window at ${weekly}%`, () => {
    const a = tracker(); a.update(state(0, weekly));
    const badge = a.update(state(100, weekly, 2)).alerts.quotaBadge;
    assert.equal(badge.severity, expected); assert.match(badge.text, /5 小时额度已恢复/);
    if (weekly <= 20) assert.match(badge.text, /周额度/);
  });
}

test('weekly-only recovery is green, but unknown existing windows cannot imply full recovery', () => {
  const a = tracker(); a.update(state(null, 0));
  assert.equal(a.update(state(null, 100, 2)).alerts.quotaBadge.severity, 'recovered');
  const b = tracker(); b.update(state(0, 50));
  const badge = b.update(state(100, null, 2)).alerts.quotaBadge;
  assert.equal(badge.severity, 'unknown'); assert.match(badge.text, /暂不可用/);
});

test('used and expired cards remove pending badges, including after failure', () => {
  let clock = now;
  const a = new QuotaAlerts({}, () => {}, () => clock); a.update(state());
  assert.equal(a.update(state(18, 16, 1, [])).alerts.creditBadges.length, 0);
  a.update(state(18, 16, 2, [card('b')])); clock += 2 * hour;
  assert.equal(a.update({ ...state(), status: 'stale' }).alerts.creditBadges.length, 0);
});

test('period rollover rearms thresholds and pending resets do not consume the event', () => {
  const a = tracker(); a.update(state()); a.dismiss('quota');
  a.saved.windows.fiveHour.resetsAt = (now - 1) / 1000;
  assert.ok(a.update(state()).alerts.quotaBadge);
  a.update({ ...state(100, 68, 2), isResetting: true });
  const next = a.update({ ...state(100, 68, 2), lastManualResetAt: now }).alerts;
  assert.equal(next.quotaBadge, null, 'positive-to-positive reset is not exhausted recovery');
});

test('controller marks successful full reads, never pushes or failed reads, as refreshes', async t => {
  let push, fail = false;
  const controller = new RefreshController({
    onRateLimitsUpdated(fn) { push = fn; return () => {}; },
    async readRateLimits() { if (fail) throw Error('offline'); return { rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300 } }, rateLimitResetCredits: null }; },
  }, { retryDelaysMs: [] });
  t.after(() => controller.stop());
  await controller.start(); assert.equal(controller.state.refreshId, 1);
  push({ primary: { usedPercent: 30 } }); assert.equal(controller.state.refreshId, 1);
  fail = true; await controller.refreshNow(); assert.equal(controller.state.refreshId, 1);
  fail = false; await controller.refreshNow(); assert.equal(controller.state.refreshId, 2);
});

test('legacy exhausted readings migrate without replaying the new zero threshold', () => {
  const old = { windows: { fiveHour: { remaining: 0, resetsAt: (now + hour) / 1000, notified: [20, 10] } } };
  assert.equal(tracker(old).update(state(0, 68)).alerts.quotaBadge, null);
});

test('confirmed manual resets rearm thresholds once, and recovery waits for settled readings', () => {
  const a = tracker(); a.update(state(8, 68)); a.dismiss('quota');
  assert.equal(a.update(state(18, 68)).alerts.quotaBadge, null);
  assert.equal(a.update({ ...state(18, 68, 2), lastManualResetAt: now }).alerts.quotaBadge.severity, 'low');
  a.dismiss('quota');
  assert.equal(a.update({ ...state(17, 68, 2), lastManualResetAt: now }).alerts.quotaBadge, null);
  a.update(state(0, 68, 3));
  a.update({ ...state(100, 68, 4), isResetting: true });
  assert.equal(a.update({ ...state(100, 68, 4), lastManualResetAt: now + 1 }).alerts.quotaBadge.severity, 'recovered');
});
