"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrbMenu = createOrbMenu;
exports.createTrayMenu = createTrayMenu;
function createOrbMenu(deps) {
    return deps.buildFromTemplate([
        {
            label: '立即刷新',
            enabled: !deps.isRefreshing(),
            click: () => {
                if (!deps.isRefreshing())
                    deps.onRefresh();
            },
        },
        {
            label: '立即重置',
            enabled: deps.canReset(),
            click: () => {
                if (deps.canReset())
                    deps.onReset();
            },
        },
        { label: '隐藏到边缘', click: deps.onHideToEdge },
        { label: '最小化到系统托盘', click: deps.onMinimizeToTray },
        { label: '用量趋势', click: deps.onTrends },
        { label: '随 Codex 启动', type: 'checkbox', checked: deps.autoStartEnabled === true, enabled: deps.autoStartAvailable === true, click: deps.onToggleAutoStart },
        { label: '桌面通知', type: 'checkbox', checked: deps.notificationsEnabled !== false, click: deps.onToggleNotifications },
        { type: 'separator' },
        { label: '退出', click: deps.onQuit },
    ]);
}
function createTrayMenu(deps) {
    return deps.buildFromTemplate([
        { label: '显示悬浮球', click: deps.onShow },
        { label: '用量趋势', click: deps.onTrends },
        { label: '随 Codex 启动', type: 'checkbox', checked: deps.autoStartEnabled === true, enabled: deps.autoStartAvailable === true, click: deps.onToggleAutoStart },
        { label: '桌面通知', type: 'checkbox', checked: deps.notificationsEnabled !== false, click: deps.onToggleNotifications },
        { label: '退出', click: deps.onQuit },
    ]);
}
