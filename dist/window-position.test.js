"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const window_position_1 = require("./window-position");
(0, vitest_1.describe)('rightDockPosition', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    const windowSize = { width: 286, height: 300 };
    (0, vitest_1.test)('places the floating window against the right edge and vertically centers it by default', () => {
        (0, vitest_1.expect)((0, window_position_1.rightDockPosition)(workArea, windowSize)).toEqual({ x: 1626, y: 370 });
    });
    (0, vitest_1.test)('keeps the floating window on the right edge and clamps a dragged vertical position', () => {
        (0, vitest_1.expect)((0, window_position_1.rightDockPosition)(workArea, windowSize, 1200)).toEqual({ x: 1626, y: 740 });
    });
    (0, vitest_1.test)('returns stable bounds for the normal floating window', () => {
        (0, vitest_1.expect)(window_position_1.NORMAL_WINDOW_SIZE).toEqual({ width: 286, height: 300 });
        (0, vitest_1.expect)((0, window_position_1.rightDockBounds)(workArea, 'normal', 370)).toEqual({
            x: 1626,
            y: 370,
            width: 286,
            height: 300,
        });
    });
    (0, vitest_1.test)('aligns the compact handle with the normal orb center at the screen edge', () => {
        (0, vitest_1.expect)(window_position_1.EDGE_HANDLE_SIZE).toEqual({ width: 14, height: 56 });
        (0, vitest_1.expect)((0, window_position_1.rightDockBounds)(workArea, 'edgeHidden', 370)).toEqual({
            x: 1906,
            y: 398,
            width: 14,
            height: 56,
        });
    });
    (0, vitest_1.test)('keeps the edge handle inside the work area', () => {
        (0, vitest_1.expect)((0, window_position_1.rightDockBounds)(workArea, 'edgeHidden', 2000).y).toBe(984);
    });
});
