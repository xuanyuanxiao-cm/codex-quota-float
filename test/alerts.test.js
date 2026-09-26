const assert = require('node:assert/strict');
const test = require('node:test');
const { QuotaAlerts, nextRefreshDelay } = require('../dist/alerts');
const now = 1800000000000;
const hour = 3600000;
const state = (fiveHour = 80, weekly = 70, credits = []) => ({
  status: 'ready', isResetting: false,
  fiveHour: { remainingPercent: fiveHour, resetsAt: (now + hour) / 1000 },
  weekly: { remainingPercent: weekly, resetsAt: (now + 7 * 24 * hour) / 1000 },
  resetCredits: { credits },
});
const tracker = (saved) => new QuotaAlerts(saved, () => {}, () => now);
const card = (id, hours, status = 'available') => ({ id, status, expiresAt: (now + hours * hour) / 1000 });

test('20% and 10% notify once per window, including across app restarts', () => {
  let saved;
  const alerts = new QuotaAlerts({}, (value) => { saved = structuredClone(value); }, () => now);
  assert.equal(alerts.update(state()).notifications.length, 0);
  assert.equal(alerts.update(state(20)).notifications[0].kind, 'low');
  assert.equal(alerts.update(state(19)).notifications.length, 0);
  assert.equal(alerts.update(state(10)).notifications.length, 1);
  assert.equal(tracker(saved).update(state(9)).notifications.length, 0);
  assert.match(alerts.update(state(9, 19)).notifications[0].title, /每周/);
  alerts.update(state(80));
  assert.equal(alerts.update(state(19)).notifications.length, 1);
});

test('a jump below both thresholds emits one notification and does not repeat on jitter', () => {
  const alerts = tracker();
  assert.equal(alerts.update(state(8)).notifications.length, 1);
  assert.equal(alerts.update(state(12)).notifications.length, 0);
  assert.equal(alerts.update(state(8)).notifications.length, 0);
});

test('only confirmed zero-to-positive readings notify recovery; stale and missing data do not', () => {
  const alerts = tracker();
  alerts.update(state(0));
  assert.equal(alerts.update({ ...state(100), status: 'stale' }).notifications.length, 0);
  assert.equal(alerts.update(state(null)).notifications.length, 0);
  const recovered = alerts.update(state(100));
  assert.equal(recovered.notifications[0].kind, 'recovered');
  assert.equal(recovered.alerts.windows.fiveHour.recoveredUntil, now + 60000);
  assert.equal(alerts.update(state(100)).notifications.length, 0);
  assert.equal(tracker().update(state(100)).notifications.length, 0);
});

test('manual reset suppresses duplicate recovery, even if its refresh failed', () => {
  for (const failed of [false, true]) {
    const alerts = tracker();
    alerts.update(state(0));
    alerts.update({ ...state(0), isResetting: true });
    alerts.update({ ...state(100), isResetting: true, status: failed ? 'stale' : 'ready' });
    if (failed) alerts.update({ ...state(0), status: 'stale' });
    assert.equal(alerts.update(state(100)).notifications.length, 0);
    alerts.update(state(0));
    assert.equal(alerts.update(state(100)).notifications[0].kind, 'recovered');
  }
});

test('recovery does not claim usage is available while the other window is exhausted', () => {
  const alerts = tracker();
  alerts.update(state(0, 0));
  const recovery = alerts.update(state(100, 0)).notifications[0];
  assert.equal(recovery.kind, 'recovered');
  assert.match(recovery.body, /每周额度仍已用尽/);
  assert.doesNotMatch(recovery.body, /可以继续/);
});

test('time crossing into 24 hours warns once, then expiry removes the clock badge', () => {
  let clock = now;
  const alerts = new QuotaAlerts({}, () => {}, () => clock);
  const snapshot = state(80, 70, [card('a', 25)]);
  assert.equal(alerts.update(snapshot).notifications.length, 0);
  clock += hour;
  assert.equal(alerts.update(snapshot).notifications[0].kind, 'expiring');
  clock += hour;
  assert.equal(alerts.update(snapshot).notifications.length, 0);
  clock += 23 * hour;
  assert.equal(alerts.update(snapshot).alerts.expiringCredits.length, 0);
});

test('expiring cards group into one orange alert, exclude unavailable dates and deduplicate', () => {
  const alerts = tracker();
  const credits = [card('a', 18), card('b', 24), card('later', 25), card('past', -1), card('used', 2, 'consumed'), { id: 'unknown', status: 'available' }];
  const result = alerts.update(state(80, 70, credits));
  assert.deepEqual(result.alerts.expiringCredits.map((credit) => credit.id), ['a', 'b']);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].kind, 'expiring');
  assert.equal(result.notifications[0].target, 'credits');
  assert.equal(tracker(alerts.saved).update(state(80, 70, credits)).notifications.length, 0);
  assert.equal(alerts.update(state()).alerts.expiringCredits.length, 0);
});

test('disabled desktop notifications still update badges and deduplication', () => {
  const alerts = tracker();
  alerts.setEnabled(false);
  const result = alerts.update(state(10, 70, [card('a', 18)]));
  assert.equal(result.notifications.length, 0);
  assert.equal(result.alerts.windows.fiveHour.low, true);
  assert.equal(result.alerts.expiringCredits.length, 1);
  alerts.setEnabled(true);
  assert.equal(alerts.update(state(10, 70, [card('a', 18)])).notifications.length, 0);
});

test('refresh wakes at reset and card warning boundaries, without looping on past deadlines', () => {
  const soon = state();
  soon.fiveHour.resetsAt = (now + 20000) / 1000;
  assert.equal(nextRefreshDelay(soon, now, 300000), 21000);
  const creditDue = state(80, 70, [card('a', 24 + 1 / 60)]);
  assert.equal(nextRefreshDelay(creditDue, now, 300000), 61000);
  soon.fiveHour.resetsAt = now / 1000 - 1;
  assert.equal(nextRefreshDelay(soon, now, 300000), 300000);
});
