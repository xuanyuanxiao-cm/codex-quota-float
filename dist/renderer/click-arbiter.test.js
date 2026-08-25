"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const click_arbiter_1 = require("./click-arbiter");
(0, vitest_1.afterEach)(() => {
    vitest_1.vi.useRealTimers();
});
(0, vitest_1.describe)('createClickArbiter', () => {
    (0, vitest_1.test)('delays a single click by 220 ms', () => {
        vitest_1.vi.useFakeTimers();
        const single = vitest_1.vi.fn();
        const arbiter = (0, click_arbiter_1.createClickArbiter)(single);
        arbiter.scheduleSingle();
        vitest_1.vi.advanceTimersByTime(219);
        (0, vitest_1.expect)(single).not.toHaveBeenCalled();
        vitest_1.vi.advanceTimersByTime(1);
        (0, vitest_1.expect)(single).toHaveBeenCalledOnce();
    });
    (0, vitest_1.test)('cancels the pending single click for a double click', () => {
        vitest_1.vi.useFakeTimers();
        const single = vitest_1.vi.fn();
        const arbiter = (0, click_arbiter_1.createClickArbiter)(single);
        arbiter.scheduleSingle();
        arbiter.cancelSingle();
        vitest_1.vi.runAllTimers();
        (0, vitest_1.expect)(single).not.toHaveBeenCalled();
    });
    (0, vitest_1.test)('replaces an earlier pending single click instead of firing twice', () => {
        vitest_1.vi.useFakeTimers();
        const single = vitest_1.vi.fn();
        const arbiter = (0, click_arbiter_1.createClickArbiter)(single, 100);
        arbiter.scheduleSingle();
        vitest_1.vi.advanceTimersByTime(50);
        arbiter.scheduleSingle();
        vitest_1.vi.advanceTimersByTime(100);
        (0, vitest_1.expect)(single).toHaveBeenCalledOnce();
    });
});
