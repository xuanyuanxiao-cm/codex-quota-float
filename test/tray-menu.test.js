const assert = require('node:assert/strict');
const test = require('node:test');
const { createOrbMenu, createTrayMenu } = require('../dist/tray-menu');

test('orb menu routes actions and checks current availability before refresh or reset', () => {
  const calls = [];
  let busy = false, credit = true;
  const menu = createOrbMenu({ buildFromTemplate: items => items,
    isRefreshing: () => busy, canReset: () => credit,
    onRefresh: () => calls.push('refresh'), onReset: () => calls.push('reset'),
    onHideToEdge: () => calls.push('hide'), onMinimizeToTray: () => calls.push('minimize'),
    onTrends: () => calls.push('trends'), onQuit: () => calls.push('quit'),
    onToggleAutoStart: () => calls.push('startup'),
    autoStartEnabled: true, autoStartAvailable: true,
  });
  assert.deepEqual(menu.map(item => item.label || item.type),
    ['立即刷新', '立即重置', '隐藏到边缘', '最小化到系统托盘', '用量趋势', '功能设置…', '随 Codex 启动', 'separator', '退出']);
  for (const item of menu) item.click?.();
  assert.deepEqual(calls, ['refresh', 'reset', 'hide', 'minimize', 'trends', 'startup', 'quit']);
  busy = true; credit = false; menu[0].click(); menu[1].click();
  assert.equal(calls.length, 7);
  assert.equal(menu[6].checked, true);
  const disabled = createOrbMenu({ buildFromTemplate: items => items, isRefreshing: () => true, canReset: () => false });
  assert.equal(disabled[0].enabled, false); assert.equal(disabled[1].enabled, false);
});

test('tray menu routes show and quit and retains the settings actions', () => {
  const calls = [];
  const menu = createTrayMenu({ buildFromTemplate: items => items,
    onShow: () => calls.push('show'), onQuit: () => calls.push('quit') });
  assert.deepEqual(menu.map(item => item.label), ['显示悬浮球', '用量趋势', '功能设置…', '随 Codex 启动', '退出']);
  menu[0].click(); menu.at(-1).click();
  assert.deepEqual(calls, ['show', 'quit']);
});

test('both menus open a persistent settings window', () => {
  for (const create of [createOrbMenu, createTrayMenu]) {
    let opened = 0;
    const menu = create({ buildFromTemplate: items => items, isRefreshing: () => false, canReset: () => false,
      panelSettings: { trends: false }, onSettings: () => opened++ });
    const settings = menu.find(item => item.label === '功能设置…');
    assert.equal(settings.submenu, undefined); settings.click(); assert.equal(opened, 1);
    assert.equal(menu.find(item => item.label === '用量趋势').visible, false);
  }
});
