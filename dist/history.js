"use strict";
const fs = require('node:fs');
const WEEK = 7 * 86400000;
const millis = (value) => Number.isFinite(value) ? (value < 1e11 ? value * 1000 : value) : null;

class UsageHistory {
    constructor(file, now = Date.now) {
        this.file = file;
        this.now = now;
        this.samples = [];
        this.lastManualResetAt = 0;
        this.gapNext = true;
        this.error = null;
        try {
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            this.samples = (saved.samples ?? []).filter((sample) => Number.isFinite(sample.at) && sample.at >= now() - WEEK && sample.at <= now());
            this.lastManualResetAt = saved.lastManualResetAt ?? 0;
        } catch (error) {
            if (error.code !== 'ENOENT') this.error = '历史文件无法读取，本次将重新记录。';
        }
    }
    record(state) {
        if (state.status === 'error' || state.status === 'stale') this.gapNext = true;
        if (state.status !== 'ready' || state.isResetting || !Number.isFinite(state.lastUpdatedAt)) return false;
        if (!['fiveHour', 'weekly'].some((key) => Number.isFinite(state[key]?.remainingPercent))) { this.gapNext = true; return false; }
        const previous = this.samples.at(-1);
        const manual = state.lastManualResetAt > this.lastManualResetAt;
        if (previous && state.lastUpdatedAt <= previous.at && !manual) return false;
        const gap = this.gapNext || (!!previous && state.lastUpdatedAt - previous.at > 660000);
        const sample = { at: state.lastUpdatedAt, gapBefore: gap, events: {} };
        for (const key of ['fiveHour', 'weekly']) {
            const value = state[key]?.remainingPercent;
            sample[key] = { remainingPercent: Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null, resetsAt: millis(state[key]?.resetsAt) };
            const before = previous?.[key];
            if (Number.isFinite(before?.remainingPercent) && sample[key].remainingPercent !== null) {
                if (manual) sample.events[key] = 'manual';
                else if (!gap && before.resetsAt !== null && before.resetsAt <= sample.at && sample[key].resetsAt > before.resetsAt) sample.events[key] = 'period';
                else if (sample[key].remainingPercent > before.remainingPercent) sample.events[key] = 'increase';
            }
        }
        if (manual) {
            sample.manualReset = true;
            this.lastManualResetAt = state.lastManualResetAt;
        }
        if (previous?.at === sample.at) this.samples.pop();
        this.samples.push(sample);
        this.samples = this.samples.filter((item) => item.at >= this.now() - WEEK);
        this.gapNext = false;
        try {
            fs.writeFileSync(this.file, JSON.stringify({ samples: this.samples, lastManualResetAt: this.lastManualResetAt }), 'utf8');
            this.error = null;
        } catch { this.error = '历史暂时无法保存，当前记录仅在本次运行期间保留。'; }
        return true;
    }
    read() {
        return { samples: this.samples.filter((sample) => sample.at >= this.now() - WEEK), now: this.now(), error: this.error };
    }
}
module.exports = { UsageHistory };
