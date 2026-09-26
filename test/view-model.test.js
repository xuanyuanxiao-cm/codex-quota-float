const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRendererViewModel, formatLastUpdatedAt } = require('../dist/renderer/view-model');
const state = (overrides = {}) => ({
  status: 'ready', weekly: { remainingPercent: 87, resetsAt: 1700176400, windowDurationMins: 10080 },
  resetCredits: { availableCount: 1, credits: [{ id: 'one', status: 'available' }] },
  isResetting: false, lastUpdatedAt: 1700000000000, errorMessage: null, ...overrides,
});

for (const [status, text] of [['loading', '刷新中…'], ['error', '连接失败'], ['ready', '暂不可用']]) {
  test(`${status} without a reading shows the correct placeholder`, () => {
    const model = buildRendererViewModel(state({ status, weekly: { remainingPercent: null, resetsAt: null }, lastUpdatedAt: null }));
    assert.equal(model.weeklyText, text);
    assert.equal(model.weeklyCountdown, text);
    assert.equal(model.weeklyRingPercent, 0);
    assert.equal(model.lastUpdatedText, null);
  });
}

test('stale and error states keep the last reading and localized update time', () => {
  for (const status of ['stale', 'error']) {
    const model = buildRendererViewModel(state({ status, errorMessage: '连接失败' }));
    assert.equal(model.weeklyRingPercent, 87); assert.equal(model.weeklyText, '87%');
    assert.equal(model.note, '连接失败');
    assert.match(model.lastUpdatedText, /^最后更新于 \d{2}:\d{2}:\d{2}$/);
  }
  assert.match(formatLastUpdatedAt(1700000000000, 'en-US'), /^最后更新于 \d{2}:\d{2}:\d{2}$/);
});

test('refresh and reset controls reflect loading, busy, missing and available credits', () => {
  assert.equal(buildRendererViewModel(state()).resetDisabled, false);
  for (const overrides of [{ status: 'loading' }, { isResetting: true }, { resetCredits: null },
    { resetCredits: { availableCount: 0, credits: [] } }]) {
    assert.equal(buildRendererViewModel(state(overrides)).resetDisabled, true);
  }
  const loading = buildRendererViewModel(state({ status: 'loading' }));
  assert.equal(loading.refreshDisabled, true); assert.equal(loading.note, '正在刷新…');
  assert.equal(buildRendererViewModel(state()).refreshDisabled, false);
  assert.equal(buildRendererViewModel(state()).resetCountText, '1');
});

test('absolute reset time is omitted when unavailable', () => {
  assert.equal(buildRendererViewModel(state({ weekly: { remainingPercent: 87, resetsAt: null } })).weeklyResetAtText, null);
});
