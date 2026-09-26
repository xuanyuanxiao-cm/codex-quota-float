'use strict';
const fs = require('node:fs');
const { fetchCommunity, parseCommunity, postUrl, INTERVAL, MAX_AGE } = require('./community-reset');
const HOUR = 3600000;
const DAY = 24 * HOUR;
function plain(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, s =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' })[s])
        .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '')
        .replace(/\s+/g, ' ').trim();
}
function classifyPost(value) {
    const text = value.replace(/’/g, "'");
    const hint = { kind: 'hint', stage: 'hint' };
    if (!/\breset|usage limits|rate limits/i.test(text)) return hint;
    // Policies, questions, conditions and negations are not affirmative announcements.
    if (/\?|\b(?:if|unless|might|maybe|could|would|not|never|won't|isn't|aren't|cannot|can't|usually|typically)\b|\b(?:we can|how to|every (?:day|week|month))\b|\bno\s+(?:\w+\s+){0,3}resets?\b/i.test(text)) return hint;
    const banked = /\bbanked resets?\b/i.test(text);
    if (!/\bcodex\b|\bchatgpt\b/i.test(text) && !banked) return hint;
    if (banked) {
        if (!/\b(?:we(?:'ll|'ve|'re| will| have| are)?|everyone|all (?:paid )?users|paid users)\b/i.test(text)) return hint;
        if (!/\b(?:give|giving|given|gave|grant\w*|send|sending|sent|add\w*|issu\w*|distribut\w*|receiv\w*)\b.{0,65}\bbanked resets?\b|\bbanked resets?\b.{0,65}\b(?:sent|added|granted|distributed|issued)\b/i.test(text)) return hint;
        return { kind: 'banked', stage: /\b(?:will|we'll|going to|giving|sending|issuing|distributing)\b/i.test(text) ? 'announced' : 'completed' };
    }
    if (!/\breset/i.test(text) && /\bwe\b/i.test(text) && /(?:doubl|increas|rais)\w*.{0,50}(?:limits|usage)|(?:limits|usage).{0,30}(?:doubl|increas)/i.test(text)) return { kind: 'limits', stage: 'announced' };
    if (!/\b(?:usage|rate) limits\b|\bquota\b/i.test(text)) return hint;
    if (/\bwe(?:'ll| will| are| have|'re|'ve)?\b.{0,65}\breset\w*.{0,40}(?:(?:usage|rate) limits|quota)|(?:limits|quota).{0,40}\b(?:have been|has been|were|was|are) reset\b/i.test(text)) {
        return { kind: 'reset', stage: /\b(?:will|we'll|going to|resetting)\b/i.test(text) ? 'announced' : 'completed' };
    }
    return hint;
}
function classify(text) { return classifyPost(text).kind; }
function originalPost(html, url) {
    const header = html.split(/<h2[^>]*>Post<\/h2>/i);
    if (header.length !== 2 || !new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9])').test(header[0]) || !/Author:\s*Tibo\s*@thsottiaux/i.test(plain(header[0]))) return null;
    return plain(header[1].split(/<h2\b/i)[0]).slice(0, 5000) || null;
}
async function scrape(url, { fetchImpl = fetch, key = process.env.FIRECRAWL_API_KEY, signal } = {}) {
    if (!key) throw new Error('未配置原帖核验密钥');
    const response = await fetchImpl('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['html'], onlyMainContent: false, maxAge: 15 * 60000, timeout: 30000 }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`原帖核验请求失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (!data.success || data.data?.metadata?.statusCode >= 400 || typeof data.data?.html !== 'string') throw new Error('原帖采集未返回有效页面');
    return data.data.html;
}
class ResetNotices {
    constructor(file, { loadCommunity = fetchCommunity, scrapePage = scrape, canVerify = () => Boolean(process.env.FIRECRAWL_API_KEY), now = Date.now, onChange = () => {}, onNotice = () => {} } = {}) {
        this.file = file; this.loadCommunity = loadCommunity; this.scrapePage = scrapePage; this.canVerify = canVerify;
        this.now = now; this.onChange = onChange; this.onNotice = onNotice;
        this.saved = { version: 2, enabled: true, showProbability: true, initialized: false, lastAttemptAt: null, lastSuccessAt: null, records: [], community: null };
        try {
            const old = JSON.parse(fs.readFileSync(file, 'utf8'));
            for (const key of ['enabled', 'showProbability']) if (typeof old[key] === 'boolean') this.saved[key] = old[key];
            if (old.version === 2) Object.assign(this.saved, old);
            else this.saved.records = (Array.isArray(old.records) ? old.records : []).map(r => ({ ...r, verified: false, read: true, kind: 'hint', stage: 'hint', source: 'legacy', verificationAttempts: 0 }));
        } catch {}
        this.saved.records = (Array.isArray(this.saved.records) ? this.saved.records : []).filter(r => r && postUrl(r.url) && r.id === r.url.split('/').at(-1) && typeof r.text === 'string').map(r => ({ ...r, text: r.text.slice(0, 5000) }));
        this.error = this.saved.failures > 0 ? '社区上次更新失败，请稍后重试' : null;
        this.loading = false; this.account = null; this.recoveries = {}; this.cardArrival = null;
        this.prune();
    }
    prune() {
        this.saved.records = this.saved.records.filter(r => Number.isFinite(r.publishedAt) && r.publishedAt >= this.now() - 30 * DAY && r.publishedAt <= this.now() + 60000)
            .sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 200);
    }
    persist() {
        this.prune();
        try { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.saved)); fs.renameSync(this.file + '.tmp', this.file); }
        catch { this.error = '无法保存公告记录，重启后可能重复提醒'; }
    }
    nextCheckAt() {
        const interval = Math.min(HOUR, INTERVAL * 2 ** Math.min(this.saved.failures || 0, 3));
        return this.saved.lastAttemptAt ? Math.min(this.saved.lastAttemptAt, this.now()) + interval : this.now();
    }
    view() {
        this.prune();
        const c = this.saved.community;
        const record = this.saved.records.find(r => r.id === c?.active?.id);
        const activeNotice = record && record.verificationStatus !== 'rejected' && (!record.verified || record.kind === c.active.kind)
            ? { ...c.active, verified: record.verified && record.stage === c.active.stage } : null;
        return { ...this.saved, records: this.saved.records.map(r => ({ ...r })), loading: this.loading, error: this.error,
            nextCheckAt: this.saved.enabled ? this.nextCheckAt() : null, verificationEnabled: this.canVerify(),
            forecast: c ? { asOf: c.asOf, percent: c.percent, healthy: c.healthy } : null, activeNotice,
            unread: this.saved.records.filter(r => r.verified && !r.read).length, account: this.account, recoveries: this.recoveries, cardArrival: this.cardArrival };
    }
    emit() { this.onChange(this.view()); }
    start() { this.stopped = false; this.persist(); this.schedule(); }
    schedule() {
        clearTimeout(this.timer);
        if (this.stopped || !this.saved.enabled) return;
        this.timer = setTimeout(() => { void this.refresh(); }, Math.max(0, this.nextCheckAt() - this.now())); this.timer.unref?.();
    }
    stop() { this.stopped = true; clearTimeout(this.timer); this.abort?.abort(); }
    setEnabled(enabled) {
        this.saved.enabled = enabled; this.persist();
        if (!enabled) this.abort?.abort();
        this.schedule(); this.emit(); return this.view();
    }
    markRead(id) {
        const record = this.saved.records.find(r => r.id === id);
        if (record) record.read = true;
        this.persist(); this.emit(); return this.view();
    }
    setShowProbability(show) { this.saved.showProbability = show; this.persist(); this.emit(); return this.view(); }
    updateAccount(state) {
        if (state.status !== 'ready') { this.account = this.account ? { ...this.account, stale: true } : null; this.emit(); return; }
        const available = state.resetCredits?.credits?.filter(c => c.status === 'available' && (!Number.isFinite(c.expiresAt) || (c.expiresAt < 1e11 ? c.expiresAt * 1000 : c.expiresAt) > this.now()));
        const next = { planType: state.planType ?? null, hasFiveHour: state.hasFiveHour ?? null, fiveHour: state.fiveHour?.remainingPercent ?? null, weekly: state.weekly?.remainingPercent ?? null,
            creditIds: available ? available.map(c => c.id) : null, credits: available ? available.length : null, updatedAt: state.lastUpdatedAt, stale: false };
        if (this.account?.planType !== next.planType) { this.recoveries = {}; this.cardArrival = null; }
        else {
            for (const key of ['fiveHour', 'weekly']) {
                const before = this.account?.[key], after = next[key];
                if (Number.isFinite(before) && Number.isFinite(after) && after > before && (before === 0 || after === 100)) this.recoveries[key] = { at: this.now(), remaining: after };
            }
            if (this.account?.creditIds && next.creditIds) {
                const added = next.creditIds.filter(id => !this.account.creditIds.includes(id));
                if (added.length) this.cardArrival = { at: this.now(), count: added.length };
            }
        }
        this.account = next; this.emit();
    }
    async refresh(manual = false) {
        if (this.pending) return this.pending;
        if (this.stopped || !this.saved.enabled) return this.view();
        // The upstream snapshot changes at most every ten minutes, including manual checks.
        if ((this.saved.lastAttemptAt && this.now() - this.saved.lastAttemptAt < INTERVAL) || (!manual && this.nextCheckAt() > this.now())) { this.schedule(); return this.view(); }
        this.pending = this.check().finally(() => { this.pending = null; this.schedule(); });
        return this.pending;
    }
    async check() {
        const baseline = !this.saved.initialized;
        this.loading = true; this.error = null; this.saved.lastAttemptAt = this.now(); this.persist(); this.emit();
        this.abort = new AbortController();
        try {
            const snapshot = parseCommunity(await this.loadCommunity({ signal: this.abort.signal }), this.now());
            if (this.stopped || !this.saved.enabled || this.abort.signal.aborted) return this.view();
            this.saved.community = { asOf: snapshot.asOf, percent: snapshot.percent, healthy: snapshot.healthy, active: snapshot.active };
            this.saved.failures = 0; this.saved.lastSuccessAt = this.now();
            const fresh = snapshot.healthy && this.now() - snapshot.asOf <= MAX_AGE;
            const initializedAt = this.saved.initializedAt || this.now();
            for (const item of snapshot.records) {
                const existing = this.saved.records.find(r => r.id === item.id);
                if (!existing) this.saved.records.push({ ...item, eligible: !baseline && item.publishedAt > initializedAt, read: true });
                else if (existing.text !== item.text) Object.assign(existing, item, { originalText: null, read: true, verificationAttempts: 0, verificationStatus: null, nextVerificationAt: null });
                else if (!existing.verified && existing.verificationStatus !== 'rejected') { existing.kind = item.kind; existing.stage = item.stage; existing.source = 'community'; }
            }
            this.prune();
            if (fresh) {
                this.saved.initialized = true; this.saved.initializedAt = initializedAt;
                if (this.canVerify()) await this.verifyCandidates();
            }
        } catch (error) {
            if (!this.stopped && this.saved.enabled) {
                this.saved.failures = (this.saved.failures || 0) + 1;
                this.error = error.message?.startsWith('社区') ? error.message : '社区更新失败，请稍后重试';
            }
        } finally { this.loading = false; this.persist(); this.emit(); }
        return this.view();
    }
    async verifyCandidates() {
        const candidates = this.saved.records.filter(r => !r.verified && r.source === 'community' && r.verificationStatus !== 'rejected' && (r.verificationAttempts || 0) < 3 &&
            (!r.nextVerificationAt || r.nextVerificationAt <= this.now()) && r.publishedAt >= this.now() - 3 * DAY).slice(0, 2);
        for (const record of candidates) {
            try {
                const html = await this.scrapePage(record.url, { signal: this.abort.signal });
                if (this.stopped || !this.saved.enabled || this.abort.signal.aborted) break;
                const text = originalPost(html, record.url);
                if (!text) {
                    record.verificationAttempts = (record.verificationAttempts || 0) + 1;
                    record.verificationStatus = 'unreadable'; record.nextVerificationAt = this.now() + 6 * HOUR; continue;
                }
                const result = classifyPost(text);
                Object.assign(record, result, { originalText: text, verifiedAt: this.now(), verificationFailures: 0 });
                if (result.kind === 'hint') { record.verificationStatus = 'rejected'; record.read = true; continue; }
                record.verified = true; record.verificationStatus = 'verified'; record.read = !record.eligible;
                if (record.eligible && !record.notified) { record.notified = true; this.persist(); this.onNotice(record); }
            } catch {
                if (this.stopped || !this.saved.enabled) break;
                record.verificationFailures = (record.verificationFailures || 0) + 1;
                record.verificationStatus = 'network-error';
                record.nextVerificationAt = this.now() + Math.min(6 * HOUR, INTERVAL * 2 ** Math.min(record.verificationFailures, 6));
            }
        }
    }
}
module.exports = { ResetNotices, originalPost, classify, classifyPost, scrape, postUrl, HOUR, DAY };
