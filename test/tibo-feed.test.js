const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TiboFeed, INTERVAL, RETENTION } = require('../dist/tibo-feed');
const DAY = 86400000;
function setup(t, options = {}) {
    let now = Date.parse('2026-10-02T00:00:00Z');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tibo-feed-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const source = { source: 'x', configured: () => true, canTranslate: () => false, loadPage: async () => ({ records: [], cursor: null }), ...options };
    const file = path.join(dir, 'feed.json');
    const feed = new TiboFeed(file, { source, now: () => now });
    t.after(() => feed.stop());
    const post = (id, publishedAt = now - 10000) => ({ id: String(id), url: `https://x.com/thsottiaux/status/${id}`, publishedAt, type: 'post', originalText: 'A product update.' });
    return { feed, source, file, post, now: () => now, advance: ms => { now += ms; } };
}
test('first import is read, subsequent new posts persist unread with a 30 minute interval', async t => {
    const s = setup(t); let calls = 0; let rows = [s.post(12345678901)];
    s.source.loadPage = async () => { calls++; return { records: rows, cursor: null }; };
    await s.feed.refresh(); assert.equal(s.feed.view().unread, 0);
    assert.equal(s.feed.view().nextCheckAt, s.now() + INTERVAL);
    s.advance(INTERVAL - 1); await s.feed.refresh(); assert.equal(calls, 1);
    s.advance(1); rows = [...rows, s.post(12345678902), s.post(12345678903)];
    await s.feed.refresh(); assert.equal(s.feed.view().unread, 2);
    const restarted = new TiboFeed(s.file, { source: s.source, now: s.now });
    assert.equal(restarted.view().unread, 2); assert.equal(restarted.view().records.length, 3);
    s.advance(INTERVAL); await s.feed.refresh(); assert.equal(s.feed.view().unread, 2);
});
test('expired unread posts are removed, future and malformed posts are rejected', async t => {
    const s = setup(t); await s.feed.refresh(); s.advance(INTERVAL);
    s.source.loadPage = async () => ({ records: [s.post(12345678901), s.post(12345678902, s.now() - RETENTION), s.post(12345678903, s.now() + DAY), { ...s.post(12345678904), url: 'javascript:alert(1)' }], cursor: null });
    await s.feed.refresh(); assert.equal(s.feed.view().unread, 1);
    s.advance(RETENTION); s.feed.persist(); assert.deepEqual(s.feed.view().records, []);
    assert.equal(JSON.parse(fs.readFileSync(s.file)).records.length, 0);
});
test('failed second page preserves cursor and does not advance successful watermark', async t => {
    const s = setup(t); let fail = true; const seen = [];
    s.source.loadPage = async ({ cursor }) => { seen.push(cursor); if (!cursor) return { records: [s.post(12345678901)], cursor: 'page2' }; if (fail) throw Error('offline'); return { records: [s.post(12345678902)], cursor: null }; };
    await s.feed.refresh(); assert.equal(s.feed.saved.sync.cursor, 'page2'); assert.equal(s.feed.view().lastSuccessAt, null);
    fail = false; s.advance(INTERVAL * 2); await s.feed.refresh();
    assert.deepEqual(seen, [null, 'page2', null, 'page2']); assert.equal(s.feed.view().records.length, 2); assert.ok(s.feed.view().lastSuccessAt);
});
test('bulk read acknowledges only the supplied snapshot and revision', async t => {
    const s = setup(t); await s.feed.refresh(); s.advance(INTERVAL);
    let rows = [s.post(12345678901)]; s.source.loadPage = async () => ({ records: rows, cursor: null });
    await s.feed.refresh(); const snapshot = s.feed.view().records;
    s.advance(INTERVAL); rows = [...rows, s.post(12345678902)]; await s.feed.refresh();
    s.feed.markRead(snapshot); assert.equal(s.feed.view().unread, 1);
    s.feed.markRead([{ id: '12345678902', revision: 999 }]); assert.equal(s.feed.view().unread, 1);
});
test('translation does not duplicate or acknowledge posts and failures retain originals', async t => {
    const s = setup(t); await s.feed.refresh(); s.advance(INTERVAL);
    s.source.canTranslate = () => true;
    s.source.loadPage = async () => ({ records: [s.post(12345678901)], cursor: null });
    s.source.hydrate = async () => { throw Error('Firecrawl 余额不足'); };
    await s.feed.refresh(); assert.equal(s.feed.view().unread, 1); assert.ok(s.feed.view().translationError.includes('余额'));
    s.advance(6 * 3600000); s.source.hydrate = async r => ({ originalText: r.originalText, chineseText: '产品更新。' });
    await s.feed.refresh(); assert.equal(s.feed.view().records[0].chineseText, '产品更新。'); assert.equal(s.feed.view().unread, 1);
});
test('clear while fetching suppresses old arrivals and preserves new post notifications', async t => {
    const s = setup(t); await s.feed.refresh(); s.advance(INTERVAL);
    let release; s.source.loadPage = () => new Promise(resolve => { release = resolve; });
    const pending = s.feed.refresh(); s.feed.clear();
    release({ records: [s.post(12345678901)], cursor: null }); await pending;
    assert.equal(s.feed.view().records.length, 0);
    s.advance(INTERVAL); s.source.loadPage = async () => ({ records: [s.post(12345678902)], cursor: null }); await s.feed.refresh();
    assert.equal(s.feed.view().unread, 1);
});
test('storage failure rolls back read state and failed page writes do not advance cursor', async t => {
    const s = setup(t); await s.feed.refresh(); s.advance(INTERVAL);
    s.source.loadPage = async () => ({ records: [s.post(12345678901)], cursor: null }); await s.feed.refresh();
    s.feed.file = path.join(s.file, 'bad'); s.feed.markRead(s.feed.view().records);
    assert.equal(s.feed.view().unread, 1); assert.ok(s.feed.view().error.includes('无法保存'));
});
test('discovery snippets remain hidden until authenticated original retrieval', async t => {
    const s = setup(t, { source: 'firecrawl', canTranslate: () => true });
    s.source.loadPage = async () => ({ records: [{ ...s.post(12345678901), originalText: '' }], cursor: null });
    s.source.hydrate = async () => { throw Error('unreadable'); };
    await s.feed.refresh(); assert.equal(s.feed.view().pending, 1); assert.equal(s.feed.view().records.length, 0);
});
test('reading a feed item before reset import does not acknowledge the reset channel', async t => {
    const { ResetNotices } = require('../dist/notices');
    const s = setup(t); const notices = new ResetNotices(s.file + '.notices', { now: s.now });
    const post = { ...s.post('12345678901'), originalText: "We'll reset usage limits for all paid users across Codex.", eligible: true, read: true };
    notices.importTiboPost(post); assert.equal(notices.view().unread, 1);
    notices.markRead(post.id); notices.importTiboPost({ ...post, chineseText: '将重置额度。' });
    assert.equal(notices.view().unread, 0);
    s.advance(RETENTION + DAY); notices.persist(); assert.equal(notices.view().records.length, 1);
});
test('media-only posts are visible and do not remain in the translation queue', async t => {
    const s = setup(t); s.source.loadPage = async () => ({ records: [{ ...s.post('12345678901'), originalText: '', contentAvailable: true, media: [{ type: 'photo', url: 'https://pbs.twimg.com/example' }] }], cursor: null });
    await s.feed.refresh(); assert.equal(s.feed.view().records.length, 1); assert.equal(s.feed.view().pending, 0);
});

test('missing translation is explicit, context is independent, and manual retry preserves unread', async t => {
    const s = setup(t, { canTranslate: () => true });
    s.source.loadPage = async () => ({ records: [{ ...s.post(12345678901), context: { originalText: 'Context', url: 'https://x.com/example/status/12345678902' } }], cursor: null });
    const active = []; s.feed.onChange = view => active.push(view.translatingId);
    s.source.hydrate = async r => ({ originalText: r.originalText, chineseText: r.originalText === 'Context' ? '上下文' : null });
    await s.feed.refresh();
    const record = s.feed.view().records[0];
    assert.equal(record.translationStatus, 'unavailable'); assert.equal(record.context.chineseText, '上下文');
    assert.ok(active.includes(record.id)); assert.equal(s.feed.view().translatingId, null);
    s.advance(60000); s.source.hydrate = async r => ({ originalText: r.originalText, chineseText: '产品更新' });
    await s.feed.translatePost(record.id);
    assert.equal(s.feed.view().records[0].chineseText, '产品更新'); assert.equal(s.feed.view().records[0].read, record.read);
});

test('translation queue prioritizes the current reader and drains independently of polling', async t => {
    const s = setup(t, { canTranslate: () => true });
    s.source.loadPage = async () => ({ records: Array.from({ length: 7 }, (_, i) => s.post(12345678901 + i)), cursor: null });
    s.source.hydrate = async r => ({ originalText: r.originalText, chineseText: '产品更新' });
    await s.feed.refresh();
    assert.equal(s.feed.view().records.filter(r => r.chineseText).length, 5);
    const remaining = s.feed.translationCandidates(); s.feed.prioritize(remaining[1].id);
    assert.equal(s.feed.translationCandidates()[0].id, remaining[1].id);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    s.feed.stopped = false; s.feed.scheduleTranslation();
    const lastAttempt = s.feed.saved.lastAttemptAt;
    t.mock.timers.tick(30000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.feed.view().records.filter(r => r.chineseText).length, 6);
    assert.equal(s.feed.saved.lastAttemptAt, lastAttempt);
    s.feed.stop(); t.mock.timers.reset();
});

test('rate limit pauses background translation and recent page success is visible before history completes', async t => {
    const s = setup(t, { canTranslate: () => true });
    let calls = 0;
    s.source.loadPage = async ({ cursor }) => ({ records: [s.post(12345678901)], cursor: String(Number(cursor || 0) + 1) });
    s.source.hydrate = async () => { calls++; throw Error('FxTwitter 请求受限，稍后自动重试'); };
    await s.feed.refresh(); assert.ok(s.feed.view().lastReceivedAt); assert.equal(s.feed.view().lastSuccessAt, null);
    s.advance(60000); await s.feed.translatePost('12345678901'); assert.equal(calls, 1);
});
