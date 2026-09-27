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
const { QuotaAlerts } = require('./alerts');
const { UsageHistory } = require('./history');
const { CodexAutoStart } = require('./auto-start');
const { ResetNotices, postUrl, scrape } = require('./notices');
const { fetchCommunity } = require('./community-reset');
function registerQuotaActions(ipcMain, controller, dialog, getWindow) {
    let pendingReset;
    const requestReset = (creditId) => {
        if (pendingReset)
            return pendingReset;
        pendingReset = (async () => {
            const credits = controller.state.resetCredits?.credits.filter((credit) => credit.status === 'available') ?? [];
            const index = credits.findIndex((credit) => creditId === undefined || credit.id === creditId);
            const credit = credits[index];
            if (!credit)
                return { outcome: 'noCredit' };
            const expiry = Number.isFinite(credit.expiresAt)
                ? `${new Date(credit.expiresAt < 1e11 ? credit.expiresAt * 1000 : credit.expiresAt).toLocaleDateString('zh-CN')} 到期`
                : '到期时间未知';
            const { response } = await dialog.showMessageBox(getWindow(), {
                type: 'question',
                title: '使用重置卡',
                message: `确定使用「重置卡 ${index + 1}」重置额度吗？`,
                detail: `${expiry} · 编号 …${credit.id.slice(-4)}\n成功后将消耗这张卡。`,
                buttons: ['取消', '确认使用'],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
            });
            if (response !== 1)
                return { outcome: 'cancelled' };
            return controller.resetQuota(credit.id);
        })().finally(() => { pendingReset = undefined; });
        return pendingReset;
    };
    ipcMain.handle('quota:refresh-now', () => controller.refreshNow());
    ipcMain.handle('quota:reset', (_event, creditId) => requestReset(creditId));
    return requestReset;
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
        backgroundColor: '#00000000',
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
    // Node without initializing an Electron process.
    return require('electron');
}
function sendToWindow(window, channel, ...args) {
    if (window && !window.isDestroyed?.() && !window.webContents.isDestroyed?.())
        window.webContents.send(channel, ...args);
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
    let onDisplayChanged;
    let windowLayout = 'collapsed';
    let contentHeight = window_position_1.COLLAPSED_WINDOW_SIZE.height;
    let regions = [{ x: 12, y: 12, width: 76, height: 76, radius: 38 }];
    let normalDockY;
    let alerts;
    let history;
    let trendsWindow;
    let notices;
    let noticesWindow;
    let autoStart;
    let changingAutoStart = false;
    const stopResources = () => {
        if (resourcesStopped)
            return;
        resourcesStopped = true;
        tray?.destroy();
        tray = undefined;
        controller.stop();
        notices?.stop();
        if (dragTimer)
            clearInterval(dragTimer);
        if (onDisplayChanged) {
            deps.screen.removeListener?.('display-metrics-changed', onDisplayChanged);
            deps.screen.removeListener?.('display-removed', onDisplayChanged);
        }
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
        const result = alerts?.update(state);
        if (history?.record(state)) sendToWindow(trendsWindow, 'quota:history-updated');
        latestState = result ? { ...state, alerts: result.alerts } : state;
        notices?.updateAccount(state);
        sendToWindow(window, 'quota:state', latestState);
    });
    const requestReset = registerQuotaActions(deps.ipcMain, controller, deps.dialog, () => window);
    deps.app.on('before-quit', stopResources);
    void deps.app.whenReady().then(async () => {
        history = new UsageHistory(node_path_1.default.join(deps.app.getPath('userData'), 'codex-quota-history.json'));
        const showTrends = () => {
            if (trendsWindow && !trendsWindow.isDestroyed()) {
                if (trendsWindow.isMinimized()) trendsWindow.restore();
                trendsWindow.show(); trendsWindow.focus(); return;
            }
            trendsWindow = new deps.BrowserWindow({
                width: 940, height: 720, minWidth: 680, minHeight: 560,
                title: '用量趋势 · Codex Quota Float', backgroundColor: '#101b30', autoHideMenuBar: true,
                icon: node_path_1.default.join(__dirname, '..', 'assets', 'codex-quota-float.ico'),
                webPreferences: { preload: node_path_1.default.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
            });
            trendsWindow.on('closed', () => { trendsWindow = undefined; });
            void trendsWindow.loadFile(node_path_1.default.join(__dirname, 'renderer', 'trends.html'));
        };
        deps.ipcMain.handle('quota:open-trends', showTrends);
        deps.ipcMain.handle('quota:read-history', () => history.read());
        const alertsPath = node_path_1.default.join(deps.app.getPath('userData'), 'codex-quota-float-alerts.json');
        let savedAlerts = {};
        try { savedAlerts = JSON.parse((0, node_fs_1.readFileSync)(alertsPath, 'utf8')) ?? {}; } catch {}
        alerts = new QuotaAlerts(savedAlerts, (saved) => {
            try { (0, node_fs_1.writeFileSync)(alertsPath, JSON.stringify(saved), 'utf8'); } catch {}
        });
        deps.ipcMain.handle('quota:dismiss-alert', (_event, category) => {
            if (!['quota', 'credits'].includes(category) || !latestState) return;
            latestState = { ...latestState, alerts: alerts.dismiss(category) };
            sendToWindow(window, 'quota:state', latestState);
        });
        const showNotices = () => {
            if (noticesWindow && !noticesWindow.isDestroyed()) {
                if (noticesWindow.isMinimized()) noticesWindow.restore();
                noticesWindow.show(); noticesWindow.focus(); return;
            }
            noticesWindow = new deps.BrowserWindow({
                width: 470, height: 720, minWidth: 380, minHeight: 440,
                title: '重置动态 · Codex Quota Float', backgroundColor: '#101b30', autoHideMenuBar: true,
                icon: node_path_1.default.join(__dirname, '..', 'assets', 'codex-quota-float.ico'),
                webPreferences: { preload: node_path_1.default.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
            });
            noticesWindow.on('closed', () => { noticesWindow = undefined; });
            void noticesWindow.loadFile(node_path_1.default.join(__dirname, 'renderer', 'notices.html'));
        };
        notices = new ResetNotices(node_path_1.default.join(deps.app.getPath('userData'), 'codex-reset-notices.json'), {
            loadCommunity: options => fetchCommunity({ ...options, fetchImpl: deps.net?.fetch.bind(deps.net) || fetch }),
            scrapePage: (url, options) => scrape(url, { ...options, fetchImpl: deps.net?.fetch.bind(deps.net) || fetch }),
            ...deps.noticeOptions,
            onChange: (state) => {
                sendToWindow(window, 'quota:notices', state);
                sendToWindow(noticesWindow, 'quota:notices', state);
            },
        });
        deps.ipcMain.handle('quota:open-notices', showNotices);
        deps.ipcMain.handle('quota:read-notices', () => notices.view());
        deps.ipcMain.handle('quota:refresh-notices', () => notices.refresh(true));
        deps.ipcMain.handle('quota:read-notice', (_event, id) => notices.markRead(id));
        deps.ipcMain.handle('quota:show-probability', (_event, show) => {
            if (typeof show === 'boolean') return notices.setShowProbability(show);
        });
        deps.ipcMain.handle('quota:enable-notices', (_event, enabled) => {
            if (typeof enabled === 'boolean') return notices.setEnabled(enabled);
        });
        deps.ipcMain.handle('quota:open-notice-source', (_event, id) => {
            const record = notices.saved.records.find(r => r.id === id);
            if (record && postUrl(record.url)) return deps.shell?.openExternal(record.url);
        });
        // Unit tests use minimal Electron doubles; start networking only in a real runtime.
        if (deps.app.isPackaged !== undefined) notices.start();
        window = createMainWindow(deps.BrowserWindow);
        window.on('close', (event) => {
            if (!resourcesStopped) {
                event.preventDefault();
                window.hide();
            }
        });
        window.on('closed', () => { window = undefined; });
        window.webContents.on?.('did-finish-load', () => {
            if (latestState) sendToWindow(window, 'quota:state', latestState);
            if (window) sendToWindow(window, 'quota:work-area-height', workAreaFor(window.getBounds()).height);
        });
        window.setMovable(false);
        const workAreaFor = (bounds) => deps.screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
        const dockPath = savedDockPath(deps.app.getPath('userData'));
        const initialBounds = (0, window_position_1.rightDockBounds)(workAreaFor(window.getBounds()), 'normal', readSavedDockY(dockPath));
        normalDockY = initialBounds.y;
        const applyLayout = (workArea = workAreaFor(window.getBounds())) => {
            const bounds = (0, window_position_1.rightDockBounds)(workArea, windowLayout, normalDockY, contentHeight);
            if (windowLayout === 'normal' || windowLayout === 'picker')
                normalDockY = bounds.y;
            window.setBounds(bounds);
            window.setShape((0, window_position_1.createWindowShape)(regions));
            sendToWindow(window, 'quota:work-area-height', workArea.height);
        };
        applyLayout();
        onDisplayChanged = () => { if (window) applyLayout(); };
        deps.screen.on?.('display-metrics-changed', onDisplayChanged);
        deps.screen.on?.('display-removed', onDisplayChanged);
        const moveDockedWindow = (workArea, screenY, pointerOffsetY) => {
            if (!window)
                return;
            const requestedNormalY = screenY - pointerOffsetY - ((windowLayout === 'collapsed' || windowLayout === 'summary') ? 8 : 0);
            const bounds = (0, window_position_1.rightDockBounds)(workArea, windowLayout, requestedNormalY, contentHeight);
            normalDockY = bounds.y - ((windowLayout === 'collapsed' || windowLayout === 'summary') ? 8 : 0);
            applyLayout(workArea);
            saveDockY(dockPath, normalDockY);
        };
        const setEdgeHidden = (hidden) => {
            if (!window)
                return;
            if (dragTimer)
                clearInterval(dragTimer);
            dragTimer = undefined;
            windowLayout = hidden ? 'edgeHidden' : 'collapsed';
            contentHeight = window_position_1.COLLAPSED_WINDOW_SIZE.height;
            regions = hidden ? [{ x: 0, y: 0, width: 14, height: 56, radius: 0 }] : [{ x: 12, y: 12, width: 76, height: 76, radius: 38 }];
            applyLayout();
            sendToWindow(window, 'quota:edge-hidden', hidden);
        };
        deps.ipcMain.handle('quota:set-edge-hidden', (...args) => {
            const hidden = args[1];
            if (typeof hidden === 'boolean')
                setEdgeHidden(hidden);
        });
        deps.ipcMain.handle('quota:set-layout', (_event, layout) => {
            if (!window || !layout || !['collapsed', 'summary', 'normal', 'picker'].includes(layout.mode) || windowLayout === 'edgeHidden')
                return;
            if (!Number.isFinite(layout.height) || layout.height < 100 || layout.height > 1000 || !Array.isArray(layout.regions) || layout.regions.length < 1 || layout.regions.length > 7)
                return;
            if (!layout.regions.every((rect) => rect && ['x', 'y', 'width', 'height', 'radius'].every((key) => Number.isFinite(rect[key]) && rect[key] >= 0) && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 286 && rect.y + rect.height <= layout.height))
                return;
            windowLayout = layout.mode;
            contentHeight = Math.ceil(layout.height);
            regions = layout.regions;
            applyLayout();
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
            const requestedNormalY = windowLayout === 'normal' || windowLayout === 'picker' ? newBounds.y : (windowLayout === 'collapsed' || windowLayout === 'summary') ? newBounds.y - 8 : normalDockY;
            const bounds = (0, window_position_1.rightDockBounds)(workArea, windowLayout, requestedNormalY, contentHeight);
            normalDockY = bounds.y - ((windowLayout === 'collapsed' || windowLayout === 'summary') ? 8 : windowLayout === 'edgeHidden' ? 30 : 0);
            applyLayout(workArea);
            if (windowLayout !== 'edgeHidden')
                saveDockY(dockPath, normalDockY);
        });
        window.on('move', () => {
            const bounds = window?.getBounds();
            if (!bounds || !window)
                return;
            const expected = (0, window_position_1.rightDockBounds)(workAreaFor(bounds), windowLayout, normalDockY, contentHeight);
            if (bounds.x !== expected.x ||
                bounds.y !== expected.y ||
                bounds.width !== expected.width ||
                bounds.height !== expected.height) {
                window.setBounds(expected);
            }
        });
        if (latestState)
            sendToWindow(window, 'quota:state', latestState);
        window.webContents.on?.('context-menu', (...args) => {
            const event = args[0];
            event?.preventDefault?.();
            const menu = (0, tray_menu_1.createOrbMenu)({
                buildFromTemplate: (items) => deps.Menu.buildFromTemplate(items),
                onRefresh: () => void controller.refreshNow(),
                onReset: () => void requestReset().catch(() => undefined),
                onHideToEdge: () => setEdgeHidden(true),
                onMinimizeToTray: () => window?.hide?.(),
                onQuit: quit,
                isRefreshing: () => refreshing,
                canReset: () => (latestState?.resetCredits?.availableCount ?? 0) > 0 && latestState?.isResetting === false,
                onTrends: showTrends,
                autoStartEnabled: autoStart?.enabled === true,
                autoStartAvailable: !!autoStart && !changingAutoStart,
                onToggleAutoStart: () => void toggleAutoStart(),
            });
            menu.popup?.({ window });
        });
        tray = new deps.Tray(deps.nativeImage?.createFromPath?.(node_path_1.default.join(__dirname, '..', 'assets', 'codex-quota-float.png')) ??
            deps.nativeImage?.createFromDataURL?.('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=') ?? node_path_1.default.join(__dirname, 'renderer', 'index.html'));
        tray.setToolTip?.('Codex Quota Float');
        const updateTrayMenu = () => tray.setContextMenu((0, tray_menu_1.createTrayMenu)({
            buildFromTemplate: (items) => deps.Menu.buildFromTemplate(items),
            onShow: () => {
                setEdgeHidden(false);
                window?.show?.();
                window?.focus?.();
            },
            onQuit: quit,
            onTrends: showTrends,
            autoStartEnabled: autoStart?.enabled === true,
            autoStartAvailable: !!autoStart && !changingAutoStart,
            onToggleAutoStart: () => void toggleAutoStart(),
        }));
        const toggleAutoStart = async () => {
            if (!autoStart || changingAutoStart) return;
            changingAutoStart = true; updateTrayMenu();
            try { await autoStart.setEnabled(!autoStart.enabled); }
            catch { await deps.dialog.showMessageBox(window, { type: 'error', message: '未能设置随 Codex 启动', detail: '请确认用户启动文件夹可写，然后重试。' }); }
            finally { changingAutoStart = false; updateTrayMenu(); }
        };
        if (deps.app.isPackaged && process.platform === 'win32') {
            autoStart = new CodexAutoStart(deps.app.getPath('userData'), node_path_1.default.join(deps.app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), process.env.PORTABLE_EXECUTABLE_FILE || process.execPath);
            if (!autoStart.configured || autoStart.enabled) {
                changingAutoStart = true;
                void autoStart.setEnabled(true).catch(() => deps.dialog.showMessageBox(window, { type: 'warning', message: '自动跟随 Codex 未能启用', detail: '可稍后在右键菜单中重新开启。' })).finally(() => { changingAutoStart = false; if (!resourcesStopped) updateTrayMenu(); });
            }
        }
        updateTrayMenu();
        try {
            await controller.start();
        }
        catch {
            refreshing = false;
            latestState = createAppServerUnavailableState();
            sendToWindow(window, 'quota:state', latestState);
        }
    });
}
if (require.main === module) {
    const electron = loadElectronDeps();
    if (!electron.app.requestSingleInstanceLock()) electron.app.quit();
    else {
        electron.app.on('second-instance', () => {
            const existing = electron.BrowserWindow.getAllWindows()[0];
            existing?.show(); existing?.focus();
        });
        startCompanion(electron);
    }
}
