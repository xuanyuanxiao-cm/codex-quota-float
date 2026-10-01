'use strict';
const fs = require('node:fs');
const { createTiboSource, canonicalUrl } = require('./tibo-source');
const { classifyPost } = require('./notice-rules');
const DAY = 86400000, RETENTION = 30 * DAY, INTERVAL = 30 * 60000, MANUAL_INTERVAL = 60000;
class TiboFeed {
    constructor(file, { source = createTiboSource(), now = Date.now, onChange = () => {}, onRelated = () => {} } = {}) {
        this.file = file; this.source = source; this.now = now; this.onChange = onChange; this.onRelated = onRelated;
        this.saved = { version: 1, records: [], initializedAt: null, suppressedBefore: null, lastAttemptAt: null, lastSuccessAt: null, failures: 0, sync: null, coverage: '' };
        try {
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (saved.version !== 1 || !Array.isArray(saved.records)) throw new Error('Invalid feed');
            Object.assign(this.saved, saved);
        } catch (error) { if (error.code !== 'ENOENT') this.storageError = '无法读取动态存档，已保留原文件'; }
        if (this.saved.source !== this.source.source) { this.saved.sync = null; this.saved.lastSuccessAt = null; this.saved.lastAttemptAt = null; this.saved.failures = 0; this.saved.coverage = ''; }
        this.saved.source = this.source.source;
        this.prune(); this.stopped = true; this.loading = false; this.error = null;
    }
    prune() {
        this.saved.records = this.saved.records.filter(r => r && /^\d{10,25}$/.test(r.id) && canonicalUrl(r.url) && typeof r.originalText === 'string' && Number.isFinite(r.publishedAt) && r.publishedAt > this.now() - RETENTION && r.publishedAt <= this.now() + 60000 && (!this.saved.suppressedBefore || r.publishedAt > this.saved.suppressedBefore))
            .sort((a, b) => b.publishedAt - a.publishedAt);
    }
    persist() {
        if (this.storageError?.includes('读取')) return false;
        this.prune();
        try { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.saved)); fs.renameSync(this.file + '.tmp', this.file); this.storageError = null; return true; }
        catch { this.storageError = '无法保存动态；本次修改尚未确认，请检查数据目录'; return false; }
    }
    commit(change) {
        const previous = structuredClone(this.saved); change();
        if (this.persist()) return true;
        this.saved = previous; return false;
    }
    nextCheckAt() { return this.saved.lastAttemptAt == null ? this.now() : this.saved.lastAttemptAt + Math.min(3600000, INTERVAL * 2 ** Math.min(this.saved.failures, 1)); }
    view() {
        this.prune();
        const records = this.saved.records.filter(r => r.originalText || r.contentAvailable);
        return { records: structuredClone(records), unread: records.filter(r => !r.read).length, pending: this.saved.records.length - records.length,
            loading: this.loading, error: this.storageError || this.error, translationError: this.translationError || null, source: this.source.source,
            configured: this.source.configured(), translationConfigured: this.source.canTranslate(), lastSuccessAt: this.saved.lastSuccessAt,
            nextCheckAt: this.nextCheckAt(), manualCheckAt: this.saved.lastAttemptAt == null ? this.now() : this.saved.lastAttemptAt + MANUAL_INTERVAL,
            coverage: this.saved.coverage, incomplete: Boolean(this.saved.sync), bytes: Buffer.byteLength(JSON.stringify(this.saved)) };
    }
    emit() { this.onChange(this.view()); }
    start() { this.stopped = false; this.persist(); this.schedule(); this.cleanupTimer = setInterval(() => { this.persist(); this.emit(); }, 60000); this.cleanupTimer.unref?.(); }
    stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.cleanupTimer); this.abort?.abort(); }
    schedule() {
        clearTimeout(this.timer);
        if (!this.stopped) { this.timer = setTimeout(() => { void this.refresh(); }, Math.max(0, this.nextCheckAt() - this.now())); this.timer.unref?.(); }
    }
    markRead(items) {
        if (Array.isArray(items)) this.commit(() => {
            for (const item of items) {
                const record = this.saved.records.find(r => r.id === item?.id && r.revision === item.revision);
                if (record) record.read = true;
            }
        });
        this.emit(); return this.view();
    }
    clear() {
        this.commit(() => { this.saved.records = []; this.saved.suppressedBefore = this.now(); });
        this.emit(); return this.view();
    }
    async refresh(manual = false) {
        if (this.pending) return this.pending;
        if (this.translating) await this.translating;
        if (this.pending) return this.pending;
        if (this.stopped && this.abort?.signal.aborted) return this.view();
        const dueAt = manual ? this.view().manualCheckAt : this.nextCheckAt();
        if (this.now() < dueAt) return this.view();
        this.pending = this.run().finally(() => { this.pending = null; this.schedule(); });
        return this.pending;
    }
    merge(items) {
        for (const item of items) {
            if (!item || !canonicalUrl(item.url) || !/^\d{10,25}$/.test(item.id) || typeof item.originalText !== 'string' || item.originalText.length > 50000) continue;
            const old = this.saved.records.find(r => r.id === item.id);
            if (old) {
                if (item.originalText && item.originalText !== old.originalText) Object.assign(old, item, { revision: old.revision + 1, chineseText: item.chineseText || null, nextTranslationAt: null });
                else if (item.chineseText) old.chineseText = item.chineseText;
            } else this.saved.records.push({ ...item, revision: 1, eligible: item.publishedAt > this.saved.initializedAt, read: item.publishedAt <= this.saved.initializedAt, chineseText: item.chineseText || null });
        }
        this.prune();
    }
    async run() {
        this.loading = true; this.error = null; this.translationError = null; this.abort = new AbortController();
        const signal = this.abort.signal;
        const start = this.now();
        const resuming = Boolean(this.saved.sync?.cursor);
        if (!this.commit(() => { this.saved.lastAttemptAt = start; this.saved.initializedAt ??= start;
            this.saved.sync ||= { since: Math.max(start - RETENTION, this.saved.lastSuccessAt ? this.saved.lastSuccessAt - DAY : 0), until: start - 1000, cursor: null }; })) {
            this.loading = false; this.emit(); return this.view();
        }
        this.emit();
        try {
            if (!this.source.configured()) throw new Error('尚未配置可用数据源');
            if (resuming) {
                // Check new arrivals even while an older history page is pending.
                const latest = await this.source.loadPage({ since: Math.max(start - RETENTION, this.saved.initializedAt), until: start - 1000, cursor: null, signal });
                signal.throwIfAborted();
                if (!Array.isArray(latest.records)) throw new Error('动态分页无效');
                if (!this.commit(() => this.merge(latest.records))) throw new Error(this.storageError);
                this.publishRelated(); this.emit();
            }
            for (let pageIndex = 0; pageIndex < 10 && this.saved.sync; pageIndex++) {
                const sync = { ...this.saved.sync };
                const page = await this.source.loadPage({ ...sync, signal });
                signal.throwIfAborted();
                if (!Array.isArray(page.records) || page.cursor && page.cursor === sync.cursor) throw new Error('动态分页无效，保留进度后重试');
                if (!this.commit(() => {
                    this.merge(page.records); this.saved.coverage = page.coverage;
                    this.saved.sync = page.cursor ? { ...sync, cursor: page.cursor } : null;
                    if (!page.cursor) { this.saved.lastSuccessAt = sync.until; this.saved.failures = 0; }
                })) throw new Error(this.storageError);
                this.publishRelated();
                this.emit();
            }
            this.publishRelated();
            await this.translate(signal);
            this.publishRelated();
            this.persist();
        } catch (error) {
            if (!signal.aborted) { this.saved.failures++; this.error = error.message?.match(/^(?:FxTwitter |尚未|动态|无法|暂时)/) ? error.message : '动态同步失败，保留本地记录和分页进度，稍后重试'; this.persist(); }
        } finally { this.loading = false; this.emit(); }
        return this.view();
    }
    publishRelated() {
        for (const record of this.saved.records.filter(r => r.originalText && r.type !== 'repost')) {
            record.related = classifyPost(record.originalText).kind !== 'unrelated';
            if (record.related) this.onRelated(record);
        }
    }
    async translatePost(id) {
        while (this.pending || this.translating) await (this.pending || this.translating);
        if (this.stopped && this.abort?.signal.aborted) return this.view();
        const record = this.saved.records.find(r => r.id === id);
        if (!record || record.lastTranslationAttemptAt > this.now() - MANUAL_INTERVAL) return this.view();
        this.abort = new AbortController(); this.translationError = null;
        this.translating = this.translate(this.abort.signal, id).then(() => { this.publishRelated(); this.persist(); this.emit(); return this.view(); })
            .finally(() => { this.translating = null; });
        return this.translating;
    }
    async translate(signal, selectedId) {
        if (!this.source.canTranslate()) return;
        const candidates = this.saved.records.filter(r => selectedId ? r.id === selectedId : (!r.contentAvailable && !r.originalText || r.originalText && !r.chineseText || r.context?.originalText && !r.context.chineseText) && (!r.nextTranslationAt || r.nextTranslationAt <= this.now()))
            .sort((a, b) => Number(a.read) - Number(b.read) || b.publishedAt - a.publishedAt).slice(0, 5);
        for (const item of candidates) {
            try {
                item.lastTranslationAttemptAt = this.now();
                const result = item.chineseText ? { originalText: item.originalText, chineseText: item.chineseText } : await this.source.hydrate(item, { signal }); signal.throwIfAborted();
                const current = this.saved.records.find(r => r.id === item.id && r.revision === item.revision);
                if (!current) continue; // A concurrent cache clear must not resurrect a post.
                if (!this.commit(() => {
                    if (!current.originalText) current.originalText = result.originalText || '';
                    if (current.originalText === result.originalText) current.chineseText = result.chineseText || null;
                    current.nextTranslationAt = this.now() + 6 * 3600000;
                })) throw new Error(this.storageError);
                if (current.context?.originalText && !current.context.chineseText) {
                    const context = await this.source.hydrate(current.context, { signal }); signal.throwIfAborted();
                    this.commit(() => { if (current.context.originalText === context.originalText) current.context.chineseText = context.chineseText || null; });
                }
                this.emit();
            } catch (error) {
                if (signal.aborted) throw error;
                this.translationError = /^(FxTwitter|Firecrawl)/.test(error.message) ? error.message : '部分原帖或翻译暂不可用，将显示原文并稍后重试';
                this.commit(() => { const current = this.saved.records.find(r => r.id === item.id); if (current) current.nextTranslationAt = this.now() + 6 * 3600000; });
                if (/余额|凭据|权限|受限/.test(this.translationError)) break;
            }
        }
    }
}
module.exports = { TiboFeed, INTERVAL, RETENTION };
