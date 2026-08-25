"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const tray_menu_1 = require("./tray-menu");
function buildMenu(items) {
    return { items };
}
(0, vitest_1.describe)('createOrbMenu', () => {
    (0, vitest_1.test)('offers an immediate reset action and invokes it directly', () => {
        let resets = 0;
        const menu = (0, tray_menu_1.createOrbMenu)({
            buildFromTemplate: buildMenu,
            onRefresh: () => undefined,
            onReset: () => { resets += 1; },
            onHideToEdge: () => undefined,
            onMinimizeToTray: () => undefined,
            onQuit: () => undefined,
            isRefreshing: () => false,
            canReset: () => true,
        });
        const resetItem = menu.items.find((item) => item.label === '立即重置');
        (0, vitest_1.expect)(resetItem?.enabled).toBe(true);
        resetItem?.click?.();
        (0, vitest_1.expect)(resets).toBe(1);
    });
    (0, vitest_1.test)('builds the orb menu with the exact order and labels', () => {
        const menu = (0, tray_menu_1.createOrbMenu)({
            buildFromTemplate: buildMenu,
            onRefresh: () => undefined,
            onReset: () => undefined,
            onHideToEdge: () => undefined,
            onMinimizeToTray: () => undefined,
            onQuit: () => undefined,
            isRefreshing: () => false,
            canReset: () => false,
        });
        (0, vitest_1.expect)(menu.items.map((item) => item.type === 'separator' ? 'separator' : item.label)).toEqual([
            '立即刷新',
            '立即重置',
            '隐藏到边缘',
            '最小化到系统托盘',
            'separator',
            '退出',
        ]);
    });
    (0, vitest_1.test)('disables refresh while a request is in flight', () => {
        const menu = (0, tray_menu_1.createOrbMenu)({
            buildFromTemplate: buildMenu,
            onRefresh: () => undefined,
            onReset: () => undefined,
            onHideToEdge: () => undefined,
            onMinimizeToTray: () => undefined,
            onQuit: () => undefined,
            isRefreshing: () => true,
            canReset: () => false,
        });
        (0, vitest_1.expect)(menu.items[0].enabled).toBe(false);
    });
    (0, vitest_1.test)('routes enabled orb actions to their callbacks', () => {
        const calls = [];
        const menu = (0, tray_menu_1.createOrbMenu)({
            buildFromTemplate: buildMenu,
            onRefresh: () => calls.push('refresh'),
            onReset: () => calls.push('reset'),
            onHideToEdge: () => calls.push('hide'),
            onMinimizeToTray: () => calls.push('minimize'),
            onQuit: () => calls.push('quit'),
            isRefreshing: () => false,
            canReset: () => true,
        });
        menu.items[0].click?.();
        menu.items[1].click?.();
        menu.items[2].click?.();
        menu.items[3].click?.();
        menu.items[5].click?.();
        (0, vitest_1.expect)(calls).toEqual(['refresh', 'reset', 'hide', 'minimize', 'quit']);
    });
});
(0, vitest_1.describe)('createTrayMenu', () => {
    (0, vitest_1.test)('builds show and quit actions and invokes their callbacks', () => {
        const calls = [];
        const menu = (0, tray_menu_1.createTrayMenu)({
            buildFromTemplate: buildMenu,
            onShow: () => calls.push('show'),
            onQuit: () => calls.push('quit'),
        });
        (0, vitest_1.expect)(menu.items.map((item) => item.label)).toEqual(['显示悬浮球', '退出']);
        menu.items[0].click?.();
        menu.items[1].click?.();
        (0, vitest_1.expect)(calls).toEqual(['show', 'quit']);
    });
});
