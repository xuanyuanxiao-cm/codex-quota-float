"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const view_model_1 = require("./view-model");
const renderer_1 = require("./renderer");
const rendererModule = __importStar(require("./renderer"));
const state = (overrides = {}) => ({
    status: 'ready',
    weekly: { remainingPercent: 87, resetsAt: 1_700_176_400, windowDurationMins: 10_080 },
    resetCredits: {
        credits: [{
                id: 'credit-1',
                status: 'available',
                resetType: 'windows_reset',
                grantedAt: 1_700_000_000,
            }],
        availableCount: 1,
    },
    isResetting: false,
    lastUpdatedAt: 1_700_000_000_000,
    errorMessage: null,
    ...overrides,
});
function source(file) {
    return (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, file), 'utf8');
}
(0, vitest_1.describe)('renderer view model', () => {
    (0, vitest_1.test)('HTML shell bootstraps the compiled renderer beside the page', () => {
        (0, vitest_1.expect)(source('index.html')).toContain('<script src="./renderer.js" defer></script>');
    });
    (0, vitest_1.test)('supports dragging the orb itself through the quota bridge', () => {
        const renderer = source('renderer.ts');
        (0, vitest_1.expect)(renderer).toContain('moveToY');
        (0, vitest_1.expect)(renderer).toContain('pointerdown');
        (0, vitest_1.expect)(renderer).toContain("window.addEventListener('pointermove'");
        (0, vitest_1.expect)(renderer).toMatch(/const onOrbPointerDown[\s\S]*?interaction = 'collapsed';[\s\S]*?renderInteraction/);
    });
    (0, vitest_1.test)('uses a compact 72 pixel floating orb', () => {
        const styles = source('styles.css');
        (0, vitest_1.expect)(styles).toContain('width: 72px');
        (0, vitest_1.expect)(styles).toContain('height: 72px');
    });
    (0, vitest_1.test)('provides a pale right-edge handle without a details-panel hide control', () => {
        const html = source('index.html');
        const styles = source('styles.css');
        const renderer = source('renderer.ts');
        (0, vitest_1.expect)(source('index.html')).not.toContain('data-action="hide-to-edge"');
        (0, vitest_1.expect)(source('renderer.ts')).not.toContain('onHideButton');
        (0, vitest_1.expect)(source('renderer.ts')).toContain("orb.addEventListener('dblclick'");
        (0, vitest_1.expect)(source('index.html')).toContain('data-action="restore-from-edge"');
        (0, vitest_1.expect)(html).toContain('aria-label="显示悬浮球"');
        (0, vitest_1.expect)(styles).toContain('width: 14px');
        (0, vitest_1.expect)(styles).toContain('height: 56px');
        (0, vitest_1.expect)(styles).toContain('width: 4px');
        (0, vitest_1.expect)(styles).toContain('height: 44px');
        (0, vitest_1.expect)(styles).toContain('rgba(255, 255, 255, 0.62)');
        (0, vitest_1.expect)(renderer).toContain('api.subscribeEdgeHidden');
        (0, vitest_1.expect)(renderer).toContain('api.setEdgeHidden(false)');
    });
    (0, vitest_1.test)('contains exactly one saturated purple weekly ring and no five-hour UI', () => {
        const html = source('index.html');
        const styles = source('styles.css');
        const renderer = source('renderer.ts');
        const viewModel = source('view-model.ts');
        const combined = `${html}\n${styles}\n${renderer}\n${viewModel}`;
        (0, vitest_1.expect)(html.match(/class="ring"/g)).toHaveLength(1);
        (0, vitest_1.expect)(html).toContain('data-window="weekly"');
        (0, vitest_1.expect)(html).toContain('Weekly quota');
        (0, vitest_1.expect)(styles.toLowerCase()).toContain('--accent: #8e5cff');
        (0, vitest_1.expect)(combined).not.toMatch(/5-hour|five-hour|fiveHour|innerRing|outerRing|ring--inner|ring--outer/i);
    });
    (0, vitest_1.test)('maps weekly remaining value to the only ring and center', () => {
        const model = (0, view_model_1.buildRendererViewModel)(state(), 1_700_000_000_000);
        (0, vitest_1.expect)(model.ringPercent).toBe(87);
        (0, vitest_1.expect)(model.centerText).toBe('87%');
        (0, vitest_1.expect)(model.weeklyText).toBe('87%');
    });
    (0, vitest_1.test)('shows loading text before the first weekly snapshot arrives', () => {
        const missingWeekly = { remainingPercent: null, resetsAt: null, windowDurationMins: null };
        (0, vitest_1.expect)((0, view_model_1.buildRendererViewModel)(state({
            status: 'loading', weekly: missingWeekly, lastUpdatedAt: null,
        }))).toMatchObject({
            centerText: '刷新中…', weeklyText: '刷新中…', weeklyCountdown: '刷新中…',
        });
    });
    (0, vitest_1.test)('shows connection failure text when the first weekly snapshot fails', () => {
        const missingWeekly = { remainingPercent: null, resetsAt: null, windowDurationMins: null };
        (0, vitest_1.expect)((0, view_model_1.buildRendererViewModel)(state({
            status: 'error', weekly: missingWeekly, lastUpdatedAt: null,
            errorMessage: '额度服务暂时无法连接',
        }))).toMatchObject({
            centerText: '连接失败', weeklyText: '连接失败', weeklyCountdown: '连接失败',
            note: '额度服务暂时无法连接',
        });
    });
    (0, vitest_1.test)('renders unavailable text and zero progress for a missing weekly window', () => {
        const model = (0, view_model_1.buildRendererViewModel)(state({ weekly: { remainingPercent: null, resetsAt: null, windowDurationMins: null } }), 1_700_000_000_000);
        (0, vitest_1.expect)(model.centerText).toBe('暂不可用');
        (0, vitest_1.expect)(model.weeklyText).toBe('暂不可用');
        (0, vitest_1.expect)(model.ringPercent).toBe(0);
        (0, vitest_1.expect)(model.weeklyCountdown).toBe('暂不可用');
    });
    (0, vitest_1.test)('formats the weekly reset countdown from epoch seconds', () => {
        (0, vitest_1.expect)((0, view_model_1.buildRendererViewModel)(state(), 1_700_000_000_000).weeklyCountdown).toBe('49h 0m');
    });
    (0, vitest_1.test)('formats the weekly reset as a compact local date below the countdown', () => {
        const resetsAt = new Date(2026, 7, 24, 16, 30).getTime() / 1_000;
        const model = (0, view_model_1.buildRendererViewModel)(state({
            weekly: { remainingPercent: 87, resetsAt, windowDurationMins: 10_080 },
        }));
        (0, vitest_1.expect)(model.weeklyResetAtText).toBe('26Y 08M 24D 16:30');
    });
    (0, vitest_1.test)('omits the absolute reset date when no reset timestamp is available', () => {
        const model = (0, view_model_1.buildRendererViewModel)(state({
            weekly: { remainingPercent: 87, resetsAt: null, windowDurationMins: 10_080 },
        }));
        (0, vitest_1.expect)(model.weeklyResetAtText).toBeNull();
    });
    (0, vitest_1.test)('renders the absolute reset date below the countdown and hides it when unavailable', () => {
        const renderWeeklyResetTiming = rendererModule.renderWeeklyResetTiming;
        (0, vitest_1.expect)(renderWeeklyResetTiming).toBeTypeOf('function');
        const countdown = { textContent: '' };
        const resetAt = { textContent: '', hidden: true };
        renderWeeklyResetTiming(countdown, resetAt, {
            weeklyCountdown: '49h 0m',
            weeklyResetAtText: '26Y 08M 24D 16:30',
        });
        (0, vitest_1.expect)(countdown.textContent).toBe('49h 0m');
        (0, vitest_1.expect)(resetAt).toEqual({ textContent: '26Y 08M 24D 16:30', hidden: false });
        renderWeeklyResetTiming(countdown, resetAt, {
            weeklyCountdown: '暂不可用',
            weeklyResetAtText: null,
        });
        (0, vitest_1.expect)(resetAt).toEqual({ textContent: '', hidden: true });
    });
    (0, vitest_1.test)('formats a localized last-updated timestamp for stale data', () => {
        (0, vitest_1.expect)((0, view_model_1.formatLastUpdatedAt)(1_700_000_000_000, 'en-US')).toMatch(/^最后更新于 \d{2}:\d{2}:\d{2}$/);
        const stale = (0, view_model_1.buildRendererViewModel)(state({ status: 'stale', errorMessage: 'Unable to refresh rate limits' }));
        (0, vitest_1.expect)(stale.lastUpdatedText).toMatch(/^最后更新于 \d{2}:\d{2}:\d{2}$/);
    });
    (0, vitest_1.test)('disables manual refresh while loading', () => {
        const model = (0, view_model_1.buildRendererViewModel)(state({ status: 'loading' }));
        (0, vitest_1.expect)(model.refreshDisabled).toBe(true);
        (0, vitest_1.expect)(model.note).toBe('正在刷新…');
        (0, vitest_1.expect)((0, view_model_1.buildRendererViewModel)(state({ status: 'ready' })).refreshDisabled).toBe(false);
    });
    (0, vitest_1.test)('enables Reset only when an unused reset credit is available', () => {
        (0, vitest_1.expect)((0, view_model_1.buildRendererViewModel)(state())).toMatchObject({
            resetCountText: '1',
            resetDisabled: false,
        });
        (0, vitest_1.expect)((0, view_model_1.buildRendererViewModel)(state({
            resetCredits: { credits: [], availableCount: 0 },
        }))).toMatchObject({
            resetCountText: '0',
            resetDisabled: true,
        });
        (0, vitest_1.expect)((0, view_model_1.buildRendererViewModel)(state({ isResetting: true }))).toMatchObject({
            resetCountText: '1',
            resetDisabled: true,
        });
    });
    (0, vitest_1.test)('consumes a reset credit only after confirmation', async () => {
        let resetCalls = 0;
        const api = {
            resetQuota: async () => {
                resetCalls += 1;
                return { outcome: 'reset' };
            },
        };
        await (0, vitest_1.expect)((0, renderer_1.requestQuotaReset)(api, () => false)).resolves.toBe(false);
        (0, vitest_1.expect)(resetCalls).toBe(0);
        await (0, vitest_1.expect)((0, renderer_1.requestQuotaReset)(api, () => true)).resolves.toBe(true);
        (0, vitest_1.expect)(resetCalls).toBe(1);
    });
    (0, vitest_1.test)('keeps the last weekly value visible for stale and error states', () => {
        const stale = (0, view_model_1.buildRendererViewModel)(state({ status: 'stale', errorMessage: 'Unable to refresh rate limits' }));
        const error = (0, view_model_1.buildRendererViewModel)(state({ status: 'error', errorMessage: 'Unable to refresh rate limits' }));
        (0, vitest_1.expect)(stale).toMatchObject({ ringPercent: 87, centerText: '87%', weeklyText: '87%' });
        (0, vitest_1.expect)(stale.note).toContain('Unable to refresh rate limits');
        (0, vitest_1.expect)(error).toMatchObject({ ringPercent: 87, centerText: '87%', weeklyText: '87%' });
    });
    (0, vitest_1.test)('uses loading text for the initial orb and weekly row', () => {
        const html = source('index.html');
        (0, vitest_1.expect)(html).toContain('<span class="orb-center" data-center>刷新中…</span>');
        (0, vitest_1.expect)(html).toContain('<span>Weekly</span><strong data-value="weekly">刷新中…</strong>');
        (0, vitest_1.expect)(html).toContain('<span data-countdown="weekly">刷新中…</span>');
        (0, vitest_1.expect)(html).toContain('<span class="reset-at" data-reset-at="weekly" hidden></span>');
    });
    (0, vitest_1.test)('uses loading text for the initial accessible status', () => {
        (0, vitest_1.expect)(source('index.html')).toContain('<p class="accessible-status" data-accessible-status aria-live="polite">Weekly 刷新中….</p>');
    });
});
