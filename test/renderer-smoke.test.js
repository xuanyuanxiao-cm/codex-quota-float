const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function element() {
  const properties = new Map();
  return {
    attributes: new Map(),
    classList: { toggle(name, enabled) { this[name] = enabled; } },
    dataset: {},
    disabled: false,
    hidden: false,
    style: {
      getPropertyValue: (name) => properties.get(name),
      setProperty: (name, value) => properties.set(name, value),
    },
    textContent: '',
    getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 100 }; },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
}

function createRenderer() {
  let now = new Date(2026, 7, 26, 12, 0).getTime();
  let timerId = 0;
  const timers = new Map();
  const setTimer = (callback, delay) => {
    timers.set(++timerId, { callback, at: now + delay });
    return timerId;
  };
  const clearTimer = (id) => timers.delete(id);
  const advanceTime = (milliseconds) => {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = target;
  };
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
    ['[data-detail-window="five-hour"]', element()],
    ['.center-divider', element()],
    ['[data-plan]', element()],
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
    setLayout() {},
  };
  let tickClock;
  const windowObject = {
    quota,
    addEventListener() {},
    removeEventListener() {},
    confirm: () => false,
    getComputedStyle: () => ({ borderTopLeftRadius: '0px' }),
    setInterval(callback) { tickClock = callback; },
    setTimeout: setTimer,
    clearTimeout: clearTimer,
  };
  const context = {
    console,
    Date: FixedDate,
    document: { querySelector: (selector) => selector === '[data-quota-app]' ? root : null },
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    window: windowObject,
    ResizeObserver: class { observe() {} disconnect() {} },
  };

  const renderer = fs.readFileSync(path.join(__dirname, '..', 'dist', 'renderer', 'renderer.js'), 'utf8');
  vm.runInNewContext(renderer, context);
  assert.equal(typeof renderState, 'function');
  return {
    root, orb, selectors, renderState, tickClock, advanceTime,
    fiveHourRing, weeklyRing, fiveHourCenter, weeklyCenter,
    fiveHourCountdown, weeklyCountdown, fiveHourResetAt, weeklyResetAt,
    get now() { return now; },
  };
}

test('renders both quota rings and the two percentage-only center values', () => {
  const fixture = createRenderer();
  const {
    root, orb, selectors, renderState, tickClock,
    fiveHourRing, weeklyRing, fiveHourCenter, weeklyCenter,
    fiveHourCountdown, weeklyCountdown, fiveHourResetAt, weeklyResetAt,
  } = fixture;
  let now = fixture.now;

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

  const lastUpdatedAt = now - 5 * 60000;
  const disconnected = {
    status: 'stale', fiveHour: { remainingPercent: 82, resetsAt: null },
    weekly: { remainingPercent: 64, resetsAt: null }, resetCredits: null,
    lastUpdatedAt, errorMessage: '额度服务暂时无法连接',
  };
  renderState(disconnected);
  assert.equal(root.classList['is-quota-offline'], true);
  assert.equal(selectors.get('[data-action="refresh"]').disabled, false);
  assert.equal(fiveHourCenter.textContent, '82%');
  assert.equal(weeklyCenter.textContent, '64%');
  assert.match(orb.attributes.get('title'), /连接失败.*上次记录/);
  assert.match(orb.attributes.get('title'), /距上次成功更新：5 分钟/);
  assert.match(orb.attributes.get('title'), /每 5 分钟自动重试/);
  assert.match(orb.attributes.get('title'), /手动刷新/);
  assert.match(selectors.get('[data-accessible-status]').textContent, /上次记录/);
  now += 2 * 60000; fixture.advanceTime(2 * 60000); tickClock();
  assert.match(orb.attributes.get('title'), /距上次成功更新：7 分钟/);
  renderState({ ...disconnected, status: 'loading' });
  assert.equal(root.classList['is-quota-offline'], true, 'retrying does not make old quota look fresh');
  assert.equal(selectors.get('[data-action="refresh"]').disabled, true);
  assert.match(orb.attributes.get('title'), /正在重连/);
  assert.doesNotMatch(orb.attributes.get('title'), /每 5 分钟自动重试/);
  renderState({ ...disconnected, status: 'ready', lastUpdatedAt: now, errorMessage: null });
  assert.equal(root.classList['is-quota-offline'], false);
  assert.equal(selectors.get('[data-action="refresh"]').disabled, false);
  assert.equal(orb.attributes.get('title'), '点击查看额度详情');
  renderState({ status: 'error', resetCredits: null, lastUpdatedAt: null, errorMessage: '连接失败' });
  assert.equal(root.classList['is-quota-offline'], true);
  assert.equal(selectors.get('[data-action="refresh"]').disabled, false);
  assert.match(orb.attributes.get('title'), /尚未成功读取额度/);
  assert.match(orb.attributes.get('title'), /每 5 分钟自动重试/);
  assert.match(orb.attributes.get('title'), /手动刷新/);
  assert.doesNotMatch(orb.attributes.get('title'), /距上次成功更新/);

  const weeklyOnly = {
    status: 'ready', planType: 'pro', hasFiveHour: false,
    weekly: { remainingPercent: 73, resetsAt: null },
    resetCredits: null, lastUpdatedAt: now, errorMessage: null,
  };
  renderState(weeklyOnly);
  for (const selector of ['[data-window="five-hour"]', '[data-center="five-hour"]', '[data-detail-window="five-hour"]', '.center-divider']) {
    assert.equal(selectors.get(selector).hidden, true, selector);
  }
  assert.equal(selectors.get('[data-plan]').textContent, 'Pro');
  assert.equal(weeklyCenter.textContent, '73%');
  assert.equal(weeklyResetAt.hidden, true);
  assert.equal(weeklyResetAt.textContent, '');
  assert.doesNotMatch(selectors.get('[data-accessible-status]').textContent, /5 Hours/);
  renderState({ ...weeklyOnly, planType: 'plus', hasFiveHour: true, fiveHour: { remainingPercent: 82, resetsAt: null } });
  assert.equal(fiveHourRing.hidden, false);
  assert.equal(selectors.get('[data-detail-window="five-hour"]').hidden, false);
  assert.equal(selectors.get('[data-plan]').textContent, 'Plus');
});

function quotaState(status) {
  return {
    status,
    fiveHour: { remainingPercent: 82, resetsAt: null, windowDurationMins: 300 },
    weekly: { remainingPercent: 64, resetsAt: null, windowDurationMins: 10_080 },
    resetCredits: null,
    isResetting: false,
    lastUpdatedAt: new Date(2026, 7, 26, 12, 0).getTime(),
    errorMessage: null,
  };
}

test('loading marks the orb busy and preserves both previous quota values', () => {
  const { renderState, root, orb, fiveHourRing, weeklyRing, fiveHourCenter, weeklyCenter, advanceTime, tickClock } = createRenderer();
  renderState(quotaState('ready'));
  renderState(quotaState('loading'));

  assert.equal(root.classList['is-refreshing'], true);
  assert.equal(orb.attributes.get('aria-busy'), 'true');
  assert.equal(fiveHourRing.style.getPropertyValue('--progress'), '82%');
  assert.equal(weeklyRing.style.getPropertyValue('--progress'), '64%');
  assert.equal(fiveHourCenter.textContent, '82%');
  assert.equal(weeklyCenter.textContent, '64%');
  advanceTime(2000);
  tickClock();
  assert.equal(root.classList['is-refreshing'], true, 'loading lasts until the request settles');
  assert.notEqual(root.classList['is-refresh-success'], true);
});

test('only loading to ready flashes success for 1000ms despite ready renders and clock ticks', () => {
  const { renderState, root, orb, advanceTime, tickClock } = createRenderer();
  renderState(quotaState('ready'));
  tickClock();
  assert.notEqual(root.classList['is-refresh-success'], true, 'initial ready is not a completed refresh');

  renderState(quotaState('loading'));
  renderState(quotaState('ready'));
  assert.equal(root.classList['is-refreshing'], false);
  assert.equal(orb.attributes.get('aria-busy'), 'false');
  assert.equal(root.classList['is-refresh-success'], true);
  advanceTime(400);
  renderState(quotaState('ready'));
  tickClock();
  assert.equal(root.classList['is-refresh-success'], true, 'ordinary renders do not cancel success');
  advanceTime(599);
  assert.equal(root.classList['is-refresh-success'], true);
  advanceTime(1);
  assert.equal(root.classList['is-refresh-success'], false, 'ordinary renders do not extend the flash');
  renderState(quotaState('ready'));
  tickClock();
  advanceTime(1000);
  assert.equal(root.classList['is-refresh-success'], false, 'ready renders do not restart an expired flash');
});

test('a subsequent loading state cancels success without shortening the next successful flash', () => {
  const { renderState, root, orb, advanceTime } = createRenderer();
  renderState(quotaState('loading'));
  renderState(quotaState('ready'));
  assert.equal(root.classList['is-refresh-success'], true);
  advanceTime(500);
  renderState(quotaState('loading'));
  assert.equal(root.classList['is-refresh-success'], false);
  assert.equal(root.classList['is-refreshing'], true);
  assert.equal(orb.attributes.get('aria-busy'), 'true');
  advanceTime(100);
  renderState(quotaState('ready'));
  advanceTime(400);
  assert.equal(root.classList['is-refresh-success'], true, 'the cancelled timer cannot clear a later flash');
  advanceTime(599);
  assert.equal(root.classList['is-refresh-success'], true);
  advanceTime(1);
  assert.equal(root.classList['is-refresh-success'], false);
});

for (const status of ['stale', 'error']) {
  test(`loading to ${status} stops refreshing without success and keeps offline quota during retry`, () => {
    const { renderState, root, orb, fiveHourCenter, weeklyCenter, advanceTime } = createRenderer();
    renderState(quotaState('ready'));
    renderState(quotaState('loading'));
    renderState(quotaState(status));
    assert.equal(root.classList['is-refreshing'], false);
    assert.equal(orb.attributes.get('aria-busy'), 'false');
    assert.notEqual(root.classList['is-refresh-success'], true);
    assert.equal(root.classList['is-quota-offline'], true);

    renderState(quotaState('loading'));
    assert.equal(root.classList['is-refreshing'], true);
    assert.equal(root.classList['is-quota-offline'], true, 'retry retains the gray offline treatment');
    assert.equal(fiveHourCenter.textContent, '82%');
    assert.equal(weeklyCenter.textContent, '64%');
    renderState(quotaState(status));
    renderState(quotaState('ready'));
    assert.notEqual(root.classList['is-refresh-success'], true, 'a ready render without preceding loading does not flash');
    advanceTime(1000);
    assert.notEqual(root.classList['is-refresh-success'], true);
  });
}
