'use strict';
(() => {
  const MINUTE = 60000;
  const keys = ['fiveHour', 'weekly'];
  const value = (sample, key) => sample?.[key]?.remainingPercent;
  function autoRange(samples, now, previous) {
    let episode = null, latest = null, idleSince = null;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const comparable = keys.filter(key => Number.isFinite(value(a, key)) && Number.isFinite(value(b, key)));
      const missing = keys.some(key => Number.isFinite(value(a, key)) !== Number.isFinite(value(b, key)));
      if (b.gapBefore || b.at - a.at > 11 * MINUTE || !comparable.length || missing) {
        // Missing readings cannot establish an idle period, or a measured drop.
        idleSince = null;
        continue;
      }
      if (comparable.some(key => value(b, key) < value(a, key))) {
        episode ||= { start: a.at, end: b.at };
        episode.end = b.at;
        latest = { ...episode };
        idleSince = null;
      } else {
        idleSince ??= a.at;
        if (b.at - idleSince >= 30 * MINUTE) episode = null;
      }
    }
    const first = latest?.start ?? samples[0]?.at ?? now - 30 * MINUTE;
    const last = latest?.end ?? samples.at(-1)?.at ?? now;
    const padding = samples.length ? 2.5 * MINUTE : 0;
    const extent = last - first + 2 * padding;
    const span = ([30, 60, 120, 180, 360, 720, 1440, 10080].find(n => n * MINUTE >= extent) ?? Math.ceil(extent / MINUTE)) * MINUTE;
    let end = last + padding, start = end - span;
    if (previous?.sessionStart === first) {
      start = Math.min(start, previous.start);
      end = Math.max(end, previous.end);
    }
    return { start, end, sessionStart: first };
  }
  function nearestSample(samples, at, pixelsPerMs, radius = 16) {
    if (!samples.length || at < samples[0].at || at > samples.at(-1).at) return null;
    let lo = 0, hi = samples.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (samples[mid].at < at) lo = mid + 1; else hi = mid; }
    const right = samples[lo], left = samples[lo - 1];
    if (left && right && at > left.at && at < right.at && (right.gapBefore || right.at - left.at > 11 * MINUTE)) return null;
    const nearest = !left ? right : !right || at - left.at <= right.at - at ? left : right;
    return Math.abs(nearest.at - at) * pixelsPerMs <= radius ? nearest : null;
  }
  const model = { autoRange, nearestSample };
  if (typeof module !== 'undefined') module.exports = model;
  else window.trendModel = model;
})();
