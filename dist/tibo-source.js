'use strict';
const HANDLE = 'thsottiaux';
function canonicalUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && ['x.com', 'twitter.com', 'www.x.com'].includes(url.hostname) && /^\/[A-Za-z0-9_]{1,15}\/status\/\d{10,25}$/.test(url.pathname)
            ? `https://x.com${url.pathname}` : null;
    } catch { return null; }
}
function chinese(post) {
    if (post.lang?.startsWith('zh')) return post.text;
    const value = post.translation;
    return value?.target_lang?.toLowerCase().startsWith('zh') && typeof value.text === 'string' && value.text.length <= 50000 ? value.text : null;
}
function normalizePost(post, contextPosts) {
    const url = canonicalUrl(post.url);
    if (post.type !== 'status' || !url || url.split('/').at(-1) !== post.id || url.split('/')[3].toLowerCase() !== post.author?.screen_name?.toLowerCase() || typeof post.text !== 'string' || post.text.length > 50000) return null;
    const repost = post.reposted_by?.screen_name?.toLowerCase() === HANDLE;
    if (!repost && post.author?.screen_name?.toLowerCase() !== HANDLE) return null;
    const linked = post.quote || contextPosts.get(post.replying_to?.status);
    const context = linked?.type === 'status' && typeof linked.text === 'string' && canonicalUrl(linked.url)
        ? { author: linked.author?.screen_name || '', url: canonicalUrl(linked.url), originalText: linked.text, chineseText: chinese(linked) } : null;
    return { id: post.id, url, author: post.author?.screen_name || '', originalText: post.text, contentAvailable: true, chineseText: chinese(post), lang: post.lang,
        publishedAt: Number(post.created_timestamp) * 1000, type: repost ? 'repost' : post.replying_to ? 'reply' : post.quote ? 'quote' : 'post',
        context, contextMissing: Boolean((post.replying_to || post.quote) && !context),
        media: (post.media?.all || []).map(m => ({ type: m.type, url: m.url || m.thumbnail_url })).filter(m => typeof m.url === 'string' && m.url.startsWith('https://')) };
}
function createTiboSource({ fetchImpl = fetch } = {}) {
    async function request(path, signal) {
        const timeout = AbortSignal.timeout(30000);
        const response = await fetchImpl(`https://api.fxtwitter.com/2/${path}`, {
            headers: { 'User-Agent': 'CodexQuotaFloat/0.1.20 (personal timeline reader)', Accept: 'application/json' },
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (response.status === 204) return { code: 200, results: [], cursor: {} };
        if (!response.ok) throw new Error(response.status === 429 ? 'FxTwitter 请求受限，稍后自动重试' : `FxTwitter 请求失败（HTTP ${response.status}）`);
        const data = await response.json();
        if (data.code !== 200) throw new Error(`FxTwitter 未返回可用数据（${data.code || '未知状态'}）`);
        return data;
    }
    async function loadPage({ since, cursor, signal }) {
        const params = new URLSearchParams({ count: '100', with_replies: 'true' });
        if (cursor) params.set('cursor', cursor);
        const page = await request(`profile/${HANDLE}/statuses?${params}`, signal);
        if (!Array.isArray(page.results) || !page.cursor) throw new Error('动态接口格式已变化，保留本地内容');
        const contextPosts = new Map(page.results.map(p => [p.id, p]));
        const records = page.results.map(p => normalizePost(p, contextPosts)).filter(Boolean);
        // An old pinned post or a reply's parent must not end paging prematurely.
        const reachedBoundary = records.length > 0 && records.every(r => r.publishedAt < since);
        return { records: records.filter(r => r.publishedAt >= since), cursor: !page.results.length || reachedBoundary ? null : page.cursor.bottom || null,
            coverage: '来源：FxTwitter 公共接口（非 X 官方）。包含可获取的原帖、回复、引用和转推；转推按原帖发布时间保留，删除或不可见内容可能缺失。' };
    }
    async function hydrate(record, { signal } = {}) {
        const url = canonicalUrl(record.url);
        if (!url) throw new Error('原帖地址无效');
        const id = url.split('/').at(-1);
        const data = await request(`status/${id}?lang=zh-CN`, signal);
        if (data.status?.id !== id || canonicalUrl(data.status?.url) !== url || typeof data.status?.text !== 'string') throw new Error('原帖身份未匹配，稍后重试');
        return { originalText: data.status.text, chineseText: chinese(data.status) };
    }
    return { source: 'fxtwitter', configured: () => true, canTranslate: () => true, loadPage, hydrate };
}
module.exports = { createTiboSource, canonicalUrl, normalizePost };
