const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeRateLimits } = require('../dist/usage-model');
const empty = { remainingPercent: null, resetsAt: null, windowDurationMins: null };

test('a lone five-hour window is not reused for weekly quota', () => {
  const result = normalizeRateLimits({ primary: { usedPercent: 20, windowDurationMins: 300 }, secondary: null });
  assert.equal(result.fiveHour.remainingPercent, 80);
  assert.deepEqual(result.weekly, empty);
});

test('duration-less secondary windows retain the compatibility fallback', () => {
  assert.deepEqual(normalizeRateLimits({ secondary: { usedPercent: 25, resetsAt: 123 } }).weekly,
    { remainingPercent: 75, resetsAt: 123, windowDurationMins: null });
});

test('remaining percentages convert endpoints and clamp out-of-range usage', () => {
  for (const [usedPercent, remainingPercent] of [[0, 100], [100, 0], [-25, 100], [125, 0]]) {
    const result = normalizeRateLimits({ primary: { usedPercent, windowDurationMins: 300 },
      secondary: { usedPercent, windowDurationMins: 10080 } });
    assert.equal(result.fiveHour.remainingPercent, remainingPercent);
    assert.equal(result.weekly.remainingPercent, remainingPercent);
  }
});

test('missing windows and percentages remain unavailable while timing survives', () => {
  assert.deepEqual(normalizeRateLimits({ primary: null }), { fiveHour: empty, weekly: empty });
  assert.deepEqual(normalizeRateLimits({ secondary: { resetsAt: 123, windowDurationMins: 10080 } }).weekly,
    { remainingPercent: null, resetsAt: 123, windowDurationMins: 10080 });
});
