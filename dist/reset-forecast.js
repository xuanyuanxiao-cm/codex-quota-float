'use strict';
const DAY = 86400000;
// Empirical 24-hour bins, aligned to the latest successful collection time.
// This describes the collected timeline, not verified complete event coverage.
function estimateResetForecast(timings, asOf, now = Date.now()) {
    const unavailable = reason => ({ status: 'unavailable', percent: null, reason, asOf: asOf || null });
    if (!Number.isFinite(asOf) || asOf > now || now - asOf > 6 * 3600000) return unavailable('数据未更新或已超过 6 小时');
    const times = [...new Set((timings || []).filter(r => r && ['reset', 'banked'].includes(r.kind) && Number.isFinite(r.publishedAt) && r.publishedAt <= asOf && r.publishedAt >= asOf - 90 * DAY).map(r => r.publishedAt))].sort((a, b) => a - b);
    const groups = times.filter((time, i) => i === 0 || time - times[i - 1] > 6 * 3600000);
    const days = times.length ? Math.min(90, Math.floor((asOf - times[0]) / DAY)) : 0;
    if (days < 14 || groups.length < 12) return unavailable('至少需要 14 个完整日窗口和 12 组记录');
    const positive = new Set(groups.map(time => Math.floor((asOf - time) / DAY)).filter(bin => bin >= 0 && bin < days)).size;
    // Beta(1,1) smoothing avoids interpreting a short all-zero/all-one sample as certainty.
    const percent = Math.round(100 * (positive + 1) / (days + 2));
    return { status: 'estimated', percent, asOf, days, positive, samples: groups.length,
        reason: '基于第三方收录记录的历史频率，尚未经过前瞻校准' };
}
module.exports = { estimateResetForecast };
