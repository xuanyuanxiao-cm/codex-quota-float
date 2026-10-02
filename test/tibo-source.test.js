const test = require('node:test');
const assert = require('node:assert/strict');
const { createTiboSource, canonicalUrl } = require('../dist/tibo-source');
const now = Date.parse('2026-10-02T00:00:00Z');
const post = (id, author = 'thsottiaux', extra = {}) => ({ type: 'status', id, url: `https://x.com/${author}/status/${id}`, author: { screen_name: author }, text: 'Example', created_timestamp: now / 1000, ...extra });
const response = data => ({ ok: true, status: 200, json: async () => data });
test('Fx timeline filters reply parents, preserves quotes/reposts, and follows paging', async () => {
    const parent = post('12345678901', 'another'); const calls = [];
    const records = [parent, post('12345678902', 'thsottiaux', { replying_to: { status: parent.id } }), post('12345678903', 'another', { reposted_by: { screen_name: 'thsottiaux' } }), post('12345678904', 'thsottiaux', { quote: parent }), post('12345678905', 'thsottiaux', { created_timestamp: (now - 90 * 86400000) / 1000 })];
    const source = createTiboSource({ fetchImpl: async (url, opts) => { calls.push([url, opts]); return response({ code: 200, results: records, cursor: { bottom: 'next' } }); } });
    const page = await source.loadPage({ since: now - 30 * 86400000, cursor: 'first' });
    assert.deepEqual(page.records.map(r => r.type), ['reply', 'repost', 'quote']); assert.equal(page.records[0].context.originalText, 'Example');
    assert.equal(page.cursor, 'next'); assert.match(calls[0][0], /with_replies=true/); assert.match(calls[0][0], /cursor=first/);
    assert.equal(calls[0][1].headers.Authorization, undefined);
});
test('Chinese translation is accepted only for the requested post and target language', async () => {
    let status = post('12345678901', 'thsottiaux', { translation: { text: '中文', target_lang: 'zh-cn' } });
    const source = createTiboSource({ fetchImpl: async () => response({ code: 200, status }) });
    const record = { url: status.url, originalText: status.text };
    assert.equal((await source.hydrate(record)).chineseText, '中文');
    status.translation.target_lang = 'fr'; assert.equal((await source.hydrate(record)).chineseText, null);
    status.id = '12345678902'; await assert.rejects(() => source.hydrate(record), /身份/);
    status.id = '12345678901'; status.author.screen_name = 'another';
    await assert.rejects(() => source.hydrate(record), /身份/);
    status.author.screen_name = 'thsottiaux'; status.url = 'https://x.com/another/status/12345678901';
    await assert.rejects(() => source.hydrate(record), /身份/);
    status.url = record.url;
    await assert.rejects(() => source.hydrate({ ...record, id: '12345678902' }), /身份/);
});
test('HTTP and embedded upstream failures are not empty successful timelines', async () => {
    const fail = createTiboSource({ fetchImpl: async () => ({ ok: false, status: 429 }) });
    await assert.rejects(() => fail.loadPage({ since: now }), /受限/);
    const embedded = createTiboSource({ fetchImpl: async () => response({ code: 500, results: [], cursor: {} }) });
    await assert.rejects(() => embedded.loadPage({ since: now }), /未返回/);
    assert.equal(canonicalUrl('https://x.com.evil.example/thsottiaux/status/12345678901'), null);
    assert.equal(canonicalUrl('javascript:alert(1)'), null);
});
