"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefreshController = void 0;
const usage_model_1 = require("./usage-model");
const EMPTY_VIEWS = (0, usage_model_1.normalizeRateLimits)({});
const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000];
const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const GENERIC_ERROR = '额度服务暂时无法连接';
const RESET_ERROR = '额度重置失败，请稍后重试';
function cloneWindow(window) {
    return window == null ? window : { ...window };
}
function cloneSnapshot(snapshot) {
    return {
        ...(snapshot.primary !== undefined ? { primary: cloneWindow(snapshot.primary) } : {}),
        ...(snapshot.secondary !== undefined ? { secondary: cloneWindow(snapshot.secondary) } : {}),
    };
}
function cloneResetCredits(resetCredits) {
    if (resetCredits === null)
        return null;
    return {
        availableCount: resetCredits.availableCount,
        credits: resetCredits.credits.map((credit) => ({ ...credit })),
    };
}
function mergeWindow(current, update) {
    if (update === undefined)
        return current;
    if (update === null)
        return null;
    return { ...(current ?? {}), ...update };
}
function mergeSnapshot(current, update) {
    return {
        primary: mergeWindow(current.primary, update.primary),
        secondary: mergeWindow(current.secondary, update.secondary),
    };
}
class RefreshController {
    client;
    now;
    intervalMs;
    retryDelaysMs;
    sleep;
    listeners = new Set();
    rawSnapshot = {};
    state = {
        status: 'loading',
        fiveHour: EMPTY_VIEWS.fiveHour,
        weekly: EMPTY_VIEWS.weekly,
        resetCredits: null,
        isResetting: false,
        lastUpdatedAt: null,
        errorMessage: null,
    };
    timer;
    inFlight;
    resetInFlight;
    unsubscribeUpdates;
    started = false;
    hasSnapshot = false;
    constructor(client, options) {
        this.client = client;
        this.now = options?.now ?? Date.now;
        this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
        this.retryDelaysMs = [...(options?.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS)];
        this.sleep = options?.sleep ?? defaultSleep;
    }
    start() {
        if (this.started)
            return this.inFlight ?? Promise.resolve();
        this.started = true;
        this.unsubscribeUpdates = this.client.onRateLimitsUpdated((snapshot) => this.handleUpdate(snapshot));
        return this.refreshNow();
    }
    refreshNow() {
        if (!this.started)
            return Promise.resolve();
        if (this.inFlight)
            return this.inFlight;
        this.clearTimer();
        this.emit({ ...this.state, status: 'loading', errorMessage: null });
        const request = this.readRateLimitsWithRetry();
        const operation = request
            .then((reading) => {
            if (!this.started)
                return;
            this.rawSnapshot = cloneSnapshot(reading.rateLimits);
            const views = (0, usage_model_1.normalizeRateLimits)(this.rawSnapshot);
            this.hasSnapshot = true;
            this.emit({
                status: 'ready',
                ...views,
                resetCredits: cloneResetCredits(reading.rateLimitResetCredits),
                isResetting: false,
                lastUpdatedAt: this.now(),
                errorMessage: null,
            });
        })
            .catch(() => {
            if (!this.started)
                return;
            this.emit({
                ...this.state,
                status: this.hasSnapshot ? 'stale' : 'error',
                errorMessage: GENERIC_ERROR,
            });
        })
            .finally(() => {
            if (this.inFlight === operation)
                this.inFlight = undefined;
            if (this.started)
                this.scheduleTimer();
        });
        this.inFlight = operation;
        return operation;
    }
    resetQuota() {
        if (this.resetInFlight)
            return this.resetInFlight;
        const credit = this.state.resetCredits?.credits.find((candidate) => candidate.status === 'available');
        if (!this.started || !credit)
            return Promise.resolve({ outcome: 'noCredit' });
        this.emit({ ...this.state, isResetting: true, errorMessage: null });
        const operation = this.client.consumeRateLimitResetCredit(credit.id)
            .then(async (result) => {
            if (this.started)
                await this.refreshNow();
            return result;
        })
            .catch((error) => {
            if (this.started) {
                this.emit({ ...this.state, isResetting: false, errorMessage: RESET_ERROR });
            }
            throw error;
        })
            .finally(() => {
            if (this.resetInFlight === operation)
                this.resetInFlight = undefined;
            if (this.started && this.state.isResetting) {
                this.emit({ ...this.state, isResetting: false });
            }
        });
        this.resetInFlight = operation;
        return operation;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    stop() {
        this.started = false;
        this.clearTimer();
        this.unsubscribeUpdates?.();
        this.unsubscribeUpdates = undefined;
    }
    emit(state) {
        this.state = {
            ...state,
            fiveHour: { ...state.fiveHour },
            weekly: { ...state.weekly },
            resetCredits: cloneResetCredits(state.resetCredits),
        };
        for (const listener of this.listeners)
            listener(this.state);
    }
    handleUpdate(update) {
        if (!this.started)
            return;
        this.rawSnapshot = mergeSnapshot(this.rawSnapshot, update);
        const views = (0, usage_model_1.normalizeRateLimits)(this.rawSnapshot);
        this.hasSnapshot = true;
        this.emit({
            status: 'ready',
            ...views,
            resetCredits: cloneResetCredits(this.state.resetCredits),
            isResetting: this.state.isResetting,
            lastUpdatedAt: this.now(),
            errorMessage: null,
        });
    }
    async readRateLimitsWithRetry() {
        let lastError = new Error('Unable to refresh rate limits');
        for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
            if (attempt > 0)
                await this.sleep(this.retryDelaysMs[attempt - 1]);
            if (!this.started)
                throw new Error('RefreshController stopped');
            try {
                return await this.client.readRateLimits();
            }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }
    scheduleTimer() {
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.refreshNow();
        }, this.intervalMs);
    }
    clearTimer() {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
}
exports.RefreshController = RefreshController;
