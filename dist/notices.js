'use strict';
const fs = require('node:fs');
const { createTiboSource } = require('./tibo-source');
const { classifyPost, messagePriority, explicitDeadline } = require('./notice-rules');
const { recordForecast, forecastSummary } = require('./forecast-journal');
const { createHash } = require('node:crypto');
const { fetchCommunity, parseCommunity, postUrl, INTERVAL, MAX_AGE } = require('./community-reset');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const AUTO_INTERVAL = 30 * 60000;
function classify(text) { return classifyPost(text).kind; }
function saveTranslation(record, translation, text, now) {
    const normalize = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const chinese = translation?.chineseText;
    record.translationAttempts = (record.translationAttempts || 0) + 1;
    record.nextTranslationAt = now + 6 * HOUR;
    if (typeof translation?.originalText === 'string' && normalize(translation.originalText) === normalize(text) &&
        typeof chinese === 'string' && chinese.length <= 10000 && /[\u3400-\u9fff]/.test(chinese)) {
        record.chineseText = chinese.trim(); record.translationOriginalText = text;
    }
}
class ResetNotices {
    constructor(file, { loadCommunity = fetchCommunity, loadOriginal = createTiboSource().hydrate, translateOriginal = loadOriginal, now = Date.now, onChange = () => {}, onNotice = () => {} } = {}) {
        this.file = file; this.loadCommunity = loadCommunity; this.loadOriginal = loadOriginal;
        this.now = now; this.onChange = onChange; this.onNotice = onNotice;
        this.translateOriginal = translateOriginal;
        // Keep legacy verified fields for archive compatibility; they indicate original retrieval only.
        this.saved = { version: 3, enabled: true, showProbability: true, initialized: false, lastAttemptAt: null, lastSuccessAt: null, records: [], community: null, accountBaselines: {}, forecasts: [] };
        try {
            const old = JSON.parse(fs.readFileSync(file, 'utf8'));
            for (const key of ['enabled', 'showProbability']) if (typeof old[key] === 'boolean') this.saved[key] = old[key];
            if (old.version >= 2) Object.assign(this.saved, old);
            else { this.saved.version = 1; this.saved.records = (Array.isArray(old.records) ? old.records : []).map(r => ({ ...r, verified: false, read: true, kind: 'hint', stage: 'hint', source: 'legacy', verificationAttempts: 0 })); }
        } catch (error) { if (error.code !== 'ENOENT') this.migrationError = '无法读取公告存档，已保留原文件；请检查数据目录'; }
        this.saved.records = (Array.isArray(this.saved.records) ? this.saved.records : []).filter(r => r && (r.kind === 'arrival' || postUrl(r.url) && r.id === r.url.split('/').at(-1)) && typeof r.text === 'string').map(r => ({ ...r, revision: r.revision || 1, text: r.text.slice(0, 5000) }));
        if (this.saved.version !== 3) {
            try { fs.copyFileSync(file, file + '.pre-v3.bak', fs.constants.COPYFILE_EXCL); } catch (error) { if (error.code !== 'EEXIST') this.migrationError = '升级前备份失败，请检查数据目录'; }
            for (const r of this.saved.records) {
                // Rejected originals were authenticated by the old extractor, only their classification failed.
                if (r.originalText && r.verifiedAt) {
                    Object.assign(r, classifyPost(r.originalText), { verified: true, verificationStatus: 'verified' });
                    r.deadlineAt = r.deadlineAt || explicitDeadline(r.originalText);
                    if (r.id === '2103963215885701493' && r.eligible && !r.manualReadAt && r.kind === 'reset') { r.read = false; r.processingReason = '修复 9 月 27 日已知漏报'; }
                } else if (r.source === 'legacy') Object.assign(r, classifyPost(r.text));
                if (r.kind === 'unrelated') r.read = true;
            }
            this.saved.version = 3;
        }
        this.error = this.saved.failures > 0 ? '社区上次更新失败，请稍后重试' : null;
        this.loading = false; this.account = null; this.recoveries = {}; this.cardArrival = null;
        this.featureEnabled = true;
        this.prune();
        if (this.migrationError) this.error = this.migrationError;
    }
    prune() {
        this.saved.records = this.saved.records.filter(r => Number.isFinite(r.publishedAt) && r.publishedAt <= this.now() + 60000)
            .sort((a, b) => b.publishedAt - a.publishedAt);
    }
    persist() {
        this.prune();
        if (this.migrationError) { this.error = this.migrationError; return false; }
        try {
            fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.saved)); fs.renameSync(this.file + '.tmp', this.file);
            if (this.error === this.storageError) this.error = null;
            this.storageError = null; return true;
        } catch (error) {
            this.storageError = `无法保存消息记录（${error.code || '写入失败'}），请重试；未读标记未确认`;
            this.error = this.storageError; return false;
        }
    }
    nextCheckAt() {
        const interval = Math.min(HOUR, AUTO_INTERVAL * 2 ** Math.min(this.saved.failures || 0, 3));
        const at = this.saved.failures ? this.saved.lastAttemptAt : this.saved.lastSuccessAt || this.saved.lastAttemptAt;
        return at ? Math.min(at, this.now()) + interval : this.now();
    }
    manualCheckAt() {
        const at = this.saved.failures ? this.saved.lastFailureAt || this.saved.lastAttemptAt : this.saved.lastSuccessAt || this.saved.lastAttemptAt;
        return at ? Math.min(at, this.now()) + (this.saved.failures ? 30000 : INTERVAL) : this.now();
    }
    view() {
        this.prune();
        const c = this.saved.community;
        const records = this.saved.records;
        const record = records.find(r => r.id === c?.active?.id);
        const activeNotice = record && record.kind !== 'unrelated' && record.verificationStatus !== 'rejected' && (!record.verified || record.kind === c.active.kind && ['announced', 'completed'].includes(record.stage))
            ? { ...c.active, verified: record.verified && record.stage === c.active.stage } : null;
        const { accountBaselines, forecasts, ...publicState } = this.saved;
        return { ...publicState, forecastHistory: forecastSummary(this.saved), records: records.filter(r => r.kind !== 'unrelated').map(r => ({ ...r })).sort((a, b) => Number(a.read !== false) - Number(b.read !== false) || messagePriority(a) - messagePriority(b) || b.publishedAt - a.publishedAt), loading: this.loading, error: this.error,
            nextCheckAt: this.saved.enabled ? this.nextCheckAt() : null, manualCheckAt: this.manualCheckAt(),
            translationEnabled: Boolean(this.translateOriginal), translatingId: this.translatingId || null,
            forecast: c ? { asOf: c.asOf, percent: c.percent, healthy: c.healthy } : null, activeNotice,
            unread: this.saved.records.filter(r => r.verified && r.kind !== 'unrelated' && r.read === false).length, account: this.account, recoveries: this.recoveries, cardArrival: this.cardArrival };
    }
    emit() { this.onChange(this.view()); }
    setFeatureEnabled(enabled) {
        if (this.featureEnabled !== enabled) { this.abort?.abort(); this.translationAbort?.abort(); }
        this.featureEnabled = enabled;
        if (!enabled && !this.saved.recordingPaused) { this.saved.recordingPaused = true; this.persist(); }
        if (enabled && this.saved.recordingPaused) {
            this.saved.recordingPaused = false; this.saved.silentBefore = this.now(); this.saved.accountBaselineNext = true;
            this.saved.lastAttemptAt = null; this.saved.lastSuccessAt = null; this.persist();
        }
        this.schedule(); this.emit();
    }
    start() { this.stopped = false; if (this.featureEnabled) this.persist(); this.schedule(); }
    schedule() {
        clearTimeout(this.timer);
        if (this.stopped || !this.saved.enabled || !this.featureEnabled) return;
        this.timer = setTimeout(() => { void this.refresh(); }, Math.max(0, this.nextCheckAt() - this.now())); this.timer.unref?.();
    }
    stop() { this.stopped = true; clearTimeout(this.timer); this.abort?.abort(); this.translationAbort?.abort(); }
    async translatePost(id) {
        if (!this.featureEnabled) return this.view();
        if (this.translationPending) return this.translationPending;
        const record = this.saved.records.find(r => r.id === id);
        if (!this.translateOriginal || !record?.verified || !record.originalText || !postUrl(record.url) || record.lastTranslationAttemptAt > this.now() - 60000) return this.view();
        const original = record.originalText, revision = record.revision;
        this.translationAbort = new AbortController(); this.translatingId = id;
        record.lastTranslationAttemptAt = this.now(); this.emit();
        this.translationPending = (async () => {
            try {
                const result = record.chineseText && record.translationOriginalText === original
                    ? { originalText: original, chineseText: record.chineseText }
                    : await this.translateOriginal(record, { signal: this.translationAbort.signal });
                this.translationAbort.signal.throwIfAborted();
                const current = this.saved.records.find(r => r.id === id && r.originalText === original && r.revision === revision);
                if (current) {
                    saveTranslation(current, result, original, this.now()); current.translationStatus = current.chineseText && current.translationOriginalText === original ? 'done' : 'unavailable';
                    if (current.context?.originalText && !current.context.chineseText) {
                        const contextText = current.context.originalText;
                        const context = await this.translateOriginal(current.context, { signal: this.translationAbort.signal });
                        this.translationAbort.signal.throwIfAborted();
                        if (current.context?.originalText === contextText && context.originalText === contextText && typeof context.chineseText === 'string') current.context.chineseText = context.chineseText;
                    }
                }
            } catch { if (!this.translationAbort.signal.aborted) record.translationStatus = 'unavailable'; }
            finally { this.translatingId = null; this.translationPending = null; if (!this.translationAbort.signal.aborted) this.persist(); this.emit(); }
            return this.view();
        })();
        return this.translationPending;
    }
    setEnabled(enabled) {
        this.saved.enabled = enabled; this.persist();
        if (!enabled && !this.manual) this.abort?.abort();
        this.schedule(); this.emit(); return this.view();
    }
    markRead(id) {
        const record = this.saved.records.find(r => r.id === id);
        return this.markReadBatch(record ? [{ id, revision: record.revision || 1 }] : []);
    }
    markReadBatch(items) {
        if (!Array.isArray(items)) return this.view();
        const changes = [];
        for (const item of items) {
            const record = this.saved.records.find(r => r.id === item?.id);
            if (record && (record.revision || 1) === item.revision) {
                changes.push({ record, read: record.read, manualReadAt: record.manualReadAt });
                record.read = true; record.manualReadAt = this.now();
            }
        }
        if (!this.persist()) for (const change of changes.reverse()) { change.record.read = change.read; change.record.manualReadAt = change.manualReadAt; }
        this.emit(); return this.view();
    }
    setShowProbability(show) { this.saved.showProbability = show; this.persist(); this.emit(); return this.view(); }
    importArchive(seed) {
        let added = 0;
        for (const item of seed?.records || []) {
            if (!postUrl(item.url) || item.id !== item.url.split('/').at(-1) || !Number.isFinite(item.publishedAt) || item.publishedAt > this.now() || typeof item.text !== 'string') continue;
            const existing = this.saved.records.find(r => r.id === item.id);
            const metadata = { eventId: item.eventId || item.id, scope: item.scope || null, outcomeScope: item.outcomeScope || 'unknown', archiveSource: item.archiveSource, archiveUrl: item.archiveUrl };
            if (existing) {
                for (const [key, value] of Object.entries(metadata)) if (existing[key] == null) existing[key] = value;
                continue;
            }
            this.saved.records.push({ ...metadata, id: item.id, url: item.url, text: item.text.slice(0, 5000), publishedAt: item.publishedAt,
                kind: item.kind, stage: item.stage, verified: false, read: true, eligible: false, revision: 1, source: 'archive',
                timestampBasis: item.timestampBasis || 'archive-post',
                firstSeenAt: this.now(), processingReason: '历史补录，默认已读；社区摘要不是原文' });
            added++;
        }
        this.saved.coverage = { requestedFrom: seed.requestedFrom, requestedTo: seed.requestedTo, collectedAt: seed.collectedAt,
            note: `补录范围 ${seed.requestedFrom?.slice(0, 10)} 至 ${seed.requestedTo?.slice(0, 10)}；存档有原帖链接的候选 ${seed.records?.length || 0} 条。覆盖不完整，尤其缺少部分回复和服务动态；无原帖链接的事件未作为原帖收录。` };
        this.prune(); return added;
    }
    importTiboPost(post) {
        if (!this.featureEnabled) return;
        if (!postUrl(post.url) || post.id !== post.url.split('/').at(-1) || !post.originalText || post.type === 'repost') return;
        const result = classifyPost(post.originalText);
        if (result.kind === 'unrelated') return;
        const existing = this.saved.records.find(r => r.id === post.id);
        if (existing?.originalText === post.originalText && (!post.chineseText || existing.chineseText === post.chineseText) && JSON.stringify(existing.context || null) === JSON.stringify(post.context || null)) return;
        const before = structuredClone(this.saved.records);
        const changed = existing?.originalText && existing.originalText !== post.originalText;
        const firstOriginal = !existing?.originalText;
        const eligible = Boolean(post.eligible) && post.publishedAt > (this.saved.silentBefore || 0);
        const record = existing || { id: post.id, url: post.url, publishedAt: post.publishedAt, firstSeenAt: this.now(), revision: 1, read: !eligible, eligible, source: 'tibo' };
        Object.assign(record, result, { text: post.originalText, originalText: post.originalText, verified: true, verificationStatus: 'verified', verifiedAt: this.now(), needsRecheck: false });
        record.context = post.context ? structuredClone(post.context) : null;
        if (firstOriginal && !record.manualReadAt) record.read = !(eligible || record.eligible);
        if (changed) { record.revision++; record.read = false; record.chineseText = null; }
        if (post.chineseText) { record.chineseText = post.chineseText; record.translationOriginalText = post.originalText; }
        record.deadlineAt = explicitDeadline(post.originalText);
        record.processingReason = record.read ? '历史收录或已手动标记' : 'Tibo 原帖已读取，等待手动标记';
        if (!existing) this.saved.records.push(record);
        if (!this.persist()) this.saved.records = before;
        this.emit();
    }
    updateAccount(state) {
        if (state.status !== 'ready') { this.account = this.account ? { ...this.account, stale: true } : null; this.emit(); return; }
        const available = state.resetCredits?.credits?.filter(c => c.status === 'available' && (!Number.isFinite(c.expiresAt) || (c.expiresAt < 1e11 ? c.expiresAt * 1000 : c.expiresAt) > this.now()));
        const next = { accountKey: state.accountKey || null, planType: state.planType ?? null, hasFiveHour: state.hasFiveHour ?? null, fiveHour: state.fiveHour?.remainingPercent ?? null, weekly: state.weekly?.remainingPercent ?? null,
            creditIds: available ? available.map(c => c.id) : null, credits: available ? available.length : null, updatedAt: state.lastUpdatedAt, stale: false };
        if (this.account?.accountKey !== next.accountKey || this.account?.planType !== next.planType) { this.recoveries = {}; this.cardArrival = null; }
        else {
            for (const key of ['fiveHour', 'weekly']) {
                const before = this.account?.[key], after = next[key];
                if (Number.isFinite(before) && Number.isFinite(after) && after > before && (before === 0 || after === 100)) this.recoveries[key] = { at: this.now(), remaining: after };
            }
        }
        // Without an account identity, don't compare inventories belonging to possibly different users.
        if (this.featureEnabled && next.accountKey && available) {
            this.saved.accountBaselines ||= {};
            const previous = this.saved.accountBaselines[next.accountKey];
            const hash = id => createHash('sha256').update(String(id)).digest('hex');
            const seen = previous?.seen || [];
            const additions = previous && !this.saved.accountBaselineNext ? available.filter(c => !seen.includes(hash(c.id))) : [];
            if (additions.length) {
                const id = 'arrival-' + hash(next.accountKey + additions.map(c => hash(c.id)).sort().join(','));
                const text = `本次检查发现 ${additions.length} 张新增重置卡；发现时间不代表准确到账时间。`;
                if (!this.saved.records.some(r => r.id === id)) this.saved.records.push({ id, kind: 'arrival', stage: 'completed', source: 'account', accountKey: next.accountKey,
                    publishedAt: this.now(), firstSeenAt: this.now(), verified: true, verificationStatus: 'observed', read: false, revision: 1,
                    count: additions.length, expiresAt: additions.map(c => c.expiresAt ?? null), text, processingReason: '账户检测到新卡，等待手动标记' });
                this.cardArrival = { at: this.now(), count: additions.length };
            } else {
                const latest = this.saved.records.find(r => r.kind === 'arrival' && r.accountKey === next.accountKey);
                this.cardArrival = latest ? { at: latest.publishedAt, count: latest.count } : null;
            }
            this.saved.accountBaselines[next.accountKey] = { seen: [...new Set([...seen, ...available.map(c => hash(c.id))])], checkedAt: this.now() };
            this.saved.accountBaselineNext = false;
            this.persist();
        }
        this.account = next; this.emit();
    }
    async refresh(manual = false) {
        if (!this.featureEnabled) return this.view();
        if (this.pending) return this.pending;
        if (this.stopped || (!manual && !this.saved.enabled)) return this.view();
        if ((manual ? this.manualCheckAt() : this.nextCheckAt()) > this.now()) { this.schedule(); return this.view(); }
        this.manual = manual;
        this.pending = this.check().finally(() => { this.pending = null; this.manual = false; this.schedule(); });
        return this.pending;
    }
    async check() {
        const baseline = !this.saved.initialized;
        this.loading = true; this.error = null; this.saved.lastAttemptAt = this.now(); this.persist(); this.emit();
        this.abort = new AbortController();
        try {
            const snapshot = parseCommunity(await this.loadCommunity({ signal: this.abort.signal }), this.now());
            if (this.stopped || this.abort.signal.aborted) return this.view();
            this.saved.community = { asOf: snapshot.asOf, percent: snapshot.percent, healthy: snapshot.healthy, active: snapshot.active };
            this.saved.failures = 0; this.saved.lastFailureAt = null; this.saved.lastSuccessAt = this.now();
            const fresh = snapshot.healthy && this.now() - snapshot.asOf <= MAX_AGE;
            const initializedAt = Math.max(this.saved.initializedAt || this.now(), this.saved.silentBefore || 0);
            for (const item of snapshot.records) {
                const existing = this.saved.records.find(r => r.id === item.id);
                if (!existing) this.saved.records.push({ ...item, firstSeenAt: this.now(), revision: 1, eligible: !baseline && item.publishedAt > initializedAt, read: true, processingReason: baseline || item.publishedAt <= initializedAt ? '历史收录，默认已读' : '等待原帖读取' });
                else if (existing.text !== item.text) {
                    // A community summary edit is not proof that the original post changed.
                    existing.text = item.text;
                    if (!existing.originalText) Object.assign(existing, { kind: item.kind, stage: item.stage });
                }
                else if (!existing.verified && existing.verificationStatus !== 'rejected') { existing.kind = item.kind; existing.stage = item.stage; existing.source = 'community'; }
                if (existing) for (const key of ['scope', 'communityCompletedAt']) if (item[key] != null) existing[key] = item[key];
            }
            this.prune();
            if (!this.abort.signal.aborted) recordForecast(this.saved, snapshot, this.now());
            this.persist();
            if (fresh) {
                this.saved.initialized = true; this.saved.initializedAt = initializedAt;
                if (this.loadOriginal) await this.loadCandidates();
            }
            recordForecast(this.saved, snapshot, this.now());
        } catch (error) {
            if (!this.stopped && !this.abort.signal.aborted) {
                this.saved.failures = (this.saved.failures || 0) + 1;
                this.saved.lastFailureAt = this.now();
                this.error = error.message?.startsWith('社区') ? error.message : '社区更新失败，请稍后重试';
            }
        } finally { this.loading = false; if (!this.abort.signal.aborted) this.persist(); this.emit(); }
        return this.view();
    }
    async loadCandidates() {
        const needsTranslation = r => r.originalText && !r.chineseText && (r.translationAttempts || 0) < 3 && (!r.nextTranslationAt || r.nextTranslationAt <= this.now());
        const candidates = this.saved.records.filter(r => r.kind !== 'arrival' && postUrl(r.url) &&
            (!r.nextVerificationAt || r.nextVerificationAt <= this.now()) &&
            (r.originalText ? needsTranslation(r) : true))
            .sort((a, b) => Number(Boolean(b.eligible)) - Number(Boolean(a.eligible)) || Number(Boolean(a.originalText)) - Number(Boolean(b.originalText)) || b.publishedAt - a.publishedAt).slice(0, 2);
        for (const record of candidates) {
            if (record.originalText && !needsTranslation(record)) continue;
            const previous = record.originalText;
            const translationOnly = Boolean(previous);
            try {
                const post = await this.loadOriginal(record, { signal: this.abort.signal });
                if (this.stopped || this.abort.signal.aborted) break;
                if (record.originalText !== previous) continue; // A timeline update arrived while this request was pending.
                const text = typeof post?.originalText === 'string' ? post.originalText : '';
                if (translationOnly) {
                    saveTranslation(record, post, record.originalText, this.now());
                    continue;
                }
                if (!text.trim()) {
                    record.verificationAttempts = (record.verificationAttempts || 0) + 1;
                    record.verificationStatus = 'unreadable'; record.nextVerificationAt = this.now() + Math.min(7 * DAY, 6 * HOUR * 2 ** Math.min(record.verificationAttempts - 1, 5)); continue;
                }
                const result = classifyPost(text);
                const acknowledgeDuringCheck = record.manualReadAt && record.manualReadAt >= this.saved.lastAttemptAt;
                Object.assign(record, result, { originalText: text, verifiedAt: this.now(), verificationFailures: 0 });
                record.outcomeScope = /\b(?:affected|some|replacement|failed|targeted)\b/i.test(text) ? 'targeted' : /\ball (?:paid |codex |chatgpt work )?(?:users|accounts|plans)\b|\beveryone\b/i.test(text) ? 'broad' : 'unknown';
                record.deadlineAt = explicitDeadline(text);
                record.needsRecheck = false; record.nextVerificationAt = null;
                saveTranslation(record, post, text, this.now());
                record.verified = true; record.verificationStatus = 'verified';
                if (result.kind === 'unrelated') { record.read = true; record.processingReason = '原帖已读取，内容无关，不提醒'; continue; }
                record.read = acknowledgeDuringCheck ? true : !record.eligible;
                record.processingReason = record.read ? record.manualReadAt ? '已手动标记已读' : '历史收录，默认已读' : '相关原帖已读取，等待手动标记';
                if (!record.read && !record.notified) { record.notified = true; this.persist(); this.onNotice(record); }
            } catch {
                if (this.stopped || this.abort.signal.aborted) break;
                if (record.originalText !== previous) continue;
                if (translationOnly) { saveTranslation(record, null, record.originalText, this.now()); continue; }
                record.verificationFailures = (record.verificationFailures || 0) + 1;
                record.verificationStatus = 'network-error';
                record.nextVerificationAt = this.now() + Math.min(6 * HOUR, INTERVAL * 2 ** Math.min(record.verificationFailures, 6));
            }
        }
    }
}
module.exports = { ResetNotices, classify, classifyPost, postUrl, HOUR, DAY, AUTO_INTERVAL };
