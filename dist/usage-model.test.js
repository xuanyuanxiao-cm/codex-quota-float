"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const usage_model_1 = require("./usage-model");
(0, vitest_1.describe)('normalizeRateLimits', () => {
    (0, vitest_1.it)('returns only the official seven-day window', () => {
        (0, vitest_1.expect)((0, usage_model_1.normalizeRateLimits)({
            primary: {
                usedPercent: 83,
                resetsAt: 1_700_000_000,
                windowDurationMins: 300,
            },
            secondary: {
                usedPercent: 42,
                resetsAt: 1_700_100_000,
                windowDurationMins: 10_080,
            },
        })).toEqual({
            weekly: {
                remainingPercent: 58,
                resetsAt: 1_700_100_000,
                windowDurationMins: 10_080,
            },
        });
    });
    (0, vitest_1.it)('maps a lone seven-day primary window to weekly', () => {
        (0, vitest_1.expect)((0, usage_model_1.normalizeRateLimits)({
            primary: {
                usedPercent: 1,
                resetsAt: 1_784_518_547,
                windowDurationMins: 10_080,
            },
            secondary: null,
        })).toEqual({
            weekly: {
                remainingPercent: 99,
                resetsAt: 1_784_518_547,
                windowDurationMins: 10_080,
            },
        });
    });
    (0, vitest_1.it)('does not expose a lone five-hour window as weekly quota', () => {
        (0, vitest_1.expect)((0, usage_model_1.normalizeRateLimits)({
            primary: { usedPercent: 20, resetsAt: 1_700_000_000, windowDurationMins: 300 },
            secondary: null,
        })).toEqual({
            weekly: { remainingPercent: null, resetsAt: null, windowDurationMins: null },
        });
    });
    (0, vitest_1.it)('keeps the duration-less secondary compatibility fallback', () => {
        (0, vitest_1.expect)((0, usage_model_1.normalizeRateLimits)({ secondary: { usedPercent: 25, resetsAt: 123 } })).toEqual({
            weekly: { remainingPercent: 75, resetsAt: 123, windowDurationMins: null },
        });
    });
    vitest_1.it.each([
        [0, 100],
        [100, 0],
    ])('converts %d%% weekly used to %d%% remaining', (usedPercent, remainingPercent) => {
        (0, vitest_1.expect)((0, usage_model_1.normalizeRateLimits)({ secondary: { usedPercent, windowDurationMins: 10_080 } }).weekly
            .remainingPercent).toBe(remainingPercent);
    });
    vitest_1.it.each([
        [-25, 100],
        [125, 0],
    ])('clamps %d%% weekly used to %d%% remaining', (usedPercent, remainingPercent) => {
        (0, vitest_1.expect)((0, usage_model_1.normalizeRateLimits)({ secondary: { usedPercent, windowDurationMins: 10_080 } }).weekly
            .remainingPercent).toBe(remainingPercent);
    });
    (0, vitest_1.it)('returns unavailable weekly data for absent windows and fields', () => {
        (0, vitest_1.expect)((0, usage_model_1.normalizeRateLimits)({ primary: null, secondary: undefined })).toEqual({
            weekly: { remainingPercent: null, resetsAt: null, windowDurationMins: null },
        });
        (0, vitest_1.expect)((0, usage_model_1.normalizeRateLimits)({ secondary: { resetsAt: 1_700_000_000, windowDurationMins: 10_080 } })
            .weekly).toEqual({
            remainingPercent: null,
            resetsAt: 1_700_000_000,
            windowDurationMins: 10_080,
        });
    });
});
