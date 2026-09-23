const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function element(initialClasses = []) {
  const attributes = new Map();
  const classes = new Set(initialClasses);
  const listeners = new Map();

  return {
    attributes,
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    dataset: {},
    disabled: false,
    hidden: false,
    style: { setProperty() {} },
    textContent: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
    setAttribute(name, value) { attributes.set(name, value); },
  };
}

test('opens the details panel only after clicking the orb', async () => {
  const root = element(['is-collapsed']);
  const orb = element();
  const details = element();
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
    ['[data-window="five-hour"]', element()],
    ['[data-window="weekly"]', element()],
    ['[data-center="five-hour"]', element()],
    ['[data-center="weekly"]', element()],
    ['[data-value="five-hour"]', element()],
    ['[data-value="weekly"]', element()],
    ['[data-countdown="five-hour"]', element()],
    ['[data-reset-at="five-hour"]', element()],
    ['[data-countdown="weekly"]', element()],
    ['[data-reset-at="weekly"]', element()],
    ['[data-last-updated]', element()],
    ['[data-accessible-status]', element()],
    ['[data-note]', element()],
  ]);
  root.querySelector = (selector) => selectors.get(selector) ?? null;

  const quota = {
    subscribe() { return () => {}; },
    subscribeEdgeHidden() { return () => {}; },
    refreshNow() {},
    resetQuota() {},
    moveToY() {},
    startDrag() {},
    stopDrag() {},
    setEdgeHidden() {},
  };
  const windowObject = element();
  windowObject.quota = quota;
  windowObject.confirm = () => false;

  const renderer = fs.readFileSync(
    path.join(__dirname, '..', 'dist', 'renderer', 'renderer.js'),
    'utf8',
  );
  vm.runInNewContext(renderer, {
    console,
    Date,
    document: { querySelector: () => root },
    setTimeout,
    clearTimeout,
    window: windowObject,
  });

  root.dispatch('pointerenter');
  assert.equal(orb.attributes.get('aria-expanded'), 'false');

  orb.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(orb.attributes.get('aria-expanded'), 'true');
  assert.equal(root.classList.contains('is-collapsed'), false);
});
