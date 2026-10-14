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
    getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 100 }; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
    setAttribute(name, value) { attributes.set(name, value); },
  };
}

function mount() {
  const expandedChanges = [];
  const hiddenChanges = [];
  let refreshes = 0;
  let renderState;
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
    subscribe(listener) { renderState = listener; return () => {}; },
    subscribeEdgeHidden() { return () => {}; },
    refreshNow() { refreshes++; },
    resetQuota() {},
    moveToY() {},
    startDrag() {},
    stopDrag() {},
    setEdgeHidden(hidden) { hiddenChanges.push(hidden); },
    setLayout(layout) { expandedChanges.push(layout.mode); },
  };
  const windowObject = element();
  windowObject.quota = quota;
  windowObject.confirm = () => false;
  windowObject.getComputedStyle = () => ({ borderTopLeftRadius: '0px' });

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
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  return { root, orb, expandedChanges, hiddenChanges, windowObject, renderState, refreshes: () => refreshes };
}

test('opens the details panel only after clicking the orb', async () => {
  const { root, orb, expandedChanges } = mount();
  root.dispatch('pointerenter');
  assert.equal(orb.attributes.get('aria-expanded'), 'false');

  orb.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(orb.attributes.get('aria-expanded'), 'true');
  assert.equal(root.classList.contains('is-collapsed'), false);
  assert.deepEqual(expandedChanges, ['collapsed', 'normal']);

  orb.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(root.classList.contains('is-collapsed'), true);
  assert.deepEqual(expandedChanges, ['collapsed', 'normal', 'collapsed']);
});

test('double-click refreshes without toggling the details panel or hiding the orb', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = mount();
  s.orb.dispatch('click');
  s.orb.dispatch('click');
  s.orb.dispatch('dblclick');
  t.mock.timers.tick(250);
  assert.equal(s.refreshes(), 1);
  assert.equal(s.root.classList.contains('is-collapsed'), true);
  assert.deepEqual(s.expandedChanges, ['collapsed']);
  assert.deepEqual(s.hiddenChanges, []);

  s.orb.dispatch('click');
  t.mock.timers.tick(250);
  assert.equal(s.root.classList.contains('is-collapsed'), false);
  s.orb.dispatch('click');
  s.orb.dispatch('click');
  s.orb.dispatch('dblclick');
  t.mock.timers.tick(250);
  assert.equal(s.refreshes(), 2);
  assert.equal(s.root.classList.contains('is-collapsed'), false);
  assert.deepEqual(s.expandedChanges, ['collapsed', 'normal']);
  assert.deepEqual(s.hiddenChanges, []);
});

for (const pinned of [false, true]) test(`a slower double-click restores the ${pinned ? 'expanded' : 'collapsed'} panel state`, t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = mount();
  if (pinned) {
    s.orb.dispatch('click', { detail: 1 });
    t.mock.timers.tick(250);
  }
  s.orb.dispatch('pointerdown', { button: 0, screenY: 100, clientY: 20, pointerId: 1 });
  s.windowObject.dispatch('pointerup', { pointerId: 1 });
  s.orb.dispatch('click', { detail: 1 });
  t.mock.timers.tick(300);
  s.orb.dispatch('pointerdown', { button: 0, screenY: 100, clientY: 20, pointerId: 1 });
  s.windowObject.dispatch('pointerup', { pointerId: 1 });
  s.orb.dispatch('click', { detail: 2 });
  s.orb.dispatch('dblclick', { detail: 2 });
  t.mock.timers.tick(250);
  assert.equal(s.refreshes(), 1);
  assert.equal(s.root.classList.contains('is-collapsed'), !pinned);
  assert.deepEqual(s.hiddenChanges, []);
});

test('double-click while refreshing does not start another refresh', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = mount();
  s.renderState({ status: 'loading', fiveHour: { remainingPercent: null, resetsAt: null },
    weekly: { remainingPercent: null, resetsAt: null }, resetCredits: null,
    lastUpdatedAt: null, errorMessage: null });
  s.orb.dispatch('click');
  s.orb.dispatch('dblclick');
  t.mock.timers.tick(250);
  assert.equal(s.refreshes(), 0);
  assert.equal(s.root.classList.contains('is-collapsed'), true);
  assert.deepEqual(s.hiddenChanges, []);
});

test('double-click after dragging neither refreshes nor hides the orb', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = mount();
  s.orb.dispatch('pointerdown', { button: 0, screenY: 100, clientY: 20, pointerId: 1 });
  s.windowObject.dispatch('pointermove', { screenY: 110 });
  s.windowObject.dispatch('pointerup', { pointerId: 1 });
  s.orb.dispatch('click');
  s.orb.dispatch('dblclick');
  t.mock.timers.tick(250);
  assert.equal(s.refreshes(), 0);
  assert.equal(s.root.classList.contains('is-collapsed'), true);
  assert.deepEqual(s.hiddenChanges, []);
});
