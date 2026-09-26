const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ResetNotices, classifyPost, originalPost, HOUR, DAY } = require('../dist/notices');
const { INTERVAL } = require('../dist/community-reset');
const { noticePresentation } = require('../dist/renderer/notice-presentation');
const { url, postText, original, snapshot } = require('./notice-fixtures.cjs');
const NOW = Date.parse('2026-09-26T06:00:00Z');
function setup(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-notices-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let now = NOW, items = [{ id: '12345678901', time: NOW - HOUR }], fail = false;
    const notified = [], calls = [];
    const options = { now: () => now, canVerify: () => true, onNotice: r => notified.push(r.id),
        loadCommunity: async () => { calls.push('community'); if (fail) throw Error('offline'); return snapshot(now, items); },
        scrapePage: async address => { calls.push(address); return original(address.split('/').at(-1)); } };
    const service = new ResetNotices(path.join(dir, 'notices.json'), options);
    t.after(() => service.stop());
    return { service, options, notified, calls, advance: time => { now += time; }, items: value => { items = value; }, fail: value => { fail = value; }, now: () => now };
}
test('classifier separates announcements, completion, grants and unrelated explanations', () => {
    assert.deepEqual(classifyPost(postText), { kind: 'reset', stage: 'announced' });
    assert.deepEqual(classifyPost('We reset usage limits for Codex yesterday.'), { kind: 'reset', stage: 'completed' });
    assert.deepEqual(classifyPost("We've added a banked reset for all paid users."), { kind: 'banked', stage: 'completed' });
    assert.deepEqual(classifyPost("We'll send all paid users a banked reset."), { kind: 'banked', stage: 'announced' });
    assert.equal(classifyPost('We increased usage limits for Codex.').kind, 'limits');
    for (const text of ['Banked resets expire after 30 days.', 'We will reset your password if you request it.', 'We will reset usage limits for Codex if the outage lasts.', 'We are not going to reset usage limits for Codex.', 'Will we reset usage limits for Codex?', 'We might send a banked reset to all paid users.']) assert.equal(classifyPost(text).kind, 'hint', text);
});
test('first sync is silent; new posts notify once and reading does not change announcement state', async t => {
    const s = setup(t); await s.service.refresh(); assert.deepEqual(s.notified, []);
    s.advance(INTERVAL); s.items([{ id: '12345678902', time: NOW + 1000 }]); await s.service.refresh();
    assert.deepEqual(s.notified, ['12345678902']); assert.equal(s.service.view().unread, 1);
    const before = noticePresentation(s.service.view(), s.now());
    s.service.markRead('12345678902'); assert.equal(s.service.view().unread, 0);
    assert.deepEqual(noticePresentation(s.service.view(), s.now()), before);
    const restarted = new ResetNotices(s.service.file, s.options); t.after(() => restarted.stop());
    s.advance(INTERVAL); await restarted.refresh(); assert.equal(s.notified.length, 1);
});
test('only the selected announcement is marked read', async t => {
    const s = setup(t); await s.service.refresh(); s.advance(INTERVAL);
    s.items([{ id: '12345678903', time: NOW + 2000 }, { id: '12345678902', time: NOW + 1000 }]);
    await s.service.refresh(); assert.equal(s.service.view().unread, 2);
    s.service.markRead('12345678902'); assert.equal(s.service.view().unread, 1);
    s.service.markRead(); assert.equal(s.service.view().unread, 1);
});
test('missing verification key does not block community data or claim local verification', async t => {
    const s = setup(t); s.service.canVerify = () => false; await s.service.refresh();
    assert.equal(s.service.view().forecast.percent, 35);
    assert.equal(s.service.view().activeNotice.verified, false);
    assert.equal(s.calls.length, 1); assert.equal(s.service.view().unread, 0);
    assert.match(noticePresentation(s.service.view(), s.now()).note, /进展待核实/);
});
test('an original contradicting the community classification never becomes an announcement', async t => {
    const s = setup(t); s.service.scrapePage = async address => original(address.split('/').at(-1), 'Banked resets expire after 30 days.');
    await s.service.refresh(); assert.equal(s.service.view().activeNotice, null);
    assert.equal(s.service.view().records[0].verificationStatus, 'rejected');
    assert.equal(s.service.view().records[0].verified, false); assert.deepEqual(s.notified, []);
});
test('temporary verification failures retry after backoff without exhausting content attempts', async t => {
    const s = setup(t); let fail = true, attempts = 0;
    s.service.scrapePage = async address => { attempts++; if (fail) throw Error('network'); return original(address.split('/').at(-1)); };
    for (let i = 0; i < 4; i++) { await s.service.refresh(); s.advance(6 * HOUR); }
    assert.equal(attempts, 4); assert.equal(s.service.view().records[0].verificationAttempts, undefined);
    fail = false; await s.service.refresh(); assert.equal(s.service.view().records[0].verified, true);
});
test('unrecognizable original pages use bounded attempts and exclude replies', async t => {
    const s = setup(t); let calls = 0; s.service.scrapePage = async () => { calls++; return '<h1>Login</h1>'; };
    for (let i = 0; i < 5; i++) { await s.service.refresh(); s.advance(6 * HOUR); }
    assert.equal(calls, 3); assert.equal(s.service.view().records[0].verified, false);
    assert.equal(originalPost(`<p>${url('12345678901')}</p><h2>Post</h2><p>Hi</p><h2>Thread</h2>${original('12345678901')}`, url('12345678901')), null);
    assert.equal(originalPost(original('123456789012'), url('12345678901')), null);
});
test('manual checks, restart and concurrent calls respect the ten-minute interval', async t => {
    const s = setup(t); await Promise.all([s.service.refresh(), s.service.refresh(true)]);
    const count = s.calls.length; s.advance(60000); await s.service.refresh(true); assert.equal(s.calls.length, count);
    const restarted = new ResetNotices(s.service.file, s.options); t.after(() => restarted.stop());
    await restarted.refresh(true); assert.equal(s.calls.length, count);
    s.service.setEnabled(false); s.advance(HOUR); await s.service.refresh(true); assert.equal(s.calls.length, count);
});
test('network failure retains records but suppresses the forecast and backs off', async t => {
    const s = setup(t); await s.service.refresh(); s.advance(INTERVAL); s.fail(true); await s.service.refresh();
    assert.equal(s.service.view().records.length, 1);
    assert.equal(noticePresentation(s.service.view(), s.now()).value, '—');
    assert.equal(s.service.view().nextCheckAt, s.now() + 2 * INTERVAL);
    const restarted = new ResetNotices(s.service.file, s.options); t.after(() => restarted.stop());
    assert.equal(noticePresentation(restarted.view(), s.now()).value, '—', 'restart preserves failure state');
    s.advance(31 * DAY); assert.equal(s.service.view().records.length, 0);
});
test('a locally verified limit adjustment overrides an incorrect community reset classification', async t => {
    const s = setup(t); s.service.scrapePage = async address => original(address.split('/').at(-1), 'We increased usage limits for Codex.');
    await s.service.refresh(); assert.equal(s.service.view().records[0].kind, 'limits');
    assert.equal(s.service.view().activeNotice, null);
    assert.equal(noticePresentation(s.service.view(), s.now()).value, '35%');
});
test('stopping an in-flight collection prevents state and notification changes', async t => {
    const s = setup(t); let resolve;
    s.service.loadCommunity = () => new Promise(r => { resolve = r; });
    const pending = s.service.refresh(); s.service.setEnabled(false); resolve(snapshot(NOW, [{ id: '12345678901', time: NOW - HOUR }]));
    await pending; assert.equal(s.service.view().records.length, 0); assert.equal(s.service.view().lastSuccessAt, null);
});
test('legacy migration preserves preferences and history without trusting old classifications', t => {
    const s = setup(t); fs.writeFileSync(s.service.file, JSON.stringify({ enabled: false, showProbability: false, records: [{ id: '12345678901', url: url('12345678901'), publishedAt: NOW - HOUR, text: postText, verified: true, kind: 'reset' }] }));
    const migrated = new ResetNotices(s.service.file, s.options); t.after(() => migrated.stop());
    assert.equal(migrated.view().enabled, false); assert.equal(migrated.view().showProbability, false);
    assert.equal(migrated.view().records.length, 1); assert.equal(migrated.view().unread, 0); assert.equal(migrated.view().records[0].verified, false);
});
test('card arrival uses new IDs, never first reads, missing readings or stale responses', t => {
    const s = setup(t);
    const state = (ids, remaining = 20) => ({ status: 'ready', planType: 'pro', fiveHour: { remainingPercent: remaining }, weekly: { remainingPercent: 50 }, lastUpdatedAt: NOW,
        resetCredits: ids ? { credits: ids.map(id => ({ id, status: 'available', expiresAt: (NOW + DAY) / 1000 })) } : null });
    s.service.updateAccount(state(['a'])); assert.equal(s.service.view().cardArrival, null);
    s.service.updateAccount({ ...state(['a', 'b']), status: 'error' }); assert.equal(s.service.view().cardArrival, null);
    s.service.updateAccount(state(null)); s.service.updateAccount(state(['a', 'b'])); assert.equal(s.service.view().cardArrival, null);
    s.service.updateAccount(state(['b', 'c'])); assert.equal(s.service.view().cardArrival.count, 1);
    assert.equal(s.service.view().account.fiveHour, 20); assert.deepEqual(s.service.view().recoveries, {});
});
