const assert = require('node:assert/strict');
const test = require('node:test');
const { autoRange, nearestSample } = require('../dist/renderer/trend-model');
const minute = 60000;
const sample = (at, weekly, fiveHour = null, extra = {}) => ({ at: at * minute, weekly: { remainingPercent: weekly }, fiveHour: { remainingPercent: fiveHour }, ...extra });

for (const [duration, span] of [[25, 30], [45, 50], [120, 132]]) {
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
test('short missing observations do not establish idle time or a measured drop', () => {
  const samples = [sample(0, 100), sample(5, 90), sample(20, 50, null, { gapBefore: true }), sample(25, 40)];
  assert.equal(autoRange(samples, 25 * minute).sessionStart, 0);
});
test('long recording interruptions select the newest segment, even before its first measured drop', () => {
  const old = [sample(0, 100), sample(5, 90)];
  const previous = autoRange(old, 5 * minute);
  for (const gap of [30, 60, 1440]) {
    const resumed = 5 + gap;
    const samples = [...old, sample(resumed, 80, null, { gapBefore: true })];
    const range = autoRange(samples, resumed * minute, previous);
    assert.equal(range.sessionStart, resumed * minute);
    assert.equal(range.end - range.start, 30 * minute);
    samples.push(sample(resumed + 5, 70));
    assert.equal(autoRange(samples, (resumed + 5) * minute, range).sessionStart, resumed * minute);
  }
});
test('multi-day history focuses the latest two-hour burst rather than rounding up to seven days', () => {
  const recent = Array.from({ length: 27 }, (_, i) => sample(2880 + i * 5, 100 - i, i < 18 ? 100 - i * 5 : null, { gapBefore: i === 0 || i === 18 }));
  const range = autoRange([sample(0, 100), sample(5, 90), sample(1440, 80), sample(1445, 70), ...recent], 3010 * minute);
  assert.equal(range.sessionStart, 2880 * minute);
  assert.ok(range.end - range.start < 150 * minute);
  assert.ok(range.start <= recent[0].at && range.end >= recent.at(-1).at);
});
test('continuous usage over 24 hours gets proportional padding instead of a seven-day bucket', () => {
  const samples = Array.from({ length: 301 }, (_, i) => sample(i * 5, 100 - i / 4));
  const range = autoRange(samples, 1500 * minute);
  assert.equal(range.end - range.start, 1650 * minute);
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
