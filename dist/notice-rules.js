'use strict';
function classifyPost(value) {
    const text = String(value || '').replace(/’/g, "'");
    const hint = { kind: 'hint', stage: 'hint' };
    const clauses = text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
    if (clauses.length > 1) {
        const results = clauses.map(classifyPost);
        return results.findLast(r => ['reset', 'banked'].includes(r.kind)) || results.find(r => r.kind !== 'unrelated') || results[0];
    }
    if (/\b(?:password|router|configuration|config|factory reset|reset your device)\b/i.test(text) && !/\b(?:quota|usage limits|banked|credits?)\b/i.test(text)) return { kind: 'unrelated', stage: 'hint' };
    const reset = /\bresets?\b|\bresetting\b|重置/i.test(text);
    const product = /\bcodex\b|\bchatgpt(?: work)?\b/i.test(text);
    const banked = /\bbanked resets?\b|\breset (?:cards?|credits?)\b|重置卡/i.test(text);
    if (!reset) {
        if (product && /\b(?:outage|disruption|down|interruption|incident|sorry|apolog\w*|back in action|restored|recovered)\b|服务器中断|故障|恢复服务/i.test(text)) return { kind: 'service', stage: 'hint' };
        if (product && /\b(?:usage|rate) limits?\b|\bquota\b/i.test(text)) return { kind: 'limits', stage: 'announced' };
        return { kind: 'unrelated', stage: 'hint' };
    }
    if (/\b(?:cancelled|canceled|called off)\b|已取消/i.test(text) && !/\?|\b(?:not|isn't|wasn't|if|might)\b/i.test(text)) return { kind: banked ? 'banked' : 'reset', stage: 'cancelled' };
    if (/\?|\b(?:if|unless|might|maybe|could|would|not|never|won't|isn't|aren't|cannot|can't|hope|wish|want|rumor|rumour)\b|\bno\s+(?:\w+\s+){0,3}resets?\b|不会|不重置|是否|可能/i.test(text)) return hint;
    if (/\b(?:expire|expires|expiration|expiry|valid|how to|every (?:day|week|month))\b|有效期|使用规则/i.test(text)) return { kind: 'limits', stage: 'announced' };
    const kind = banked ? 'banked' : 'reset';
    if (/\b(?:will|we'll|going to|coming|tomorrow|next week|later today|by midnight|soon)\b|即将|下周|明天/i.test(text)) return { kind, stage: 'announced' };
    if (/\b(?:resetting|rolling out|in progress|propagating)\b|正在重置/i.test(text)) return { kind, stage: 'in-progress' };
    if (/\bresets?\b.{0,40}\b(?:completed|propagated|done)\b|\b(?:limits|quota)\b.{0,40}\b(?:have been|has been|were|was|are) reset\b|\bwe(?:'ve| have)?\s+reset\b|已完成|已发放/i.test(text) ||
        banked && /\b(?:sent|added|granted|distributed|issued|gave)\b.{0,80}\b(?:banked reset|reset credit)|\b(?:banked resets?|reset credits?)\b.{0,40}\b(?:sent|added|granted|distributed|issued)\b/i.test(text)) return { kind, stage: 'completed' };
    if (banked && /\b(?:giving|sending|issuing|distributing)\b/i.test(text)) return { kind, stage: 'announced' };
    return hint;
}
function messagePriority(record) {
    if (record.kind === 'arrival') return 1;
    if (['reset', 'banked', 'limits'].includes(record.kind)) return 0;
    return record.kind === 'service' ? 3 : 2;
}
function explicitDeadline(text) {
    const match = text.match(/\b(?:by|before|until)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))/i);
    const value = match ? Date.parse(match[1]) : NaN;
    return Number.isFinite(value) ? value : null;
}
module.exports = { classifyPost, messagePriority, explicitDeadline };
