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
    subscribeWorkAreaHeight: (listener) => {
        const handler = (_event, height) => listener(height);
        electron_1.ipcRenderer.on('quota:work-area-height', handler);
        return () => electron_1.ipcRenderer.removeListener('quota:work-area-height', handler);
    },
    openNotices: () => electron_1.ipcRenderer.invoke('quota:open-notices'),
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
