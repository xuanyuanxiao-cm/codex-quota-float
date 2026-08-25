"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDGE_HANDLE_SIZE = exports.NORMAL_WINDOW_SIZE = void 0;
exports.rightDockPosition = rightDockPosition;
exports.rightDockBounds = rightDockBounds;
exports.NORMAL_WINDOW_SIZE = { width: 286, height: 360 };
exports.EDGE_HANDLE_SIZE = { width: 14, height: 56 };
const NORMAL_ORB_CENTER_OFFSET_Y = 58;
function rightDockPosition(workArea, windowSize, requestedY, rightInset = 8) {
    const minimumY = workArea.y;
    const maximumY = Math.max(minimumY, workArea.y + workArea.height - windowSize.height);
    const centeredY = workArea.y + Math.round((workArea.height - windowSize.height) / 2);
    const y = Math.min(maximumY, Math.max(minimumY, Math.round(requestedY ?? centeredY)));
    return {
        x: workArea.x + workArea.width - windowSize.width - rightInset,
        y,
    };
}
function rightDockBounds(workArea, layout, normalY) {
    const size = layout === 'normal' ? exports.NORMAL_WINDOW_SIZE : exports.EDGE_HANDLE_SIZE;
    const requestedY = layout === 'normal'
        ? normalY
        : normalY === undefined
            ? undefined
            : normalY + NORMAL_ORB_CENTER_OFFSET_Y - Math.round(size.height / 2);
    const position = rightDockPosition(workArea, size, requestedY, layout === 'normal' ? 8 : 0);
    return { ...position, ...size };
}
