"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRateLimits = normalizeRateLimits;
function normalizeWindow(window) {
    if (window == null) {
        return {
            remainingPercent: null,
            resetsAt: null,
            windowDurationMins: null,
        };
    }
    const usedPercent = window.usedPercent;
    return {
        remainingPercent: usedPercent === undefined
            ? null
            : 100 - Math.min(100, Math.max(0, usedPercent)),
        resetsAt: window.resetsAt ?? null,
        windowDurationMins: window.windowDurationMins ?? null,
    };
}
function normalizeRateLimits(snapshot) {
    const windows = [snapshot.primary, snapshot.secondary];
    const fiveHour = windows.find((window) => window?.windowDurationMins === 300) ??
        (snapshot.primary?.windowDurationMins == null ? snapshot.primary : undefined);
    const weekly = windows.find((window) => window?.windowDurationMins === 10_080) ??
        (snapshot.secondary?.windowDurationMins == null ? snapshot.secondary : undefined);
    return {
        fiveHour: normalizeWindow(fiveHour),
        weekly: normalizeWindow(weekly),
    };
}
