'use strict';
const HOUR = 3600000;
const DAY = 24 * HOUR;
function learnSchedule(records, now) {
    const times = [...new Set(records.filter(r => ['reset', 'banked'].includes(r.kind) && r.publishedAt <= now && r.publishedAt >= now - 90 * DAY).map(r => r.publishedAt))].sort((a, b) => a - b);
    const groups = times.filter((time, index) => index === 0 || time - times[index - 1] > 6 * HOUR);
    if (groups.length < 12 || groups.at(-1) - groups[0] < 14 * DAY) return { mode: 'hourly', samples: groups.length };
    let best = { count: 0, start: 0 };
    for (let start = 0; start < 24; start++) {
        const count = groups.filter(t => (new Date(t).getUTCHours() - start + 24) % 24 < 4).length;
        if (count > best.count) best = { count, start };
    }
    // Require a visible concentration before using a small historical sample.
    if (best.count / groups.length < 0.3) return { mode: 'hourly', samples: groups.length };
    return { mode: 'adaptive', samples: groups.length, startHourUTC: best.start, windowHours: 4, windowSamples: best.count };
}
function inBusyWindow(policy, time) {
    return policy.mode === 'adaptive' && (new Date(time).getUTCHours() - policy.startHourUTC + 24) % 24 < 4;
}
function nextCheckAt(policy, lastAttemptAt, now) {
    if (!lastAttemptAt) return now;
    const last = Math.min(lastAttemptAt, now);
    if (policy.mode !== 'adaptive') return last + HOUR;
    let due = last + (inBusyWindow(policy, now) ? HOUR / 2 : 2 * HOUR);
    // Wake at the beginning of the busy window; do not sleep through its first hour.
    for (let time = Math.floor(now / HOUR) * HOUR + HOUR; time < due; time += HOUR) {
        if (inBusyWindow(policy, time)) { due = Math.min(due, Math.max(time, last + HOUR / 2)); break; }
    }
    return due;
}
module.exports = { learnSchedule, inBusyWindow, nextCheckAt };
