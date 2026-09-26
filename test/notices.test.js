const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ResetNotices, parseTimeline, originalPost, postUrl, HOUR, DAY } = require('../dist/notices');
const { learnSchedule, nextCheckAt, inBusyWindow } = require('../dist/notice-schedule');
const NOW = Date.parse('2026-09-26T06:00:00Z');
const url = id => `https://x.com/thsottiaux/status/${id}`;
const text = "We'll reset usage limits for all paid users across Codex.";
const article = (id, time, body = text) => `<article><time datetime="${new Date(time).toISOString()}"></time><blockquote>${body}</blockquote><a href="${url(id)}">Original</a></article>`;
const page = articles => '<h1>Tibo desk</h1>' + articles;
const original = (id, body = text) => `<h1>Post by @thsottiaux</h1><p>Author: Tibo @thsottiaux URL: ${url(id)}</p><h2>Post</h2><p>${body}</p><h2>Thread</h2><p>unrelated</p>`;
function setup(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-notices-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let now = NOW, content = page(article('12345678901', NOW - HOUR));
    const notified = [], calls = [];
    const options = { now: () => now, onNotice: r => notified.push(r.id), scrapePage: async address => {
        calls.push(address); if (content instanceof Error) throw content;
        return address.endsWith('/timeline') ? content : original(address.split('/').at(-1));
    } };
    const service = new ResetNotices(path.join(dir, 'notices.json'), options);
    t.after(() => service.stop());
    return { service, options, notified, calls, advance: time => { now += time; }, content: value => { content = value; } };
}
test('first sync is silent, a new verified announcement notifies once, including after restart', async t => {
    const s = setup(t); await s.service.refresh(); assert.deepEqual(s.notified, []);
    assert.equal(s.service.view().records[0].verified, true);
    s.advance(HOUR); s.content(page(article('12345678902', NOW + 1000) + article('12345678901', NOW - HOUR)));
    await s.service.refresh(); assert.deepEqual(s.notified, ['12345678902']); assert.equal(s.service.view().unread, 1);
    s.advance(HOUR); await s.service.refresh(); assert.equal(s.notified.length, 1);
    const restarted = new ResetNotices(s.service.file, s.options); t.after(() => restarted.stop());
    await restarted.refresh(); assert.equal(s.notified.length, 1);
    restarted.markRead(); assert.equal(restarted.view().unread, 0);
});
test('network failure preserves history and restart respects persisted attempt time', async t => {
    const s = setup(t); await s.service.refresh(); s.advance(HOUR); s.content(new Error('offline'));
    await s.service.refresh(); assert.match(s.service.view().error, /更新失败/); assert.equal(s.service.view().records.length, 1);
    const count = s.calls.length; const restarted = new ResetNotices(s.service.file, s.options); t.after(() => restarted.stop());
    await restarted.refresh(); assert.equal(s.calls.length, count);
    restarted.setEnabled(false); s.advance(2 * HOUR); await restarted.refresh(true); assert.equal(s.calls.length, count);
});
test('unverified originals never become announcements or notify', async t => {
    const s = setup(t); await s.service.refresh(); s.advance(HOUR);
    s.content(page(article('12345678902', NOW + 1000)));
    const load = s.service.scrapePage;
    s.service.scrapePage = async address => address.endsWith('/timeline') ? load(address) : '<h1>Please log in</h1>';
    await s.service.refresh(); assert.equal(s.service.view().records[0].verified, false); assert.deepEqual(s.notified, []);
});
test('a delayed feed entry is still new after an intervening successful empty poll', async t => {
    const s = setup(t); await s.service.refresh(); s.advance(HOUR); await s.service.refresh();
    s.advance(HOUR); s.content(page(article('12345678902', NOW + 1000)));
    await s.service.refresh(); assert.deepEqual(s.notified, ['12345678902']);
});
test('unreadable original posts stop retrying after three checks', async t => {
    const s = setup(t); let originals = 0;
    const load = s.service.scrapePage;
    s.service.scrapePage = async address => {
        if (address.endsWith('/timeline')) return load(address);
        originals++; throw new Error('blocked');
    };
    for (let i = 0; i < 5; i++) { await s.service.refresh(); s.advance(HOUR); }
    assert.equal(originals, 3); assert.equal(s.service.view().records[0].verified, false);
});
test('HTML replies, hostile links, unknown layouts and future dates are not trusted', () => {
    assert.equal(originalPost(`<p>${url('12345678901')}</p><h2>Post</h2><p>hello</p><h2>Thread</h2>${original('12345678901')}`, url('12345678901')), null);
    assert.equal(postUrl('https://x.com.evil.test/thsottiaux/status/12345678901'), null);
    assert.equal(postUrl('file:///C:/Windows/test'), null);
    assert.throws(() => parseTimeline('<h1>Access denied</h1>', NOW));
    assert.equal(parseTimeline(page(article('12345678901', NOW + DAY)), NOW).length, 0);
    assert.equal(parseTimeline(page(article('12345678901', NOW - HOUR, 'Codex is down')), NOW).length, 0);
});
test('retention bounds records, and elapsed time clears old history even without a successful fetch', async t => {
    const s = setup(t);
    s.content(page(Array.from({ length: 250 }, (_, i) => article(String(12345678900 + i), NOW - (i + 1) * 1000)).join('')));
    await s.service.refresh(); assert.equal(s.service.view().records.length, 200);
    s.advance(31 * DAY); s.content(new Error('offline')); await s.service.refresh(); assert.equal(s.service.view().records.length, 0);
});
test('first, stale and missing quota readings never invent a recovery', t => {
    const s = setup(t);
    const state = remaining => ({ status: 'ready', fiveHour: { remainingPercent: remaining }, weekly: { remainingPercent: 0 }, lastUpdatedAt: NOW });
    s.service.updateAccount(state(100)); assert.deepEqual(s.service.view().recoveries, {});
    s.service.updateAccount(state(0)); s.service.updateAccount({ ...state(100), status: 'error' });
    assert.deepEqual(s.service.view().recoveries, {}); assert.equal(s.service.view().account.stale, true);
    s.service.updateAccount(state(null)); s.service.updateAccount(state(100)); assert.deepEqual(s.service.view().recoveries, {});
    s.service.updateAccount(state(0)); s.service.updateAccount(state(60)); assert.equal(s.service.view().recoveries.fiveHour.remaining, 60);
    assert.equal(s.service.view().account.weekly, 0);
});
test('small or diffuse samples fall back to hourly, concentrated history selects a four-hour window', () => {
    assert.equal(learnSchedule([{ kind: 'reset', publishedAt: NOW - DAY }], NOW).mode, 'hourly');
    const records = Array.from({ length: 20 }, (_, i) => ({ kind: 'reset', publishedAt: Date.parse('2026-09-01T19:00:00Z') + i * DAY }));
    const policy = learnSchedule(records, NOW); assert.equal(policy.mode, 'adaptive'); assert.equal(policy.samples, 20);
    assert.equal(inBusyWindow(policy, Date.parse('2026-09-25T19:00:00Z')), true);
    const quiet = Date.parse('2026-09-25T06:00:00Z'); assert.equal(nextCheckAt(policy, quiet, quiet), quiet + 2 * HOUR);
    const busy = Date.parse('2026-09-25T19:00:00Z'); assert.equal(nextCheckAt(policy, busy, busy), busy + HOUR / 2);
});
test('adaptive scheduling wakes at busy-window boundary and works across midnight', () => {
    const policy = { mode: 'adaptive', startHourUTC: 22 };
    const before = Date.parse('2026-09-25T21:30:00Z');
    assert.equal(nextCheckAt(policy, before, before), Date.parse('2026-09-25T22:00:00Z'));
    assert.equal(inBusyWindow(policy, Date.parse('2026-09-26T01:59:00Z')), true);
    assert.equal(inBusyWindow(policy, Date.parse('2026-09-26T02:00:00Z')), false);
});
