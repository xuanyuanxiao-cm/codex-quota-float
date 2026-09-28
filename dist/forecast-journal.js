'use strict';
const DAY = 86400000;
function recordForecast(saved, snapshot, now) {
    saved.forecasts ||= [];
    if (snapshot.healthy && now - snapshot.asOf <= 21600000 && Number.isFinite(snapshot.probability) &&
        !saved.forecasts.some(f => f.asOf === snapshot.asOf)) {
        saved.forecasts.push({ asOf: snapshot.asOf, observedAt: now, windowStart: snapshot.asOf, windowEnd: snapshot.asOf + DAY,
            probability: snapshot.probability, modelVersion: snapshot.modelVersion, source: 'codex-reset-observatory',
            target: 'broad-reset-or-banked', evidenceIds: snapshot.records.map(r => r.id), outcome: 'pending' });
    }
    for (const f of saved.forecasts) {
        if (f.outcome === 'event') continue;
        const event = saved.records.find(r => r.outcomeScope === 'broad' && r.stage === 'completed' && r.verified &&
            !r.timestampBasis && r.publishedAt > Math.max(f.windowStart, f.observedAt) && r.publishedAt <= f.windowEnd && ['reset', 'banked'].includes(r.kind));
        if (event) { f.outcome = 'event'; f.eventId = event.eventId || event.id; f.evidenceUrl = event.url; f.resolvedAt = now; }
        else if (now >= f.windowEnd) {
            f.outcome = 'unscorable'; f.reason = '来源仅覆盖部分公开消息，未发现记录不能证明没有重置'; f.resolvedAt = now;
        }
    }
}
function forecastSummary(saved) {
    const rows = saved.forecasts || [];
    return { total: rows.length, pending: rows.filter(r => r.outcome === 'pending').length,
        events: rows.filter(r => r.outcome === 'event').length, unscorable: rows.filter(r => r.outcome === 'unscorable').length };
}
module.exports = { recordForecast, forecastSummary };
