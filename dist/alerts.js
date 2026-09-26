"use strict";
const DAY_MS = 24 * 60 * 60 * 1000;
const toMillis = (epoch) => Number.isFinite(epoch) ? (epoch < 1e11 ? epoch * 1000 : epoch) : null;

function timeRemaining(epoch, now) {
    const minutes = Math.max(1, Math.ceil((toMillis(epoch) - now) / 60000));
    return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

class QuotaAlerts {
    constructor(saved = {}, save = () => {}, now = Date.now) {
        this.saved = {
            enabled: saved.enabled !== false,
            windows: saved.windows && typeof saved.windows === 'object' ? saved.windows : {},
            credits: saved.credits && typeof saved.credits === 'object' ? saved.credits : {},
        };
        this.save = save;
        this.now = now;
        this.recoveredUntil = {};
        this.suppressRecovery = false;
        this.view = { windows: {}, expiringCredits: [] };
    }
    setEnabled(enabled) {
        this.saved.enabled = enabled;
        this.save(this.saved);
    }
    update(state) {
        if (state.isResetting) this.suppressRecovery = true;
        if (state.status !== 'ready') return { alerts: this.view, notifications: [] };
        const now = this.now();
        const before = JSON.stringify(this.saved);
        const notifications = [];
        const windows = {};
        for (const [key, label] of [['fiveHour', '5 小时'], ['weekly', '每周']]) {
            const current = state[key];
            if (!Number.isFinite(current?.remainingPercent)) continue;
            const remaining = current.remainingPercent;
            const previous = this.saved.windows[key];
            const recovered = previous?.remaining === 0 && remaining > 0;
            const newPeriod = previous && toMillis(previous.resetsAt) !== null &&
                toMillis(previous.resetsAt) <= now && toMillis(current.resetsAt) > toMillis(previous.resetsAt);
            let notified = Array.isArray(previous?.notified) ? previous.notified : [];
            if (recovered || newPeriod || (previous?.remaining <= 20 && remaining > 20)) notified = [];
            if (recovered) {
                this.recoveredUntil[key] = now + 60000;
                const otherKey = key === 'fiveHour' ? 'weekly' : 'fiveHour';
                const otherLabel = key === 'fiveHour' ? '每周' : '5 小时';
                const otherRemaining = state[otherKey]?.remainingPercent;
                const availability = otherRemaining === 0 ? `但${otherLabel}额度仍已用尽。` :
                    Number.isFinite(otherRemaining) && otherRemaining > 0 ? '可以继续使用了。' : '点击查看最新额度。';
                if (!this.suppressRecovery) notifications.push({
                    kind: 'recovered', target: 'details', title: `${label}额度已恢复`,
                    body: `${label}额度已恢复，当前剩余 ${Math.round(remaining)}%。${availability}`,
                });
            }
            const threshold = remaining <= 10 ? 10 : remaining <= 20 ? 20 : null;
            if (threshold !== null && !notified.includes(threshold)) {
                // A jump directly below 10% produces one notification, not two.
                notified = threshold === 10 ? [20, 10] : [20];
                const timing = toMillis(current.resetsAt) > now ? `，${timeRemaining(current.resetsAt, now)}后恢复` : '';
                if (!recovered && !state.isResetting) notifications.push({
                    kind: 'low', target: 'details', title: remaining === 0 ? `${label}额度已用尽` : `${label}额度偏低`,
                    body: `剩余 ${Math.round(remaining)}%${timing}。`,
                });
            }
            if (threshold !== null) delete this.recoveredUntil[key];
            windows[key] = { low: threshold !== null, exhausted: remaining === 0, recoveredUntil: this.recoveredUntil[key] ?? 0 };
            this.saved.windows[key] = { remaining, resetsAt: current.resetsAt, notified };
        }
        const expiringCredits = (state.resetCredits?.credits ?? []).filter((credit) =>
            credit.status === 'available' && toMillis(credit.expiresAt) > now && toMillis(credit.expiresAt) - now <= DAY_MS
        ).map((credit) => ({ id: credit.id, expiresAt: toMillis(credit.expiresAt) })).sort((a, b) => a.expiresAt - b.expiresAt);
        const newlyExpiring = expiringCredits.filter((credit) => this.saved.credits[credit.id] !== credit.expiresAt);
        if (newlyExpiring.length && !state.isResetting) {
            notifications.push({ kind: 'expiring', target: 'credits', title: '重置卡即将过期',
                body: `有 ${newlyExpiring.length} 张重置卡将在 24 小时内过期，最快剩余 ${timeRemaining(newlyExpiring[0].expiresAt, now)}。点击查看。` });
            for (const credit of newlyExpiring) this.saved.credits[credit.id] = credit.expiresAt;
        }
        for (const [id, expiry] of Object.entries(this.saved.credits)) {
            if (expiry <= now) delete this.saved.credits[id];
        }
        if (!state.isResetting) this.suppressRecovery = false;
        this.view = { windows, expiringCredits };
        if (JSON.stringify(this.saved) !== before) this.save(this.saved);
        return { alerts: this.view, notifications: this.saved.enabled ? notifications : [] };
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
