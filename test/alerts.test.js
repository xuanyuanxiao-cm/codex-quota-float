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

test('time crossing into 24 hours warns once and expiry removes the badge', () => {
  let clock = now;
  const alerts = new QuotaAlerts({}, () => {}, () => clock);
  const snapshot = state(80, 70, [card('a', 25)]);
  assert.equal(alerts.update(snapshot).alerts.creditBadges.length, 0);
  clock += hour;
  assert.equal(alerts.update(snapshot).alerts.creditBadges.length, 1);
  alerts.dismiss('credits');
  clock += hour;
  assert.equal(alerts.update(snapshot).alerts.creditBadges.length, 0);
  clock += 23 * hour;
  assert.equal(alerts.update(snapshot).alerts.expiringCredits.length, 0);
});

test('cards group by valid expiry and persist deduplication across restarts', () => {
  const alerts = tracker();
  const credits = [card('a', 18), card('b', 24), card('later', 25), card('past', -1), card('used', 2, 'consumed'), { id: 'unknown', status: 'available' }];
  assert.deepEqual(alerts.update(state(80, 70, credits)).alerts.creditBadges.map(c => c.id), ['a', 'b']);
  assert.equal(tracker(alerts.saved).update(state(80, 70, credits)).alerts.creditBadges.length, 0);
  assert.equal(alerts.update(state()).alerts.expiringCredits.length, 0);
});

test('stale or missing readings never invent recovery and reminders have no fixed timeout', () => {
  let clock = now;
  const alerts = new QuotaAlerts({}, () => {}, () => clock);
  alerts.update(state(0));
  assert.equal(alerts.update({ ...state(100), status: 'stale' }).alerts.quotaBadge.severity, 'exhausted');
  alerts.update(state(null));
  assert.equal(alerts.update(state(100)).alerts.quotaBadge.severity, 'recovered');
  clock += 11 * 60000;
  assert.equal(alerts.update(state(100)).alerts.quotaBadge.severity, 'recovered');
  const missing = alerts.update(state(null)).alerts.quotaBadge;
  assert.equal(missing.severity, 'unknown');
  assert.doesNotMatch(missing.text, /NaN/);
});

test('resolved warnings do not replay when a pushed reading jitters back down', () => {
  const alerts = tracker();
  alerts.update(state(18));
  assert.equal(alerts.update(state(21)).alerts.quotaBadge, null);
  assert.equal(alerts.update(state(18)).alerts.quotaBadge, null);
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
