const assert = require('node:assert/strict');
const test = require('node:test');
const { autoRange, nearestSample } = require('../dist/renderer/trend-model');
const minute = 60000;
const sample = (at, weekly, fiveHour = null, extra = {}) => ({ at: at * minute, weekly: { remainingPercent: weekly }, fiveHour: { remainingPercent: fiveHour }, ...extra });

for (const [duration, span] of [[25, 30], [45, 60], [120, 180]]) {
  test(`auto range expands ${duration} minutes of concentrated usage into ${span} minutes`, () => {
    const samples = Array.from({ length: duration / 5 + 1 }, (_, i) => sample(i * 5, 100 - 80 * i * 5 / duration));
    const range = autoRange(samples, duration * minute);
    assert.equal(range.end - range.start, span * minute);
    assert.ok(range.start <= samples[0].at && range.end >= samples.at(-1).at);
    assert.deepEqual(autoRange(samples, 10 * 86400000, range), range, 'idle wall-clock time does not erase the recent burst');
  });
}
test('30 observed idle minutes separate bursts; both quota windows contribute', () => {
  const samples = [sample(0, 90, 100), sample(5, 80, 100)];
  for (let i = 10; i <= 35; i += 5) samples.push(sample(i, 80, 100));
  samples.push(sample(40, 80, 70), sample(45, 70, 70));
  const range = autoRange(samples, 45 * minute);
  assert.equal(range.sessionStart, 35 * minute);
  assert.ok(range.start <= 35 * minute && range.end >= 45 * minute);
});
test('failed or missing observations cannot establish an idle period or a measured drop', () => {
  const samples = [sample(0, 100), sample(5, 90), sample(50, 50, null, { gapBefore: true }), sample(55, 40)];
  assert.equal(autoRange(samples, 55 * minute).sessionStart, 0);
  assert.equal(autoRange([sample(0, 100), sample(60, 10)], 60 * minute).sessionStart, 0, 'fall back to recorded extent');
});
test('continued consumption only expands the current automatic viewport', () => {
  const samples = [sample(0, 100), sample(5, 90)];
  const first = autoRange(samples, 5 * minute);
  samples.push(sample(10, 80), sample(15, 70));
  const next = autoRange(samples, 15 * minute, first);
  assert.ok(next.start <= first.start && next.end >= first.end);
});
test('empty and single-point histories have a useful nonzero range', () => {
  for (const samples of [[], [sample(0, 80)]]) {
    const range = autoRange(samples, 0);
    assert.ok(range.end > range.start);
  }
});
test('hover snaps by pixel distance on long ranges but never bridges a gap', () => {
  const samples = [sample(0, 100), sample(5, 90), sample(60, 50, null, { gapBefore: true })];
  assert.equal(nearestSample(samples, 4 * minute, 1 / minute), samples[1]);
  assert.equal(nearestSample(samples, 6 * minute, .01 / minute), null);
  assert.equal(nearestSample(samples, 60 * minute, .01 / minute), samples[2]);
  assert.equal(nearestSample(samples, -minute, .01 / minute), null);
  assert.equal(nearestSample(samples, 2 * minute, 10 / minute), null);
});
