"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCountdown = formatCountdown;
exports.formatLastUpdatedAt = formatLastUpdatedAt;
exports.buildRendererViewModel = buildRendererViewModel;
const UNAVAILABLE = '暂不可用';
function percentageText(value) {
    return value === null ? UNAVAILABLE : `${Math.round(value)}%`;
}
function toMillis(epoch) {
    // App-server reset timestamps are Unix seconds; accepting milliseconds keeps this
    // helper useful for test fixtures and future protocol revisions.
    return epoch < 100_000_000_000 ? epoch * 1_000 : epoch;
}
function formatCountdown(resetsAt, now = Date.now()) {
    if (resetsAt === null)
        return UNAVAILABLE;
    const remainingMs = Math.max(0, toMillis(resetsAt) - now);
    const totalMinutes = Math.ceil(remainingMs / 60_000);
    if (totalMinutes < 1)
        return '<1m';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0)
        return `${minutes}m`;
    return `${hours}h${minutes}m`;
}
function formatResetAt(resetsAt) {
    if (resetsAt === null)
        return null;
    const resetAt = new Date(toMillis(resetsAt));
    const twoDigits = (value) => String(value).padStart(2, '0');
    return `${twoDigits(resetAt.getFullYear() % 100)}Y ${twoDigits(resetAt.getMonth() + 1)}M ${twoDigits(resetAt.getDate())}D ${twoDigits(resetAt.getHours())}:${twoDigits(resetAt.getMinutes())}`;
}
function formatLastUpdatedAt(lastUpdatedAt, locale = 'zh-CN') {
    if (lastUpdatedAt === null)
        return null;
    const time = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(new Date(lastUpdatedAt));
    return `最后更新于 ${time}`;
}
function windowText(window) {
    return percentageText(window.remainingPercent);
}
function buildRendererViewModel(state, now = Date.now()) {
    const missingStatusText = state.status === 'loading'
        ? '刷新中…'
        : state.status === 'error'
            ? '连接失败'
            : UNAVAILABLE;
    const fiveHour = state.fiveHour ?? { remainingPercent: null, resetsAt: null, windowDurationMins: null };
    const weekly = state.weekly ?? { remainingPercent: null, resetsAt: null, windowDurationMins: null };
    const hasFiveHour = fiveHour.remainingPercent !== null;
    const hasWeekly = weekly.remainingPercent !== null;
    const fiveHourText = hasFiveHour ? windowText(fiveHour) : missingStatusText;
    const weeklyText = hasWeekly ? windowText(weekly) : missingStatusText;
    const resetCount = state.resetCredits?.availableCount ?? null;
    return {
        fiveHourRingPercent: fiveHour.remainingPercent ?? 0,
        weeklyRingPercent: weekly.remainingPercent ?? 0,
        ringPercent: weekly.remainingPercent ?? 0,
        centerText: weeklyText,
        fiveHourText,
        weeklyText,
        fiveHourCountdown: hasFiveHour ? formatCountdown(fiveHour.resetsAt, now) : missingStatusText,
        weeklyCountdown: hasWeekly ? formatCountdown(weekly.resetsAt, now) : missingStatusText,
        fiveHourResetAtText: hasFiveHour ? formatResetAt(fiveHour.resetsAt) : null,
        weeklyResetAtText: hasWeekly ? formatResetAt(weekly.resetsAt) : null,
        lastUpdatedText: formatLastUpdatedAt(state.lastUpdatedAt),
        refreshDisabled: state.status === 'loading',
        resetCountText: resetCount === null ? UNAVAILABLE : String(Math.max(0, Math.floor(resetCount))),
        resetDisabled: resetCount === null || resetCount <= 0 || state.isResetting || state.status === 'loading',
        note: state.status === 'loading' ? '正在刷新…' : state.errorMessage,
    };
}
