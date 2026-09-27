"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDGE_HANDLE_SIZE = exports.COLLAPSED_WINDOW_SIZE = exports.NORMAL_WINDOW_SIZE = void 0;
exports.rightDockPosition = rightDockPosition;
exports.rightDockBounds = rightDockBounds;
exports.createWindowShape = createWindowShape;
exports.NORMAL_WINDOW_SIZE = { width: 286, height: 360 };
exports.COLLAPSED_WINDOW_SIZE = { width: 100, height: 100 };
exports.EDGE_HANDLE_SIZE = { width: 14, height: 56 };
const NORMAL_ORB_CENTER_OFFSET_Y = 58;
const COLLAPSED_ORB_CENTER_OFFSET_Y = 50;
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
function rightDockBounds(workArea, layout, normalY, contentHeight) {
    const expanded = layout === 'normal' || layout === 'picker';
    const size = expanded ? { width: exports.NORMAL_WINDOW_SIZE.width, height: Math.min(contentHeight ?? exports.NORMAL_WINDOW_SIZE.height, workArea.height) } : layout === 'collapsed' || layout === 'summary' ? { width: layout === 'summary' ? exports.NORMAL_WINDOW_SIZE.width : exports.COLLAPSED_WINDOW_SIZE.width, height: Math.max(100, Math.min(contentHeight ?? 100, workArea.height)) } : exports.EDGE_HANDLE_SIZE;
    const requestedY = expanded
        ? normalY
        : normalY === undefined
            ? undefined
            : normalY + NORMAL_ORB_CENTER_OFFSET_Y - (layout === 'collapsed' || layout === 'summary' ? COLLAPSED_ORB_CENTER_OFFSET_Y : Math.round(size.height / 2));
    const position = rightDockPosition(workArea, size, requestedY, layout === 'edgeHidden' ? 0 : 8);
    return { ...position, ...size };
}
function createWindowShape(regions) {
    const shape = [];
    for (const region of regions) {
        const radius = Math.min(region.radius, region.width / 2, region.height / 2);
        const bottom = region.y + region.height;
        for (let y = Math.floor(region.y); y < Math.ceil(bottom); y += 1) {
            const distance = Math.max(0, region.y + radius - (y + 0.5), (y + 0.5) - (bottom - radius));
            const inset = radius - Math.sqrt(Math.max(0, radius * radius - distance * distance));
            const x = Math.floor(region.x + inset);
            const width = Math.ceil(region.x + region.width - inset) - x;
            const previous = shape[shape.length - 1];
            if (previous && previous.x === x && previous.width === width && previous.y + previous.height === y) {
                previous.height += 1;
            }
            else {
                shape.push({ x, y, width, height: 1 });
            }
        }
    }
    return shape;
}
