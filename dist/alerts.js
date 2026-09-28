"use strict";
const DAY_MS = 24 * 60 * 60 * 1000;
const toMillis = (epoch) => Number.isFinite(epoch) ? (epoch < 1e11 ? epoch * 1000 : epoch) : null;
const labels = { fiveHour: '5 小时', weekly: '周' };
const severity = (remaining) => remaining === 0 ? 'exhausted' : remaining <= 10 ? 'critical' : remaining <= 20 ? 'low' : null;

class QuotaAlerts {
    constructor(saved = {}, save = () => {}, now = Date.now) {
        this.saved = {
            version: 2,
            windows: saved.windows && typeof saved.windows === 'object' ? saved.windows : {},
            credits: saved.credits && typeof saved.credits === 'object' ? saved.credits : {},
            lastManualResetAt: saved.lastManualResetAt ?? 0,
        };
        if (saved.version !== 2) {
            for (const window of Object.values(this.saved.windows)) {
                if (window?.remaining === 0) window.notified = [20, 10, 0];
            }
        }
        this.save = save;
        this.now = now;
        this.lastRefreshId = 0;
        this.pendingQuota = false;
        this.quotaEventId = 0;
        this.recoveries = new Set();
        this.view = { windows: {}, expiringCredits: [], quotaBadge: null, creditBadges: [] };
    }
    dismiss(category) {
        if (category === 'quota') {
            this.pendingQuota = false;
            this.recoveries.clear();
            this.view = { ...this.view, quotaBadge: null };
        }
        if (category === 'credits') this.view = { ...this.view, creditBadges: [] };
        return this.view;
    }
    update(state) {
        const now = this.now();
        this.view = { ...this.view,
            expiringCredits: this.view.expiringCredits.filter(c => c.expiresAt > now),
            creditBadges: this.view.creditBadges.filter(c => c.expiresAt > now) };
        if (state.status !== 'ready' || state.isResetting) return { alerts: this.view };
        const before = JSON.stringify(this.saved);
        const fullRead = Number.isFinite(state.refreshId) && state.refreshId !== this.lastRefreshId;
        const keys = state.hasFiveHour === false ? ['weekly'] : ['fiveHour', 'weekly'];
        if (fullRead) {
            this.lastRefreshId = state.refreshId;
            if (keys.every(key => Number.isFinite(state[key]?.remainingPercent))) this.dismiss('quota');
            if (state.resetCredits !== null && state.resetCredits !== undefined) this.dismiss('credits');
        }
        const manual = state.lastManualResetAt > this.saved.lastManualResetAt;
        const windows = {};
        for (const key of keys) {
            const current = state[key];
            if (!Number.isFinite(current?.remainingPercent)) continue;
            const remaining = current.remainingPercent;
            const previous = this.saved.windows[key];
            const recovered = previous?.remaining === 0 && remaining > 0;
            const newPeriod = previous && toMillis(previous.resetsAt) !== null &&
                toMillis(previous.resetsAt) <= now && toMillis(current.resetsAt) > toMillis(previous.resetsAt);
            let notified = Array.isArray(previous?.notified) ? [...previous.notified] : [];
            if (recovered || newPeriod || manual) notified = [];
            if (recovered) { this.pendingQuota = true; this.quotaEventId++; this.recoveries.add(key); }
            if (remaining === 0) this.recoveries.delete(key);
            const threshold = remaining === 0 ? 0 : remaining <= 10 ? 10 : remaining <= 20 ? 20 : null;
            if (threshold !== null && !notified.includes(threshold)) {
                this.pendingQuota = true;
                this.quotaEventId++;
                notified = [20, 10, 0].filter(value => value >= threshold);
            }
            windows[key] = { low: threshold !== null, exhausted: remaining === 0, severity: severity(remaining) };
            this.saved.windows[key] = { remaining, resetsAt: current.resetsAt, notified };
        }
        if (manual) this.saved.lastManualResetAt = state.lastManualResetAt;
        const text = [];
        for (const key of keys) {
            const remaining = state[key]?.remainingPercent;
            if (this.recoveries.has(key) && Number.isFinite(remaining)) text.push(`${labels[key]}额度已恢复，剩余 ${Math.round(remaining)}%`);
            if (!Number.isFinite(remaining)) text.push(`${labels[key]}额度暂不可用`);
            else if (remaining <= 20) text.push(`${labels[key]}额度${remaining === 0 ? '已耗尽' : remaining <= 10 ? '余量很低' : '偏低'}（${Math.round(remaining)}%）`);
        }
        const levels = Object.values(windows).map(w => w.severity);
        const worst = ['exhausted', 'critical', 'low'].find(value => levels.includes(value));
        const allKnown = keys.every(key => Number.isFinite(state[key]?.remainingPercent));
        const quotaBadge = this.pendingQuota && text.length ? { severity: worst || (allKnown ? 'recovered' : 'unknown'), text: text.join('；'), eventId: this.quotaEventId } : null;
        if (!quotaBadge) this.pendingQuota = false;
        let expiringCredits = this.view.expiringCredits;
        let creditBadges = this.view.creditBadges;
        if (state.resetCredits != null) {
            expiringCredits = (state.resetCredits.credits ?? []).filter(credit =>
                credit.status === 'available' && toMillis(credit.expiresAt) > now && toMillis(credit.expiresAt) - now <= DAY_MS
            ).map(credit => ({ id: credit.id, expiresAt: toMillis(credit.expiresAt) })).sort((a, b) => a.expiresAt - b.expiresAt);
            const newlyExpiring = expiringCredits.filter(credit => this.saved.credits[credit.id] !== credit.expiresAt);
            creditBadges = creditBadges.filter(credit => expiringCredits.some(c => c.id === credit.id && c.expiresAt === credit.expiresAt));
            for (const credit of newlyExpiring) {
                this.saved.credits[credit.id] = credit.expiresAt;
                creditBadges.push(credit);
            }
        }
        for (const [id, expiry] of Object.entries(this.saved.credits)) if (expiry <= now) delete this.saved.credits[id];
        this.view = { windows, expiringCredits, quotaBadge, creditBadges };
        if (JSON.stringify(this.saved) !== before) this.save(this.saved);
        return { alerts: this.view };
    }
}

function nextRefreshDelay(state, now, intervalMs) {
    const deadlines = [toMillis(state.fiveHour?.resetsAt), toMillis(state.weekly?.resetsAt)];
    for (const credit of state.resetCredits?.credits ?? []) {
        const expiry = toMillis(credit.expiresAt);
        if (credit.status === 'available' && expiry !== null) deadlines.push(expiry - DAY_MS, expiry);
    }
    const upcoming = deadlines.filter((deadline) => deadline !== null && deadline > now);
    return Math.min(intervalMs, ...upcoming.map((deadline) => deadline - now + 1000));
}

module.exports = { QuotaAlerts, nextRefreshDelay };
