"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const subscribe = (listener) => {
    const handler = (_event, state) => listener(state);
    electron_1.ipcRenderer.on('quota:state', handler);
    return () => electron_1.ipcRenderer.removeListener('quota:state', handler);
};
const refreshNow = () => electron_1.ipcRenderer.invoke('quota:refresh-now');
const resetQuota = (creditId) => electron_1.ipcRenderer.invoke('quota:reset', creditId);
const moveToY = (screenY, pointerOffsetY) => electron_1.ipcRenderer.invoke('quota:move-to-y', screenY, pointerOffsetY);
const startDrag = (pointerOffsetY) => electron_1.ipcRenderer.invoke('quota:start-drag', pointerOffsetY);
const stopDrag = () => electron_1.ipcRenderer.invoke('quota:stop-drag');
const setEdgeHidden = (hidden) => electron_1.ipcRenderer.invoke('quota:set-edge-hidden', hidden);
const setLayout = (layout) => electron_1.ipcRenderer.invoke('quota:set-layout', layout);
const subscribeEdgeHidden = (listener) => {
    const handler = (_event, hidden) => listener(hidden);
    electron_1.ipcRenderer.on('quota:edge-hidden', handler);
    return () => electron_1.ipcRenderer.removeListener('quota:edge-hidden', handler);
};
const subscribeOpenDetails = (listener) => {
    const handler = (_event, target) => listener(target);
    electron_1.ipcRenderer.on('quota:open-details', handler);
    return () => electron_1.ipcRenderer.removeListener('quota:open-details', handler);
};
electron_1.contextBridge.exposeInMainWorld('quota', {
    setPanelItem: (key, enabled) => electron_1.ipcRenderer.invoke('quota:set-panel-item', key, enabled),
    closeSettings: () => electron_1.ipcRenderer.invoke('quota:close-settings'),
    readPanelSettings: () => electron_1.ipcRenderer.invoke('quota:read-panel-settings'),
    subscribePanelSettings: (listener) => {
        const handler = (_event, settings) => listener(settings);
        electron_1.ipcRenderer.on('quota:panel-settings', handler);
        return () => electron_1.ipcRenderer.removeListener('quota:panel-settings', handler);
    },
    openTibo: (id) => electron_1.ipcRenderer.invoke('quota:open-tibo', id),
    readTibo: () => electron_1.ipcRenderer.invoke('quota:read-tibo'),
    refreshTibo: () => electron_1.ipcRenderer.invoke('quota:refresh-tibo'),
    markTiboRead: (items) => electron_1.ipcRenderer.invoke('quota:mark-tibo-read', items),
    clearTibo: () => electron_1.ipcRenderer.invoke('quota:clear-tibo'),
    translateTibo: (id) => electron_1.ipcRenderer.invoke('quota:translate-tibo', id),
    prioritizeTibo: (id) => electron_1.ipcRenderer.invoke('quota:prioritize-tibo', id),
    translateNotice: (id) => electron_1.ipcRenderer.invoke('quota:translate-notice', id),
    openTiboSource: (id) => electron_1.ipcRenderer.invoke('quota:open-tibo-source', id),
    subscribeTibo: (listener) => {
        const handler = (_event, state) => listener(state);
        electron_1.ipcRenderer.on('quota:tibo', handler);
        return () => electron_1.ipcRenderer.removeListener('quota:tibo', handler);
    },
    subscribeTiboSelection: (listener) => {
        const handler = (_event, id) => listener(id);
        electron_1.ipcRenderer.on('quota:select-tibo', handler);
        return () => electron_1.ipcRenderer.removeListener('quota:select-tibo', handler);
    },
    dismissAlert: (category) => electron_1.ipcRenderer.invoke('quota:dismiss-alert', category),
    subscribeWorkAreaHeight: (listener) => {
        const handler = (_event, height) => listener(height);
        electron_1.ipcRenderer.on('quota:work-area-height', handler);
        return () => electron_1.ipcRenderer.removeListener('quota:work-area-height', handler);
    },
    openNotices: (id) => electron_1.ipcRenderer.invoke('quota:open-notices', id),
    subscribeNoticeSelection: (callback) => {
        const handler = (_event, id) => callback(id);
        electron_1.ipcRenderer.on('quota:select-notice', handler);
        return () => electron_1.ipcRenderer.removeListener('quota:select-notice', handler);
    },
    markNoticesRead: (items) => electron_1.ipcRenderer.invoke('quota:read-notices-batch', items),
    readNotices: () => electron_1.ipcRenderer.invoke('quota:read-notices'),
    refreshNotices: () => electron_1.ipcRenderer.invoke('quota:refresh-notices'),
    markNoticeRead: (id) => electron_1.ipcRenderer.invoke('quota:read-notice', id),
    enableNotices: (enabled) => electron_1.ipcRenderer.invoke('quota:enable-notices', enabled),
    showProbability: (show) => electron_1.ipcRenderer.invoke('quota:show-probability', show),
    openNoticeSource: (id) => electron_1.ipcRenderer.invoke('quota:open-notice-source', id),
    subscribeNotices: (listener) => {
        const handler = (_event, state) => listener(state);
        electron_1.ipcRenderer.on('quota:notices', handler);
        return () => electron_1.ipcRenderer.removeListener('quota:notices', handler);
    },
    openTrends: () => electron_1.ipcRenderer.invoke('quota:open-trends'),
    readHistory: () => electron_1.ipcRenderer.invoke('quota:read-history'),
    subscribeHistory: (listener) => {
        const handler = () => listener();
        electron_1.ipcRenderer.on('quota:history-updated', handler);
        return () => electron_1.ipcRenderer.removeListener('quota:history-updated', handler);
    },
    subscribe,
    refreshNow,
    resetQuota,
    moveToY,
    startDrag,
    stopDrag,
    setEdgeHidden,
    setLayout,
    subscribeEdgeHidden,
    subscribeOpenDetails,
});
