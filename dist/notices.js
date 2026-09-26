'use strict';
const fs = require('node:fs');
const { learnSchedule, nextCheckAt } = require('./notice-schedule');
const { estimateResetForecast } = require('./reset-forecast');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const SOURCE = 'https://recodex.lol/timeline';

function postUrl(value) {
    return typeof value === 'string' && /^https:\/\/(?:x\.com|twitter\.com)\/thsottiaux\/status\/\d{10,25}$/.test(value)
        ? value.replace('twitter.com', 'x.com') : null;
}
function plain(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, (s) =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' })[s])
        .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '')
        .replace(/\s+/g, ' ').trim();
}
function classify(text) {
    if (!/\breset|usage limits|rate limits/i.test(text)) return null;
    if (/\b(?:no|not|won't|will not|isn't|is not)\s+(?:\w+\s+){0,3}reset/i.test(text)) return 'hint';
    if (/banked reset/i.test(text)) return 'banked';
    if (/(?:doubl|increas|rais)\w*.{0,50}(?:limits|usage)|(?:limits|usage).{0,30}(?:doubl|increas)/i.test(text) && !/\breset/i.test(text)) return 'limits';
    if (/\b(?:we(?:'|’)ll|we will|we are|we(?:'|’)re|we have|we(?:'|’)ve).{0,65}\breset|reset.{0,35}(?:all paid|all users|everyone|will land|is landing|has landed|propagated)|all reset for everyone/i.test(text)) return 'reset';
    return 'hint';
}
function parseTimeline(html, now = Date.now(), days = 30) {
    if (typeof html !== 'string' || !/Tibo desk/i.test(html)) throw new Error('公告来源结构发生变化');
    const articles = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)];
    if (!articles.length) throw new Error('公告来源暂不可读');
    const records = new Map();
    for (const [article] of articles) {
        const url = postUrl(article.match(/href="(https:\/\/(?:x\.com|twitter\.com)\/thsottiaux\/status\/\d+)"/)?.[1]);
        const publishedAt = Date.parse(article.match(/<time\b[^>]*datetime="([^"]+)"/i)?.[1]);
        const text = plain(article.match(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/i)?.[1] || '').slice(0, 5000);
        const kind = classify(text);
        if (!url || !Number.isFinite(publishedAt) || publishedAt > now + 300000 || publishedAt < now - days * DAY || !kind) continue;
        const id = url.split('/').at(-1);
        records.set(id, { id, url, publishedAt, text, kind, verified: false, read: true });
    }
    return [...records.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 200);
}
// Scope verification to the requested post, excluding replies and quoted thread posts.
function originalPost(html, url) {
    const header = html.split(/<h2[^>]*>Post<\/h2>/i);
    if (header.length !== 2 || !header[0].includes(url) || !/Author:\s*Tibo\s*@thsottiaux/i.test(plain(header[0]))) return null;
    return plain(header[1].split(/<h2\b/i)[0]).slice(0, 5000) || null;
}
async function scrape(url, { fetchImpl = fetch, key = process.env.FIRECRAWL_API_KEY, signal } = {}) {
    if (!key) throw new Error('未配置采集密钥：请设置 FIRECRAWL_API_KEY 后重启应用');
    const response = await fetchImpl('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['html'], onlyMainContent: false, maxAge: 15 * 60000, timeout: 30000 }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`公告采集失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (!data.success || data.data?.metadata?.statusCode >= 400 || typeof data.data?.html !== 'string') throw new Error('公告采集未返回有效页面');
    return data.data.html;
}
class ResetNotices {
    constructor(file, { scrapePage = scrape, now = Date.now, onChange = () => {}, onNotice = () => {} } = {}) {
        this.file = file; this.scrapePage = scrapePage; this.now = now; this.onChange = onChange; this.onNotice = onNotice;
        this.saved = { enabled: true, showProbability: true, initialized: false, lastAttemptAt: null, lastSuccessAt: null, records: [], timings: [] };
        try { Object.assign(this.saved, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {}
        this.saved.records = Array.isArray(this.saved.records) ? this.saved.records.filter(r => r && postUrl(r.url) && r.id === r.url.split('/').at(-1) && typeof r.text === 'string').map(r => ({ ...r, text: r.text.slice(0, 5000) })) : [];
        this.error = null; this.loading = false; this.account = null; this.recoveries = {};
        this.prune();
    }
    prune() {
        this.saved.timings = (Array.isArray(this.saved.timings) ? this.saved.timings : []).filter(r => r && Number.isFinite(r.publishedAt) && r.publishedAt >= this.now() - 90 * DAY && r.publishedAt <= this.now()).slice(-200);
        this.saved.records = this.saved.records.filter(r => Number.isFinite(r.publishedAt) && r.publishedAt >= this.now() - 30 * DAY && r.publishedAt <= this.now() + 300000)
            .sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 200);
    }
    persist() {
        this.prune();
        try { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.saved)); fs.renameSync(this.file + '.tmp', this.file); }
        catch { this.error = '无法保存公告记录，重启后可能重复提醒'; }
    }
    view() {
        this.prune();
        const policy = learnSchedule(this.saved.timings, this.now());
        return { ...this.saved, records: this.saved.records.map(r => ({ ...r })), loading: this.loading, error: this.error,
            policy, nextCheckAt: this.saved.enabled ? nextCheckAt(policy, this.saved.lastAttemptAt, this.now()) : null,
            forecast: estimateResetForecast(this.saved.timings, this.saved.lastSuccessAt, this.now()),
            unread: this.saved.records.filter(r => r.verified && !r.read).length, account: this.account, recoveries: this.recoveries };
    }
    emit() { this.onChange(this.view()); }
    start() {
        this.stopped = false; this.persist(); this.schedule();
    }
    schedule() {
        clearTimeout(this.timer);
        if (this.stopped || !this.saved.enabled) return;
        const delay = Math.max(0, nextCheckAt(learnSchedule(this.saved.timings, this.now()), this.saved.lastAttemptAt, this.now()) - this.now());
        this.timer = setTimeout(() => { void this.refresh(); }, delay); this.timer.unref?.();
    }
    stop() { this.stopped = true; clearTimeout(this.timer); this.abort?.abort(); }
    setEnabled(enabled) {
        this.saved.enabled = enabled; this.persist();
        if (!enabled) this.abort?.abort();
        this.schedule(); this.emit(); return this.view();
    }
    markRead() { for (const r of this.saved.records) r.read = true; this.persist(); this.emit(); return this.view(); }
    setShowProbability(show) { this.saved.showProbability = show; this.persist(); this.emit(); return this.view(); }
    updateAccount(state) {
        if (state.status !== 'ready') { this.account = this.account ? { ...this.account, stale: true } : null; this.emit(); return; }
        const next = { planType: state.planType ?? null, hasFiveHour: state.hasFiveHour ?? null, fiveHour: state.fiveHour?.remainingPercent ?? null, weekly: state.weekly?.remainingPercent ?? null, updatedAt: state.lastUpdatedAt, stale: false };
        for (const key of ['fiveHour', 'weekly']) {
            const before = this.account?.[key], after = next[key];
            if (Number.isFinite(before) && Number.isFinite(after) && after > before && (before === 0 || after === 100)) {
                this.recoveries[key] = { at: this.now(), remaining: after };
            }
        }
        this.account = next; this.emit();
    }
    async refresh(manual = false) {
        if (this.pending) return this.pending;
        if (this.stopped || !this.saved.enabled) return this.view();
        const gap = this.now() - (this.saved.lastAttemptAt || 0);
        if (manual ? gap >= 0 && gap < 60000 : nextCheckAt(learnSchedule(this.saved.timings, this.now()), this.saved.lastAttemptAt, this.now()) > this.now()) { this.schedule(); return this.view(); }
        this.pending = this.check().finally(() => { this.pending = null; this.schedule(); });
        return this.pending;
    }
    async check() {
        const baseline = !this.saved.initialized;
        this.loading = true; this.error = null; this.saved.lastAttemptAt = this.now(); this.persist(); this.emit();
        this.abort = new AbortController();
        try {
            const html = await this.scrapePage(SOURCE, { signal: this.abort.signal });
            const incoming = parseTimeline(html, this.now());
            if (this.stopped || !this.saved.enabled) return this.view();
            const timings = new Map(this.saved.timings.map(r => [r.id, r]));
            for (const r of parseTimeline(html, this.now(), 90)) timings.set(r.id, { id: r.id, publishedAt: r.publishedAt, kind: r.kind });
            this.saved.timings = [...timings.values()].sort((a, b) => a.publishedAt - b.publishedAt).slice(-200);
            const records = new Map(this.saved.records.map(r => [r.id, r]));
            const initializedAt = this.saved.initializedAt || this.saved.lastSuccessAt || this.now();
            for (const r of incoming) {
                if (!records.has(r.id)) records.set(r.id, { ...r, eligible: !baseline && r.publishedAt > initializedAt, read: true });
            }
            this.saved.records = [...records.values()]; this.prune();
            // Bound verification requests; hints and old history never cause a request storm.
            const candidates = this.saved.records.filter(r => !r.verified && (r.verificationAttempts || 0) < 3 && r.kind !== 'hint' && r.publishedAt >= this.now() - 3 * DAY).slice(0, 2);
            for (const record of candidates) {
                try {
                    record.verificationAttempts = (record.verificationAttempts || 0) + 1;
                    const html = await this.scrapePage(record.url, { signal: this.abort.signal });
                    if (this.stopped || !this.saved.enabled) break;
                    const text = originalPost(html, record.url);
                    const kind = text && classify(text);
                    if (!kind || kind === 'hint') continue;
                    record.verified = true; record.text = text; record.kind = kind;
                    record.read = !record.eligible;
                    if (record.eligible && !record.notified) {
                        record.notified = true; this.onNotice(record);
                    }
                } catch { /* Unverified third-party records remain explicitly labelled. */ }
            }
            if (this.stopped || !this.saved.enabled) return this.view();
            this.saved.initialized = true; this.saved.initializedAt = initializedAt; this.saved.lastSuccessAt = this.now();
        } catch (error) {
            if (!this.stopped && this.saved.enabled) this.error = error.message?.startsWith('公告') || error.message?.startsWith('未配置') ? error.message : '公告更新失败，请稍后重试';
        } finally { this.loading = false; this.persist(); this.emit(); }
        return this.view();
    }
}
module.exports = { ResetNotices, parseTimeline, originalPost, classify, scrape, postUrl, SOURCE, HOUR, DAY };
