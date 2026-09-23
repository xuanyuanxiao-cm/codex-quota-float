const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function element() {
  const properties = new Map();
  return {
    attributes: new Map(),
    classList: { toggle() {} },
    dataset: {},
    disabled: false,
    hidden: false,
    style: {
      getPropertyValue: (name) => properties.get(name),
      setProperty: (name, value) => properties.set(name, value),
    },
    textContent: '',
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
}

test('renders both quota rings and the two percentage-only center values', () => {
  const now = new Date(2026, 7, 26, 12, 0).getTime();
  class FixedDate extends Date {
    static now() { return now; }
  }
  const weeklyRing = element();
  const fiveHourRing = element();
  const weeklyCenter = element();
  const fiveHourCenter = element();
  const fiveHourCountdown = element();
  const fiveHourResetAt = element();
  const weeklyCountdown = element();
  const weeklyResetAt = element();
  const details = element();
  const orb = element();
  const creditPicker = element();
  creditPicker.hidden = true;
  const selectors = new Map([
    ['[data-action="toggle-pin"]', orb],
    ['[data-details]', details],
    ['[data-action="refresh"]', element()],
    ['[data-action="reset"]', element()],
    ['[data-reset-count]', element()],
    ['[data-credit-picker]', creditPicker],
    ['[data-credit-list]', element()],
    ['[data-picker-selection]', element()],
    ['[data-credit-error]', element()],
    ['[data-action="cancel-reset"]', element()],
    ['[data-action="confirm-reset"]', element()],
    ['[data-action="restore-from-edge"]', element()],
    ['[data-window="five-hour"]', fiveHourRing],
    ['[data-window="weekly"]', weeklyRing],
    ['[data-center="five-hour"]', fiveHourCenter],
    ['[data-center="weekly"]', weeklyCenter],
    ['[data-center]', weeklyCenter],
    ['[data-value="five-hour"]', element()],
    ['[data-value="weekly"]', element()],
    ['[data-countdown="five-hour"]', fiveHourCountdown],
    ['[data-reset-at="five-hour"]', fiveHourResetAt],
    ['[data-countdown="weekly"]', weeklyCountdown],
    ['[data-reset-at="weekly"]', weeklyResetAt],
    ['[data-last-updated]', element()],
    ['[data-accessible-status]', element()],
    ['[data-note]', element()],
  ]);
  const root = element();
  root.querySelector = (selector) => selectors.get(selector) ?? null;

  let renderState;
  const quota = {
    subscribe(listener) { renderState = listener; return () => {}; },
    subscribeEdgeHidden() { return () => {}; },
    refreshNow() {},
    resetQuota() {},
    moveToY() {},
    startDrag() {},
    stopDrag() {},
    setEdgeHidden() {},
  };
  const windowObject = {
    quota,
    addEventListener() {},
    removeEventListener() {},
    confirm: () => false,
  };
  const context = {
    console,
    Date: FixedDate,
    document: { querySelector: (selector) => selector === '[data-quota-app]' ? root : null },
    setTimeout,
    clearTimeout,
    window: windowObject,
  };

  const renderer = fs.readFileSync(path.join(__dirname, '..', 'dist', 'renderer', 'renderer.js'), 'utf8');
  vm.runInNewContext(renderer, context);
  assert.equal(typeof renderState, 'function');

  renderState({
    status: 'ready',
    fiveHour: {
      remainingPercent: 82,
      resetsAt: new Date(2026, 7, 26, 16, 52).getTime() / 1_000,
      windowDurationMins: 300,
    },
    weekly: {
      remainingPercent: 64,
      resetsAt: new Date(2026, 8, 1, 23, 59).getTime() / 1_000,
      windowDurationMins: 10_080,
    },
    resetCredits: null,
    isResetting: false,
    lastUpdatedAt: now,
    errorMessage: null,
  });

  assert.equal(fiveHourRing.style.getPropertyValue('--progress'), '82%');
  assert.equal(weeklyRing.style.getPropertyValue('--progress'), '64%');
  assert.equal(fiveHourCenter.textContent, '82%');
  assert.equal(weeklyCenter.textContent, '64%');
  assert.equal(fiveHourCountdown.textContent, '4h52m');
  assert.equal(weeklyCountdown.textContent, '155h59m');
  assert.equal(fiveHourResetAt.textContent, '26Y 08M 26D 16:52');
  assert.equal(weeklyResetAt.textContent, '26Y 09M 01D 23:59');
});
