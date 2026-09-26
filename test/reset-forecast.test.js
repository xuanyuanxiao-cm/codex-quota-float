const assert = require('node:assert/strict');
const test = require('node:test');
const { estimateResetForecast } = require('../dist/reset-forecast');
const DAY = 86400000;
const now = Date.UTC(2026, 8, 27);
const records = Array.from({ length: 15 }, (_, i) => ({ kind: 'reset', publishedAt: now - (i + 0.5) * 2 * DAY }));

test('forecast uses smoothed occupied 24-hour windows, not the polling time slot', () => {
  const result = estimateResetForecast(records, now, now);
  assert.equal(result.status, 'estimated');
  assert.equal(result.days, 29);
  assert.equal(result.positive, 14);
  assert.equal(result.samples, 15);
  assert.equal(result.percent, 48);
});

test('duplicates, adjacent posts, hints and future timestamps do not inflate the estimate', () => {
  const extra = [
    ...records, ...records,
    ...records.map(r => ({ ...r, publishedAt: r.publishedAt + 3600000 })),
    { kind: 'hint', publishedAt: now - DAY / 2 },
    { kind: 'limits', publishedAt: now - DAY / 2 },
    { kind: 'reset', publishedAt: now + DAY },
  ];
  assert.deepEqual(estimateResetForecast(extra, now, now), estimateResetForecast(records, now, now));
});

test('insufficient or stale observations suppress a numerical forecast', () => {
  for (const timings of [[], records.slice(0, 11), records.map(r => ({ ...r, publishedAt: now - DAY }))]) {
    assert.equal(estimateResetForecast(timings, now, now).percent, null);
  }
  for (const asOf of [undefined, NaN, now + 1, now - 6 * 3600000 - 1]) {
    assert.equal(estimateResetForecast(records, asOf, now).percent, null);
  }
});

test('old data is excluded and banked resets count in the stated announcement scope', () => {
  const withOld = [...records, { kind: 'reset', publishedAt: now - 100 * DAY }];
  assert.deepEqual(estimateResetForecast(withOld, now, now), estimateResetForecast(records, now, now));
  assert.equal(estimateResetForecast(records.map(r => ({ ...r, kind: 'banked' })), now, now).percent, 48);
});
