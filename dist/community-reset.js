'use strict';
const API_URL = 'https://codex.gussuriworks.com/api/current?locale=en';
const INTERVAL = 10 * 60000;
const MAX_AGE = 6 * 3600000;
function postUrl(value) {
    return typeof value === 'string' && /^https:\/\/(?:x\.com|twitter\.com)\/thsottiaux\/status\/\d{10,25}$/.test(value)
        ? value.replace('twitter.com', 'x.com') : null;
}
function parseCommunity(data, now = Date.now()) {
    if (data?.schemaVersion !== 'public-v1' || !data.viewModel || !data.dataHealth) throw new Error('社区接口格式已变化');
    const asOf = Date.parse(data.checkedAt);
    if (!Number.isFinite(asOf) || asOf > now + 60000) throw new Error('社区数据时间无效');
    const probability = data.viewModel.probability24h;
    const healthy = data.dataHealth.overall === 'ok' && data.dataHealth.stale === false;
    const records = new Map();
    const add = (url, date, text, kind, stage) => {
        url = postUrl(url); const publishedAt = Date.parse(date);
        if (!url || !Number.isFinite(publishedAt) || publishedAt > now + 60000) return null;
        const id = url.split('/').at(-1);
        const record = { ...records.get(id), id, url, publishedAt, text: typeof text === 'string' ? text.slice(0, 5000) : '', kind, stage, verified: false, source: 'community' };
        records.set(id, record); return record;
    };
    const history = Array.isArray(data.viewModel.recentHistory) ? data.viewModel.recentHistory : [];
    let completed = null;
    for (const row of history) {
        if (!['confirmed_global', 'banked_distribution'].includes(row?.recordKind)) continue;
        const kind = row.recordKind === 'banked_distribution' ? 'banked' : 'reset';
        const record = add(row.source, row.signalAt || row.date, row.summary, kind, 'completed');
        const at = Date.parse(row.resetAt || row.date);
        if (record) {
            record.eventId = typeof (row.eventKey || row.key) === 'string' ? row.eventKey || row.key : record.id;
            record.communityCompletedAt = Number.isFinite(at) ? at : null;
            record.scope = typeof row.scope === 'string' ? row.scope : null;
            record.outcomeScope = /replacement|affected|failed|targeted|补发|受影响/i.test(record.text) ? 'targeted' : kind === 'reset' ? 'broad' : /all paid|all users|everyone|全.*(?:付费|用户)/i.test(record.text) ? 'broad' : 'unknown';
        }
        if (record && Number.isFinite(at) && at <= now && now - at < 86400000 && (!completed || at > completed.at)) completed = { id: record.id, kind, stage: 'completed', at };
    }
    const activity = data.latestTiboActivity;
    if (activity) {
        const previous = records.get(postUrl(activity.sourceUrl)?.split('/').at(-1));
        add(activity.sourceUrl, activity.createdAt, activity.text, previous?.kind || 'hint', previous?.stage || 'hint');
    }
    const window = data.viewModel.activeWindow;
    let active = completed;
    if (window?.active === true && window.kind === 'official' && ['forced', 'banked'].includes(window.noticeKind)) {
        const kind = window.noticeKind === 'banked' ? 'banked' : 'reset';
        const previous = records.get(postUrl(window.source)?.split('/').at(-1));
        const record = add(window.source, window.openedAt, previous?.text || window.summary, kind, 'announced');
        if (record) active = { id: record.id, kind, stage: 'announced', at: record.publishedAt };
    }
    const validProbability = typeof probability === 'number' && Number.isFinite(probability) && probability >= 0 && probability <= 1;
    return { asOf, healthy, probability: validProbability ? probability : null, modelVersion: typeof data.viewModel.modelVersion === 'string' ? data.viewModel.modelVersion : null,
        percent: validProbability ? Math.round(probability * 100) : null,
        active, records: [...records.values()].sort((a, b) => b.publishedAt - a.publishedAt) };
}
async function fetchCommunity({ fetchImpl = fetch, signal } = {}) {
    const response = await fetchImpl(API_URL, { headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`社区接口请求失败（HTTP ${response.status}）`);
    return response.json();
}
module.exports = { API_URL, INTERVAL, MAX_AGE, postUrl, parseCommunity, fetchCommunity };
