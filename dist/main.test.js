"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const main_1 = require("./main");
const originalCommand = process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND;
(0, vitest_1.afterEach)(() => {
    if (originalCommand === undefined)
        delete process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND;
    else
        process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND = originalCommand;
});
(0, vitest_1.describe)('companion bootstrap', () => {
    (0, vitest_1.test)('allows electron-builder to embed the approved icon in the executable', () => {
        const builderConfig = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, '..', 'electron-builder.yml'), 'utf8');
        (0, vitest_1.expect)(builderConfig).toContain('icon: assets/codex-quota-float.ico');
        (0, vitest_1.expect)(builderConfig).not.toContain('signAndEditExecutable: false');
    });
    (0, vitest_1.test)('sets the window icon explicitly so Windows uses it on the taskbar', () => {
        const loadFile = vitest_1.vi.fn();
        const BrowserWindow = vitest_1.vi.fn(() => ({ loadFile }));
        (0, main_1.createMainWindow)(BrowserWindow, 'preload.js', 'renderer.html', 'quota.ico');
        (0, vitest_1.expect)(BrowserWindow).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            width: 286,
            height: 300,
            icon: 'quota.ico',
        }));
        (0, vitest_1.expect)(loadFile).toHaveBeenCalledWith('renderer.html');
    });
    (0, vitest_1.test)('exposes edge-hidden layout controls through the preload bridge', () => {
        const preload = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, 'preload.ts'), 'utf8');
        (0, vitest_1.expect)(preload).toContain("ipcRenderer.invoke('quota:set-edge-hidden', hidden)");
        (0, vitest_1.expect)(preload).toContain("ipcRenderer.on('quota:edge-hidden', handler)");
        (0, vitest_1.expect)(preload).toContain('setEdgeHidden');
        (0, vitest_1.expect)(preload).toContain('subscribeEdgeHidden');
    });
    (0, vitest_1.test)('docks a window on the right edge at the requested vertical position', () => {
        const setPosition = vitest_1.vi.fn();
        const setBounds = vitest_1.vi.fn();
        (0, main_1.dockWindowOnRight)({
            getBounds: () => ({ x: 0, y: 0, width: 286, height: 300 }),
            setPosition,
            setBounds,
        }, { x: 0, y: 0, width: 1920, height: 1040 }, 1200);
        (0, vitest_1.expect)(setBounds).toHaveBeenCalledWith({ x: 1626, y: 740, width: 286, height: 300 });
    });
    (0, vitest_1.test)('builds a non-secret unavailable state', () => {
        (0, vitest_1.expect)((0, main_1.createAppServerUnavailableState)()).toEqual({
            status: 'error',
            weekly: { remainingPercent: null, resetsAt: null, windowDurationMins: null },
            resetCredits: null,
            isResetting: false,
            lastUpdatedAt: null,
            errorMessage: 'Codex app-server unavailable. Sign in in Codex and try again.',
        });
    });
    (0, vitest_1.test)('routes reset requests from the renderer to the quota controller', async () => {
        const handlers = new Map();
        const resetQuota = vitest_1.vi.fn(() => Promise.resolve({ outcome: 'reset' }));
        (0, main_1.registerQuotaActions)({
            handle: (channel, listener) => handlers.set(channel, listener),
        }, {
            refreshNow: vitest_1.vi.fn(() => Promise.resolve()),
            resetQuota,
        });
        await (0, vitest_1.expect)(handlers.get('quota:reset')?.()).resolves.toEqual({ outcome: 'reset' });
        (0, vitest_1.expect)(resetQuota).toHaveBeenCalledOnce();
    });
    (0, vitest_1.test)('sends unavailable state when app-server startup fails', async () => {
        process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND = 'codex-quota-float-command-does-not-exist';
        const sent = [];
        let beforeQuit;
        const window = {
            loadFile: vitest_1.vi.fn(),
            getBounds: () => ({ x: 0, y: 0, width: 286, height: 300 }),
            setPosition: vitest_1.vi.fn(),
            setBounds: vitest_1.vi.fn(),
            setMovable: vitest_1.vi.fn(),
            webContents: {
                send: (...args) => sent.push(args),
                on: vitest_1.vi.fn(),
            },
            on: vitest_1.vi.fn(),
        };
        const deps = {
            app: {
                whenReady: () => Promise.resolve(),
                on: (_event, listener) => { beforeQuit = listener; },
                getPath: () => 'C:\\Temp',
            },
            BrowserWindow: vitest_1.vi.fn(() => window),
            Menu: { buildFromTemplate: vitest_1.vi.fn(() => ({ popup: vitest_1.vi.fn() })) },
            Tray: vitest_1.vi.fn(() => ({ setContextMenu: vitest_1.vi.fn(), setToolTip: vitest_1.vi.fn(), destroy: vitest_1.vi.fn() })),
            ipcMain: { handle: vitest_1.vi.fn() },
            screen: {
                getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
                getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
                getCursorScreenPoint: () => ({ x: 1800, y: 500 }),
            },
        };
        (0, main_1.startCompanion)(deps);
        await new Promise((resolve) => setTimeout(resolve, 100));
        (0, vitest_1.expect)(window.setMovable).toHaveBeenCalledWith(false);
        (0, vitest_1.expect)(sent).toContainEqual([
            'quota:state',
            vitest_1.expect.objectContaining({
                status: 'error',
                lastUpdatedAt: null,
                errorMessage: 'Codex app-server unavailable. Sign in in Codex and try again.',
            }),
        ]);
        (0, vitest_1.expect)(sent.join(' ')).not.toContain('codex-quota-float-command-does-not-exist');
        beforeQuit?.();
    });
    (0, vitest_1.test)('hides from the orb context menu and tray show restores the normal floating window', async () => {
        process.env.CODEX_QUOTA_FLOAT_APP_SERVER_COMMAND = 'codex-quota-float-command-does-not-exist';
        const handlers = new Map();
        let trayItems = [];
        let orbItems = [];
        let contextMenuListener;
        let beforeQuit;
        let bounds = { x: 0, y: 0, width: 286, height: 300 };
        const setBounds = vitest_1.vi.fn((next) => { bounds = next; });
        const send = vitest_1.vi.fn();
        const show = vitest_1.vi.fn();
        const focus = vitest_1.vi.fn();
        const window = {
            loadFile: vitest_1.vi.fn(),
            getBounds: () => bounds,
            setPosition: vitest_1.vi.fn(),
            setBounds,
            setMovable: vitest_1.vi.fn(),
            show,
            focus,
            webContents: {
                send,
                on: vitest_1.vi.fn((event, listener) => {
                    if (event === 'context-menu')
                        contextMenuListener = listener;
                }),
            },
            on: vitest_1.vi.fn(),
        };
        const deps = {
            app: {
                whenReady: () => Promise.resolve(),
                on: (_event, listener) => { beforeQuit = listener; },
                getPath: () => 'C:\\Temp',
            },
            BrowserWindow: vitest_1.vi.fn(() => window),
            Menu: {
                buildFromTemplate: vitest_1.vi.fn((items) => {
                    if (trayItems.length === 0)
                        trayItems = items;
                    else
                        orbItems = items;
                    return { popup: vitest_1.vi.fn() };
                }),
            },
            Tray: vitest_1.vi.fn(() => ({ setContextMenu: vitest_1.vi.fn(), setToolTip: vitest_1.vi.fn(), destroy: vitest_1.vi.fn() })),
            ipcMain: {
                handle: vitest_1.vi.fn((channel, listener) => {
                    handlers.set(channel, listener);
                }),
            },
            screen: {
                getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
                getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
                getCursorScreenPoint: () => ({ x: 1800, y: 500 }),
            },
        };
        (0, main_1.startCompanion)(deps);
        await new Promise((resolve) => setTimeout(resolve, 50));
        (0, vitest_1.expect)(handlers.has('quota:set-edge-hidden')).toBe(true);
        (0, vitest_1.expect)(() => contextMenuListener?.({ preventDefault: vitest_1.vi.fn() })).not.toThrow();
        (0, vitest_1.expect)(orbItems[1]).toMatchObject({ label: '立即重置', enabled: false });
        orbItems[2]?.click?.();
        (0, vitest_1.expect)(setBounds).toHaveBeenLastCalledWith({ x: 1906, y: 398, width: 14, height: 56 });
        (0, vitest_1.expect)(send).toHaveBeenCalledWith('quota:edge-hidden', true);
        trayItems[0]?.click?.();
        (0, vitest_1.expect)(setBounds).toHaveBeenLastCalledWith({ x: 1626, y: 370, width: 286, height: 300 });
        (0, vitest_1.expect)(send).toHaveBeenCalledWith('quota:edge-hidden', false);
        (0, vitest_1.expect)(show).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(focus).toHaveBeenCalledOnce();
        beforeQuit?.();
    });
});
