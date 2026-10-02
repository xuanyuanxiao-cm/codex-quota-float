const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ResetNotices, AUTO_INTERVAL, HOUR } = require('../dist/notices');
const { API_URL } = require('../dist/community-reset');
const { snapshot, url, postText } = require('./notice-fixtures.cjs');

test('refresh, translation and restart use only FxTwitter and reuse cached originals', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-source-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const previousKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = 'unused-test-key';
    t.after(() => { if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY; else process.env.FIRECRAWL_API_KEY = previousKey; });
    let now = Date.parse('2026-10-02T00:00:00Z'), summary = postText;
    const id = '12345678901', publishedAt = now - 1000, calls = [];
    t.mock.method(globalThis, 'fetch', async (address, options) => {
        calls.push(address);
        assert.equal(options.headers.Authorization, undefined);
        if (address === API_URL) return { ok: true, json: async () => snapshot(now, [{ id, time: publishedAt, text: summary }]) };
        assert.equal(address, `https://api.fxtwitter.com/2/status/${id}?lang=zh-CN`);
        return { ok: true, status: 200, json: async () => ({ code: 200, status: { id, url: url(id), author: { screen_name: 'thsottiaux' }, text: postText,
            translation: { target_lang: 'zh-cn', text: '我们将为所有付费用户重置 Codex 使用额度。' } } }) };
    });
    const file = path.join(dir, 'notices.json');
    const service = new ResetNotices(file, { now: () => now }); t.after(() => service.stop());
    service.saved.initialized = true; service.saved.initializedAt = now - HOUR;
    await service.refresh();
    assert.equal(service.view().unread, 1);
    const record = service.saved.records[0];
    assert.equal(record.originalText, postText); assert.equal(record.stage, 'announced');
    service.markRead(id);
    summary = 'Community now reports completion'; now += AUTO_INTERVAL;
    await service.refresh(true);
    assert.equal(calls.filter(address => address !== API_URL).length, 1, 'a changed summary must not refetch a cached original');
    assert.equal(record.stage, 'announced'); assert.equal(record.read, true);
    record.chineseText = null;
    await service.translatePost(id);
    assert.ok(record.chineseText); assert.equal(record.read, true);
    const saved = structuredClone(record);
    const restarted = new ResetNotices(file, { now: () => now }); t.after(() => restarted.stop());
    now += AUTO_INTERVAL; await restarted.refresh();
    assert.equal(calls.filter(address => address !== API_URL).length, 2);
    for (const key of ['originalText', 'chineseText', 'verifiedAt', 'revision', 'read', 'manualReadAt']) assert.equal(restarted.saved.records[0][key], saved[key]);
});

test('a cached timeline post satisfies community discovery without another original request', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-cached-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const now = Date.parse('2026-10-02T00:00:00Z'), id = '12345678901';
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('Cached original should be reused'); });
    const service = new ResetNotices(path.join(dir, 'notices.json'), { now: () => now,
        loadCommunity: async () => snapshot(now, [{ id, time: now - HOUR, text: 'Community summary' }]),
        loadOriginal: async () => { calls++; throw Error('Cached original should be reused'); } });
    t.after(() => service.stop());
    service.importTiboPost({ id, url: url(id), originalText: postText, chineseText: '将重置使用额度。', publishedAt: now - HOUR, eligible: true });
    await service.refresh();
    assert.equal(calls, 0); assert.equal(service.view().unread, 1);
    assert.equal(service.saved.records[0].originalText, postText);
});

for (const failed of [false, true]) test(`a timeline update survives an older pending ${failed ? 'failure' : 'response'}`, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-race-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const now = Date.parse('2026-10-02T00:00:00Z'), id = '12345678901';
    let release;
    const service = new ResetNotices(path.join(dir, 'notices.json'), { now: () => now,
        loadCommunity: async () => snapshot(now, [{ id, time: now - HOUR }]),
        loadOriginal: () => new Promise((resolve, reject) => { release = () => failed ? reject(Error('offline')) : resolve({ originalText: postText }); }) });
    t.after(() => service.stop());
    const pending = service.refresh();
    await new Promise(resolve => setImmediate(resolve));
    service.importTiboPost({ id, url: url(id), originalText: 'The Codex reset is cancelled.', publishedAt: now - HOUR, eligible: true });
    release(); await pending;
    assert.equal(service.saved.records[0].stage, 'cancelled'); assert.equal(service.view().unread, 1);
    assert.equal(service.saved.records[0].verificationStatus, 'verified');
});
