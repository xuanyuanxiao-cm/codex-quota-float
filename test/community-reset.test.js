const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommunity, fetchCommunity, postUrl, API_URL, MAX_AGE } = require('../dist/community-reset');
const { noticePresentation } = require('../dist/renderer/notice-presentation');
const { snapshot } = require('./notice-fixtures.cjs');
const NOW = Date.parse('2026-09-26T06:00:00Z');
test('community response validates versions, dates and probability units', () => {
    const data = snapshot(NOW); assert.equal(parseCommunity(data, NOW).percent, 35);
    for (const value of [null, '0.35', -0.1, 35, Infinity]) {
        data.viewModel.probability24h = value; assert.equal(parseCommunity(data, NOW).percent, null);
    }
    assert.throws(() => parseCommunity({ ...data, schemaVersion: 'public-v2' }, NOW));
    assert.throws(() => parseCommunity({ ...data, checkedAt: 'invalid' }, NOW));
    assert.throws(() => parseCommunity({ ...data, checkedAt: new Date(NOW + 120000).toISOString() }, NOW));
});
test('community request uses fixed unauthenticated endpoint with timeout and no redirects', async () => {
    const result = await fetchCommunity({ fetchImpl: async (url, options) => {
        assert.equal(url, API_URL); assert.deepEqual(options.headers, { Accept: 'application/json' });
        assert.equal(options.body, undefined); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
        assert.equal(options.credentials, 'omit');
        return { ok: true, json: async () => snapshot(NOW) };
    } }); assert.equal(result.schemaVersion, 'public-v1');
});
test('external URLs and synthetic periodic resets cannot become announcements', () => {
    for (const url of ['https://x.com.evil.test/thsottiaux/status/12345678901', 'file:///C:/Windows/test', 'https://x.com/other/status/12345678901']) assert.equal(postUrl(url), null);
    const data = snapshot(NOW);
    data.viewModel.recentHistory = [{ recordKind: 'regular_completed', source: 'https://x.com/thsottiaux/status/12345678901', date: new Date(NOW).toISOString() }];
    assert.deepEqual(parseCommunity(data, NOW).records, []);
});
test('announcement IDs deduplicate; community history is never local verification', () => {
    const result = parseCommunity(snapshot(NOW, [{ id: '12345678901', time: NOW - 3600000 }]), NOW);
    assert.equal(result.records.length, 1); assert.equal(result.records[0].verified, false);
    assert.equal(result.records[0].stage, 'announced'); assert.equal(result.active.stage, 'announced');
});
test('stale flags, wall-clock expiry and fetch errors all suppress percentages', () => {
    const state = { forecast: { asOf: NOW, healthy: true, percent: 35 } };
    assert.equal(noticePresentation(state, NOW).value, '35%');
    assert.equal(noticePresentation(state, NOW + MAX_AGE + 1).value, '—');
    assert.equal(noticePresentation({ ...state, error: 'offline' }, NOW).value, '—');
    const data = snapshot(NOW); data.dataHealth.stale = true;
    assert.equal(parseCommunity(data, NOW).healthy, false);
    assert.equal(noticePresentation({ forecast: parseCommunity(data, NOW) }, NOW).value, '—');
});
test('unread limit changes do not masquerade as resets; a grant does not imply quota recovery', () => {
    const state = { forecast: { asOf: NOW, healthy: true, percent: 35 }, unread: 2, records: [{ kind: 'limits', verified: true }] };
    assert.equal(noticePresentation(state, NOW).value, '35%');
    assert.equal(noticePresentation({ ...state, activeNotice: { kind: 'banked', stage: 'completed', verified: true } }, NOW).value, '已发放重置卡');
});
