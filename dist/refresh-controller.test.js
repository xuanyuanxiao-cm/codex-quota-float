"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const refresh_controller_1 = require("./refresh-controller");
class FakeClient {
    reads = 0;
    consumedCreditIds = [];
    listener;
    queued = [];
    resolvers = [];
    readRateLimits() {
        this.reads += 1;
        if (this.queued.length > 0)
            return this.queued.shift()();
        return new Promise((resolve, reject) => this.resolvers.push({ resolve, reject }));
    }
    queueRead(snapshot, rateLimitResetCredits = null) {
        this.queued.push(() => Promise.resolve({ rateLimits: snapshot, rateLimitResetCredits }));
    }
    queueFailure(message) {
        this.queued.push(() => Promise.reject(new Error(message)));
    }
    resolveNext(snapshot, rateLimitResetCredits = null) {
        this.resolvers.shift()?.resolve({ rateLimits: snapshot, rateLimitResetCredits });
    }
    rejectNext(message) {
        this.resolvers.shift()?.reject(new Error(message));
    }
    onRateLimitsUpdated(listener) {
        this.listener = listener;
        return () => {
            this.listener = undefined;
        };
    }
    emit(snapshot) {
        this.listener?.(snapshot);
    }
    consumeRateLimitResetCredit(creditId) {
        this.consumedCreditIds.push(creditId);
        return Promise.resolve({ outcome: 'reset' });
    }
}
const snapshot = (usedPercent, weekly = 40) => ({
    primary: { usedPercent, resetsAt: 100, windowDurationMins: 300 },
    secondary: { usedPercent: weekly, resetsAt: 200, windowDurationMins: 10_080 },
});
function createController(client, now = 1_000) {
    const states = [];
    const controller = new refresh_controller_1.RefreshController(client, {
        now: () => now,
    });
    controller.subscribe((state) => states.push(state));
    return { controller, states };
}
(0, vitest_1.describe)('RefreshController', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.useFakeTimers());
    (0, vitest_1.afterEach)(() => vitest_1.vi.useRealTimers());
    (0, vitest_1.test)('performs one immediate startup read', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(20));
        const { controller } = createController(client);
        await controller.start();
        (0, vitest_1.expect)(client.reads).toBe(1);
    });
    (0, vitest_1.test)('retries after two and five seconds and stops at the first success', async () => {
        const client = new FakeClient();
        client.queueFailure('temporary 1');
        client.queueFailure('temporary 2');
        client.queueRead(snapshot(20));
        const { controller, states } = createController(client);
        const start = controller.start();
        await vitest_1.vi.advanceTimersByTimeAsync(1_999);
        (0, vitest_1.expect)(client.reads).toBe(1);
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        (0, vitest_1.expect)(client.reads).toBe(2);
        await vitest_1.vi.advanceTimersByTimeAsync(4_999);
        (0, vitest_1.expect)(client.reads).toBe(2);
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        await start;
        (0, vitest_1.expect)(client.reads).toBe(3);
        (0, vitest_1.expect)(states.at(-1)?.status).toBe('ready');
    });
    (0, vitest_1.test)('performs exactly one read at five minutes', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(20));
        client.queueRead(snapshot(30));
        const { controller } = createController(client);
        await controller.start();
        await vitest_1.vi.advanceTimersByTimeAsync(300_000);
        (0, vitest_1.expect)(client.reads).toBe(2);
        await vitest_1.vi.advanceTimersByTimeAsync(300_000);
        (0, vitest_1.expect)(client.reads).toBe(3);
    });
    (0, vitest_1.test)('manual refresh resets the timer from completion', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(20));
        client.queueRead(snapshot(30));
        client.queueRead(snapshot(40));
        const { controller } = createController(client);
        await controller.start();
        await vitest_1.vi.advanceTimersByTimeAsync(100_000);
        await controller.refreshNow();
        await vitest_1.vi.advanceTimersByTimeAsync(299_999);
        (0, vitest_1.expect)(client.reads).toBe(2);
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        (0, vitest_1.expect)(client.reads).toBe(3);
    });
    (0, vitest_1.test)('coalesces concurrent refresh calls into one in-flight read', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(20));
        const { controller } = createController(client);
        await controller.start();
        const first = controller.refreshNow();
        const second = controller.refreshNow();
        (0, vitest_1.expect)(first).toBe(second);
        (0, vitest_1.expect)(client.reads).toBe(2);
        client.resolveNext(snapshot(30));
        await first;
    });
    (0, vitest_1.test)('coalesces manual refresh calls while waiting for a retry', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(20));
        const { controller } = createController(client);
        await controller.start();
        client.queueFailure('temporary');
        client.queueRead(snapshot(30));
        const first = controller.refreshNow();
        await vitest_1.vi.advanceTimersByTimeAsync(1_999);
        (0, vitest_1.expect)(client.reads).toBe(2);
        const second = controller.refreshNow();
        (0, vitest_1.expect)(first).toBe(second);
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        await first;
        (0, vitest_1.expect)(client.reads).toBe(3);
    });
    (0, vitest_1.test)('emits a ready state with normalized views after success', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(25));
        const { controller, states } = createController(client);
        await controller.start();
        (0, vitest_1.expect)(states.at(-1)).toEqual({
            status: 'ready',
            weekly: { remainingPercent: 60, resetsAt: 200, windowDurationMins: 10_080 },
            resetCredits: null,
            isResetting: false,
            lastUpdatedAt: 1_000,
            errorMessage: null,
        });
    });
    (0, vitest_1.test)('emits available reset credits with the quota state', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(25), {
            credits: [
                {
                    id: 'credit-1',
                    status: 'available',
                    resetType: 'windows_reset',
                    grantedAt: 1_700_000_000,
                },
                {
                    id: 'credit-2',
                    status: 'available',
                    resetType: 'windows_reset',
                    grantedAt: 1_700_000_100,
                },
            ],
            availableCount: 2,
        });
        const { controller, states } = createController(client);
        await controller.start();
        (0, vitest_1.expect)(states.at(-1)).toMatchObject({
            resetCredits: {
                availableCount: 2,
                credits: [
                    { id: 'credit-1', status: 'available' },
                    { id: 'credit-2', status: 'available' },
                ],
            },
            isResetting: false,
        });
    });
    (0, vitest_1.test)('consumes one available credit and refreshes the remaining count', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(25), {
            credits: [{
                    id: 'credit-1',
                    status: 'available',
                    resetType: 'windows_reset',
                    grantedAt: 1_700_000_000,
                }],
            availableCount: 1,
        });
        client.queueRead(snapshot(0), { credits: [], availableCount: 0 });
        const { controller, states } = createController(client);
        await controller.start();
        const resetting = controller.resetQuota();
        (0, vitest_1.expect)(states.at(-1)?.isResetting).toBe(true);
        await resetting;
        (0, vitest_1.expect)(client.consumedCreditIds).toEqual(['credit-1']);
        (0, vitest_1.expect)(states.at(-1)).toMatchObject({
            status: 'ready',
            resetCredits: { availableCount: 0, credits: [] },
            isResetting: false,
        });
    });
    (0, vitest_1.test)('emits error on a failed first read', async () => {
        const client = new FakeClient();
        client.queueFailure('contains secret token');
        client.queueFailure('temporary 2');
        client.queueFailure('temporary 3');
        const { controller, states } = createController(client);
        const start = controller.start();
        await vitest_1.vi.advanceTimersByTimeAsync(7_000);
        await start;
        (0, vitest_1.expect)(client.reads).toBe(3);
        (0, vitest_1.expect)(states.at(-1)?.status).toBe('error');
        (0, vitest_1.expect)(states.at(-1)?.lastUpdatedAt).toBeNull();
        (0, vitest_1.expect)(states.at(-1)?.errorMessage).toBe('额度服务暂时无法连接');
        (0, vitest_1.expect)(states.at(-1)?.errorMessage).not.toContain('secret');
    });
    (0, vitest_1.test)('preserves prior data and emits stale on a later failure', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(20));
        const { controller, states } = createController(client);
        await controller.start();
        client.queueFailure('failure 1');
        client.queueFailure('failure 2');
        client.queueFailure('failure 3');
        const readsBeforeFailure = client.reads;
        const refresh = controller.refreshNow();
        await vitest_1.vi.advanceTimersByTimeAsync(7_000);
        await refresh;
        (0, vitest_1.expect)(client.reads - readsBeforeFailure).toBe(3);
        (0, vitest_1.expect)(states.at(-1)).toMatchObject({
            status: 'stale',
            weekly: { remainingPercent: 60 },
            lastUpdatedAt: 1_000,
            errorMessage: '额度服务暂时无法连接',
        });
    });
    (0, vitest_1.test)('merges sparse update notifications without scheduling another timer', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(20));
        const { controller, states } = createController(client);
        await controller.start();
        client.emit({ primary: { usedPercent: 55 } });
        (0, vitest_1.expect)(states.at(-1)).toMatchObject({
            status: 'ready',
            weekly: { remainingPercent: 60, resetsAt: 200, windowDurationMins: 10_080 },
        });
        (0, vitest_1.expect)(states.at(-1)).not.toHaveProperty('fiveHour');
        await vitest_1.vi.advanceTimersByTimeAsync(299_999);
        (0, vitest_1.expect)(client.reads).toBe(1);
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        (0, vitest_1.expect)(client.reads).toBe(2);
    });
    (0, vitest_1.test)('stop clears timers, unsubscribes notifications, and prevents future reads', async () => {
        const client = new FakeClient();
        client.queueRead(snapshot(20));
        client.queueRead(snapshot(30));
        const { controller, states } = createController(client);
        await controller.start();
        const stateCount = states.length;
        controller.stop();
        await vitest_1.vi.advanceTimersByTimeAsync(300_000);
        client.emit({ primary: { usedPercent: 90 } });
        (0, vitest_1.expect)(client.reads).toBe(1);
        (0, vitest_1.expect)(states).toHaveLength(stateCount);
    });
    (0, vitest_1.test)('stop during a retry delay prevents later attempts and post-stop state', async () => {
        const client = new FakeClient();
        client.queueFailure('temporary');
        client.queueRead(snapshot(20));
        client.queueRead(snapshot(30));
        const { controller, states } = createController(client);
        const start = controller.start();
        await vitest_1.vi.advanceTimersByTimeAsync(1_000);
        (0, vitest_1.expect)(client.reads).toBe(1);
        const stateCount = states.length;
        controller.stop();
        await vitest_1.vi.advanceTimersByTimeAsync(6_000);
        await start;
        (0, vitest_1.expect)(client.reads).toBe(1);
        (0, vitest_1.expect)(states).toHaveLength(stateCount);
    });
});
