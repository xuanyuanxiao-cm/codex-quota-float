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
const setExpanded = (expanded) => electron_1.ipcRenderer.invoke('quota:set-expanded', expanded);
const subscribeEdgeHidden = (listener) => {
    const handler = (_event, hidden) => listener(hidden);
    electron_1.ipcRenderer.on('quota:edge-hidden', handler);
    return () => electron_1.ipcRenderer.removeListener('quota:edge-hidden', handler);
};
electron_1.contextBridge.exposeInMainWorld('quota', {
    subscribe,
    refreshNow,
    resetQuota,
    moveToY,
    startDrag,
    stopDrag,
    setEdgeHidden,
    setExpanded,
    subscribeEdgeHidden,
});
