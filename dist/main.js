"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerQuotaActions = registerQuotaActions;
exports.dockWindowOnRight = dockWindowOnRight;
exports.createMainWindow = createMainWindow;
exports.createAppServerUnavailableState = createAppServerUnavailableState;
exports.configureWindowsAppIdentity = configureWindowsAppIdentity;
exports.startCompanion = startCompanion;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const app_server_client_1 = require("./app-server-client");
const refresh_controller_1 = require("./refresh-controller");
const tray_menu_1 = require("./tray-menu");
const usage_model_1 = require("./usage-model");
const window_position_1 = require("./window-position");
function registerQuotaActions(ipcMain, controller) {
    ipcMain.handle('quota:refresh-now', () => controller.refreshNow());
    ipcMain.handle('quota:reset', (_event, creditId) => controller.resetQuota(creditId));
}
function dockWindowOnRight(window, workArea, requestedY) {
    const position = (0, window_position_1.rightDockPosition)(workArea, window_position_1.NORMAL_WINDOW_SIZE, requestedY);
    window.setBounds({ ...position, ...window_position_1.NORMAL_WINDOW_SIZE });
    return position;
}
function savedDockPath(userDataPath) {
    return node_path_1.default.join(userDataPath, 'codex-quota-float-position.json');
}
function readSavedDockY(filePath) {
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)(filePath, 'utf8'));
        if (typeof parsed === 'object' && parsed !== null && 'y' in parsed && typeof parsed.y === 'number') {
            return parsed.y;
        }
    }
    catch {
        // First launch or an unreadable settings file uses the centered default.
    }
    return undefined;
}
function saveDockY(filePath, y) {
    try {
        (0, node_fs_1.writeFileSync)(filePath, JSON.stringify({ y }), 'utf8');
    }
    catch {
        // A non-writable profile must not prevent the quota companion from opening.
    }
}
function createMainWindow(BrowserWindow, preloadPath = node_path_1.default.join(__dirname, 'preload.js'), rendererPath = node_path_1.default.join(__dirname, 'renderer', 'index.html'), iconPath = node_path_1.default.join(__dirname, '..', 'assets', 'codex-quota-float.ico')) {
    const window = new BrowserWindow({
        width: window_position_1.COLLAPSED_WINDOW_SIZE.width,
        height: window_position_1.COLLAPSED_WINDOW_SIZE.height,
        icon: iconPath,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        hasShadow: false,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    void window.loadFile(rendererPath);
    return window;
}
function loadElectronDeps() {
    // Keep Electron out of the module top level so renderer/controller tests run in
    // Vitest without initializing an Electron process.
    return require('electron');
}
function createAppServerUnavailableState() {
    return {
        status: 'error',
        ...(0, usage_model_1.normalizeRateLimits)({}),
        resetCredits: null,
        isResetting: false,
        lastUpdatedAt: null,
        errorMessage: 'Codex app-server unavailable. Sign in in Codex and try again.',
    };
}
function configureWindowsAppIdentity(app) {
    app.setAppUserModelId?.('com.openai.codex-quota-float');
}
function startCompanion(deps = loadElectronDeps()) {
    configureWindowsAppIdentity(deps.app);
    const client = new app_server_client_1.AppServerClient();
    const controller = new refresh_controller_1.RefreshController(client);
    let window;
    let tray;
    let latestState;
    let refreshing = false;
    let resourcesStopped = false;
    let dragTimer;
    let windowLayout = 'collapsed';
    let normalDockY;
    const stopResources = () => {
        if (resourcesStopped)
            return;
        resourcesStopped = true;
        tray?.destroy();
        tray = undefined;
        controller.stop();
        if (dragTimer)
            clearInterval(dragTimer);
        void client.stop();
    };
    const quit = () => {
        if (resourcesStopped)
            return;
        stopResources();
        deps.app.quit?.();
    };
    controller.subscribe((state) => {
        refreshing = state.status === 'loading';
        latestState = state;
        window?.webContents.send('quota:state', state);
    });
    registerQuotaActions(deps.ipcMain, controller);
    deps.app.on('before-quit', stopResources);
    void deps.app.whenReady().then(async () => {
        window = createMainWindow(deps.BrowserWindow);
        window.setMovable(false);
        const workAreaFor = (bounds) => deps.screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
        const dockPath = savedDockPath(deps.app.getPath('userData'));
        const initialBounds = (0, window_position_1.rightDockBounds)(workAreaFor(window.getBounds()), 'normal', readSavedDockY(dockPath));
        normalDockY = initialBounds.y;
        window.setBounds((0, window_position_1.rightDockBounds)(workAreaFor(window.getBounds()), windowLayout, normalDockY));
        const moveDockedWindow = (workArea, screenY, pointerOffsetY) => {
            if (!window)
                return;
            const requestedNormalY = screenY - pointerOffsetY - (windowLayout === 'collapsed' ? 8 : 0);
            if (windowLayout === 'normal') {
                normalDockY = dockWindowOnRight(window, workArea, requestedNormalY).y;
            }
            else {
                normalDockY = (0, window_position_1.rightDockPosition)(workArea, window_position_1.NORMAL_WINDOW_SIZE, requestedNormalY).y;
                window.setBounds((0, window_position_1.rightDockBounds)(workArea, windowLayout, normalDockY));
            }
            saveDockY(dockPath, normalDockY);
        };
        const setEdgeHidden = (hidden) => {
            if (!window)
                return;
            if (dragTimer)
                clearInterval(dragTimer);
            dragTimer = undefined;
            windowLayout = hidden ? 'edgeHidden' : 'collapsed';
            const bounds = (0, window_position_1.rightDockBounds)(workAreaFor(window.getBounds()), windowLayout, normalDockY);
            window.setBounds(bounds);
            window.webContents.send('quota:edge-hidden', hidden);
        };
        deps.ipcMain.handle('quota:set-edge-hidden', (...args) => {
            const hidden = args[1];
            if (typeof hidden === 'boolean')
                setEdgeHidden(hidden);
        });
        deps.ipcMain.handle('quota:set-expanded', (...args) => {
            const expanded = args[1];
            if (!window || windowLayout === 'edgeHidden' || typeof expanded !== 'boolean')
                return;
            windowLayout = expanded ? 'normal' : 'collapsed';
            window.setBounds((0, window_position_1.rightDockBounds)(workAreaFor(window.getBounds()), windowLayout, normalDockY));
        });
        deps.ipcMain.handle('quota:move-to-y', (...args) => {
            const screenY = args[1];
            const pointerOffsetY = args[2];
            if (!window || windowLayout === 'edgeHidden' || typeof screenY !== 'number' || typeof pointerOffsetY !== 'number')
                return;
            moveDockedWindow(workAreaFor(window.getBounds()), screenY, pointerOffsetY);
        });
        deps.ipcMain.handle('quota:start-drag', (...args) => {
            const pointerOffsetY = args[1];
            if (!window || windowLayout === 'edgeHidden' || typeof pointerOffsetY !== 'number')
                return;
            if (dragTimer)
                clearInterval(dragTimer);
            dragTimer = setInterval(() => {
                if (!window || windowLayout === 'edgeHidden')
                    return;
                const cursor = deps.screen.getCursorScreenPoint();
                const display = deps.screen.getDisplayNearestPoint(cursor).workArea;
                moveDockedWindow(display, cursor.y, pointerOffsetY);
            }, 16);
        });
        deps.ipcMain.handle('quota:stop-drag', () => {
            if (dragTimer)
                clearInterval(dragTimer);
            dragTimer = undefined;
        });
        window.on('will-move', (...args) => {
            const event = args[0];
            const newBounds = args[1];
            if (!window || !newBounds)
                return;
            event?.preventDefault?.();
            const workArea = workAreaFor(newBounds);
            const requestedNormalY = windowLayout === 'normal' ? newBounds.y : windowLayout === 'collapsed' ? newBounds.y - 8 : normalDockY;
            normalDockY = (0, window_position_1.rightDockPosition)(workArea, window_position_1.NORMAL_WINDOW_SIZE, requestedNormalY).y;
            const bounds = (0, window_position_1.rightDockBounds)(workArea, windowLayout, normalDockY);
            window.setBounds(bounds);
            if (windowLayout !== 'edgeHidden')
                saveDockY(dockPath, normalDockY);
        });
        window.on('move', () => {
            const bounds = window?.getBounds();
            if (!bounds || !window)
                return;
            const expected = (0, window_position_1.rightDockBounds)(workAreaFor(bounds), windowLayout, normalDockY);
            if (bounds.x !== expected.x ||
                bounds.y !== expected.y ||
                bounds.width !== expected.width ||
                bounds.height !== expected.height) {
                window.setBounds(expected);
            }
        });
        if (latestState)
            window.webContents.send('quota:state', latestState);
        window.webContents.on?.('context-menu', (...args) => {
            const event = args[0];
            event?.preventDefault?.();
            const menu = (0, tray_menu_1.createOrbMenu)({
                buildFromTemplate: (items) => deps.Menu.buildFromTemplate(items),
                onRefresh: () => void controller.refreshNow(),
                onReset: () => void controller.resetQuota().catch(() => undefined),
                onHideToEdge: () => setEdgeHidden(true),
                onMinimizeToTray: () => window?.hide?.(),
                onQuit: quit,
                isRefreshing: () => refreshing,
                canReset: () => (latestState?.resetCredits?.availableCount ?? 0) > 0 && latestState?.isResetting === false,
            });
            menu.popup?.({ window });
        });
        tray = new deps.Tray(deps.nativeImage?.createFromPath?.(node_path_1.default.join(__dirname, '..', 'assets', 'codex-quota-float.png')) ??
            deps.nativeImage?.createFromDataURL?.('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=') ?? node_path_1.default.join(__dirname, 'renderer', 'index.html'));
        tray.setToolTip?.('Codex Quota Float');
        tray.setContextMenu((0, tray_menu_1.createTrayMenu)({
            buildFromTemplate: (items) => deps.Menu.buildFromTemplate(items),
            onShow: () => {
                setEdgeHidden(false);
                window?.show?.();
                window?.focus?.();
            },
            onQuit: quit,
        }));
        try {
            await client.start();
            await controller.start();
        }
        catch {
            refreshing = false;
            latestState = createAppServerUnavailableState();
            window?.webContents.send('quota:state', latestState);
        }
    });
}
if (require.main === module) {
    startCompanion();
}
