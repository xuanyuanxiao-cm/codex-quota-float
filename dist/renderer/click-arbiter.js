"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClickArbiter = createClickArbiter;
function createClickArbiter(onSingleClick, delayMs = 220) {
    let timer;
    const cancelSingle = () => {
        if (timer !== undefined)
            clearTimeout(timer);
        timer = undefined;
    };
    return {
        scheduleSingle() {
            cancelSingle();
            timer = setTimeout(() => {
                timer = undefined;
                onSingleClick();
            }, delayMs);
        },
        cancelSingle,
        dispose: cancelSingle,
    };
}
