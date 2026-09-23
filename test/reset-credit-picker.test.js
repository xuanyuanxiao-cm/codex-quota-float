const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function element() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    children: [],
    className: '',
    classList: { toggle() {} },
    dataset: {},
    disabled: false,
    hidden: false,
    style: { setProperty() {} },
    textContent: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    click() { listeners.get('click')?.({}); },
  };
}

function mount() {
  const selectors = new Map();
  for (const selector of [
    '[data-action="toggle-pin"]', '[data-details]', '[data-action="refresh"]',
    '[data-action="reset"]', '[data-reset-count]', '[data-credit-picker]',
    '[data-credit-list]', '[data-picker-selection]', '[data-credit-error]',
    '[data-action="cancel-reset"]', '[data-action="confirm-reset"]',
    '[data-action="restore-from-edge"]', '[data-window="five-hour"]',
    '[data-window="weekly"]', '[data-center="five-hour"]',
    '[data-center="weekly"]', '[data-value="five-hour"]',
    '[data-value="weekly"]', '[data-countdown="five-hour"]',
    '[data-reset-at="five-hour"]', '[data-countdown="weekly"]',
    '[data-reset-at="weekly"]', '[data-last-updated]',
    '[data-accessible-status]', '[data-note]',
  ]) selectors.set(selector, element());
  selectors.get('[data-credit-picker]').hidden = true;
  const root = element();
  root.querySelector = (selector) => selectors.get(selector);
  const calls = [];
  let renderState;
  const quota = {
    subscribe(listener) { renderState = listener; return () => {}; },
    subscribeEdgeHidden() { return () => {}; },
    resetQuota: async (creditId) => { calls.push(creditId); return { outcome: 'reset' }; },
    refreshNow() {}, setEdgeHidden() {}, startDrag() {}, stopDrag() {}, moveToY() {},
  };
  const script = fs.readFileSync(path.join(__dirname, '..', 'dist', 'renderer', 'renderer.js'), 'utf8');
  vm.runInNewContext(script, {
    document: { querySelector: (selector) => selector === '[data-quota-app]' ? root : null, createElement: element },
    window: { quota, addEventListener() {}, removeEventListener() {} },
    Date, Intl, setTimeout, clearTimeout,
  });
  return { selectors, calls, renderState };
}

const state = {
  status: 'ready',
  fiveHour: { remainingPercent: 5, resetsAt: null },
  weekly: { remainingPercent: 8, resetsAt: null },
  resetCredits: {
    availableCount: 3,
    credits: [
      { id: 'soon', status: 'available', title: 'Soon', expiresAt: 1_800_000_000 },
      { id: 'later', status: 'available', title: 'Later', expiresAt: 1_900_000_000 },
      { id: 'used', status: 'consumed', title: 'Used', expiresAt: 1_700_000_000 },
      { id: 'unknown', status: 'available', title: 'No expiry' },
    ],
  },
  isResetting: false,
  lastUpdatedAt: null,
  errorMessage: null,
};

test('Reset opens available credits with the soonest-expiring card selected without consuming it', () => {
  const { selectors, calls, renderState } = mount();
  renderState(state);
  selectors.get('[data-action="reset"]').click();
  const options = selectors.get('[data-credit-list]').children;
  assert.equal(selectors.get('[data-credit-picker]').hidden, false);
  assert.equal(options.length, 3);
  assert.equal(options[0].dataset.creditId, 'soon');
  assert.equal(options[0].getAttribute('aria-pressed'), 'true');
  assert.equal(options[2].dataset.creditId, 'unknown');
  assert.deepEqual(calls, []);
});

test('credit choices use short reset-card labels and show only expiry and a short identifier', () => {
  const { selectors, renderState } = mount();
  const first = {
    ...state.resetCredits.credits[0],
    id: 'reset-credit-123456',
    title: 'An unusually long product name that should not fill the picker',
    expiresAt: new Date(2027, 0, 15, 12).getTime() / 1_000,
  };
  renderState({
    ...state,
    resetCredits: { ...state.resetCredits, credits: [first, ...state.resetCredits.credits.slice(1)] },
  });
  selectors.get('[data-action="reset"]').click();
  const firstOption = selectors.get('[data-credit-list]').children[0];
  assert.equal(firstOption.children[0].textContent, '重置卡 1');
  assert.equal(firstOption.children[1].textContent, '2027/1/15 到期 · 编号 …3456');
  assert.equal(selectors.get('[data-picker-selection]').textContent, '将使用：重置卡 1');
});

test('selecting another card sends its ID only after confirmation', async () => {
  const { selectors, calls, renderState } = mount();
  renderState(state);
  selectors.get('[data-action="reset"]').click();
  selectors.get('[data-credit-list]').children[1].click();
  assert.deepEqual(calls, []);
  selectors.get('[data-action="confirm-reset"]').click();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['later']);
  assert.equal(selectors.get('[data-credit-picker]').hidden, true);
});

test('canceling card selection consumes nothing', () => {
  const { selectors, calls, renderState } = mount();
  renderState(state);
  selectors.get('[data-action="reset"]').click();
  selectors.get('[data-action="cancel-reset"]').click();
  assert.equal(selectors.get('[data-credit-picker]').hidden, true);
  assert.deepEqual(calls, []);
});
