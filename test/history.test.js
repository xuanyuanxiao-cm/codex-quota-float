const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { UsageHistory } = require('../dist/history');
const now = 1800000000000;
const makeState = (at, remaining, extra = {}) => ({
  status: 'ready', lastUpdatedAt: at, isResetting: false,
  fiveHour: { remainingPercent: remaining, resetsAt: (now + 3600000) / 1000 },
  weekly: { remainingPercent: 68, resetsAt: (now + 7 * 86400000) / 1000 }, ...extra,
});
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'history.json');
  return { file, history: new UsageHistory(file, () => now + 7200000) };
}
test('history persists success readings, deduplicates repeated emissions, and starts a new segment after restart', (t) => {
  const { file, history } = setup(t);
  history.record(makeState(now, 80));
  history.record(makeState(now, 80));
  history.record(makeState(now + 300000, 60));
  assert.equal(history.read().samples.length, 2);
  const restored = new UsageHistory(file, () => now + 7200000);
  restored.record(makeState(now + 600000, 40));
  assert.equal(restored.read().samples[2].gapBefore, true);
});
test('failures produce a data gap and cannot be recorded as successful usage', (t) => {
  const { history } = setup(t);
  history.record(makeState(now, 80));
  history.record(makeState(now + 300000, 80, { status: 'stale' }));
  history.record(makeState(now + 600000, 60));
  assert.equal(history.read().samples.length, 2);
  assert.equal(history.read().samples[1].gapBefore, true);
});
test('period resets are identified only with timing evidence; unexplained increases remain separate', (t) => {
  const { history } = setup(t);
  history.record(makeState(now + 3300000, 0));
  history.record(makeState(now + 3600001, 100, { fiveHour: { remainingPercent: 100, resetsAt: (now + 7200000) / 1000 } }));
  assert.equal(history.read().samples[1].events.fiveHour, 'period');
  history.record(makeState(now + 3900000, 90));
  history.record(makeState(now + 4200000, 95));
  assert.equal(history.read().samples[3].events.fiveHour, 'increase');
});
test('confirmed manual reset is recorded once after the reset operation completes', (t) => {
  const { history } = setup(t);
  history.record(makeState(now, 5));
  history.record(makeState(now + 300000, 100, { lastManualResetAt: now + 290000, isResetting: true }));
  history.record(makeState(now + 300000, 100, { lastManualResetAt: now + 290000 }));
  history.record(makeState(now + 600000, 95, { lastManualResetAt: now + 290000 }));
  assert.equal(history.read().samples[1].events.fiveHour, 'manual');
  assert.equal(history.read().samples.filter((sample) => sample.manualReset).length, 1);
});
test('older than seven days is pruned and unavailable windows remain null', (t) => {
  const { history } = setup(t);
  history.record(makeState(now - 8 * 86400000, 50));
  history.record(makeState(now, null));
  assert.equal(history.read().samples.length, 1);
  assert.equal(history.read().samples[0].fiveHour.remainingPercent, null);
});
