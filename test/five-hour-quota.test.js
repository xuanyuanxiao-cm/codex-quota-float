const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeRateLimits } = require('../dist/usage-model');
const { buildRendererViewModel, formatCountdown } = require('../dist/renderer/view-model');

const unavailableWindow = {
  remainingPercent: null,
  resetsAt: null,
  windowDurationMins: null,
};

test('keeps the five-hour and weekly windows as separate remaining quotas', () => {
  const result = normalizeRateLimits({
    primary: {
      usedPercent: 18,
      resetsAt: 1_700_017_520,
      windowDurationMins: 300,
    },
    secondary: {
      usedPercent: 36,
      resetsAt: 1_700_176_400,
      windowDurationMins: 10_080,
    },
  });

  assert.deepEqual(result, {
    fiveHour: {
      remainingPercent: 82,
      resetsAt: 1_700_017_520,
      windowDurationMins: 300,
    },
    weekly: {
      remainingPercent: 64,
      resetsAt: 1_700_176_400,
      windowDurationMins: 10_080,
    },
  });
});

test('leaves a missing five-hour window unavailable without borrowing weekly data', () => {
  const result = normalizeRateLimits({
    primary: {
      usedPercent: 36,
      resetsAt: 1_700_176_400,
      windowDurationMins: 10_080,
    },
  });

  assert.deepEqual(result.fiveHour, unavailableWindow);
  assert.equal(result.weekly.remainingPercent, 64);
});

test('builds independent ring, percentage, and timing values for both quota windows', () => {
  const now = new Date(2026, 7, 26, 12, 0).getTime();
  const fiveHourReset = new Date(2026, 7, 26, 16, 52).getTime() / 1_000;
  const weeklyReset = new Date(2026, 8, 1, 23, 59).getTime() / 1_000;
  const model = buildRendererViewModel({
    status: 'ready',
    fiveHour: { remainingPercent: 82, resetsAt: fiveHourReset, windowDurationMins: 300 },
    weekly: { remainingPercent: 64, resetsAt: weeklyReset, windowDurationMins: 10_080 },
    resetCredits: null,
    isResetting: false,
    lastUpdatedAt: now,
    errorMessage: null,
  }, now);

  assert.deepEqual({
    fiveHourRingPercent: model.fiveHourRingPercent,
    weeklyRingPercent: model.weeklyRingPercent,
    fiveHourText: model.fiveHourText,
    weeklyText: model.weeklyText,
    fiveHourCountdown: model.fiveHourCountdown,
    weeklyCountdown: model.weeklyCountdown,
    fiveHourResetAtText: model.fiveHourResetAtText,
    weeklyResetAtText: model.weeklyResetAtText,
  }, {
    fiveHourRingPercent: 82,
    weeklyRingPercent: 64,
    fiveHourText: '82%',
    weeklyText: '64%',
    fiveHourCountdown: '4h52m',
    weeklyCountdown: '155h59m',
    fiveHourResetAtText: '26Y 08M 26D 16:52',
    weeklyResetAtText: '26Y 09M 01D 23:59',
  });
});

test('formats countdowns compactly for the right-hand timing column', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatCountdown(1_700_017_520, now), '4h52m');
  assert.equal(formatCountdown(1_700_000_540, now), '9m');
});
