'use strict';
// Shared by both windows so reading an announcement never changes its business state.
function noticePresentation(state, now = Date.now()) {
    const DAY = 86400000;
    const records = (state.records || []).filter(r => r.verified && ['reset', 'banked', 'arrival'].includes(r.kind) && ['announced', 'in-progress', 'completed', 'cancelled'].includes(r.stage));
    // Only collapse explicitly linked events. Similar words or adjacent dates are not identity.
    const latest = new Map();
    for (const r of records) {
        const key = r.eventId || r.id;
        if (!latest.has(key) || (r.changedAt || r.publishedAt) > (latest.get(key).changedAt || latest.get(key).publishedAt)) latest.set(key, r);
    }
    const expires = r => Number.isFinite(r.deadlineAt) ? r.deadlineAt + DAY : (r.changedAt || r.publishedAt) +
        (r.stage === 'announced' ? (/\bnext week\b|下周/i.test(r.originalText || r.text) ? 14 : 2) : 1) * DAY;
    const candidates = [...latest.values()].filter(r => Number.isFinite(r.publishedAt) && r.publishedAt <= now + 60000 && expires(r) > now &&
        (r.kind !== 'arrival' || !r.accountKey || r.accountKey === state.account?.accountKey));
    candidates.sort((a, b) => Number(b.stage === 'announced') - Number(a.stage === 'announced') || (b.changedAt || b.publishedAt) - (a.changedAt || a.publishedAt));
    const local = candidates[0];
    if (local) {
        const banked = local.kind === 'banked', event = banked ? '发卡' : '重置';
        const pending = local.stage === 'announced' && Number.isFinite(local.deadlineAt) && now > local.deadlineAt;
        const tag = local.kind === 'arrival' ? '新增重置卡' : pending ? `${event}待确认` : local.stage === 'cancelled' ? '预告已取消' : local.stage === 'completed' ? `原帖称已${event}` : local.stage === 'in-progress' ? `原帖称${event}中` : `${event}预告`;
        const note = local.kind === 'arrival' ? `本次检查发现 ${local.count} 张新增重置卡` : local.chineseText && local.translationOriginalText === local.originalText ? local.chineseText : local.originalText || local.text;
        const explanation = pending ? '预告期限已过，尚未取得完成证据；不认定已完成或取消。' : local.kind === 'arrival' ? '记录检查发现时间，不推断准确到账时间。' : `${note}。具体日期、适用范围与方式以原文为准，未明确部分不作推断。`;
        return { recordId: local.id, tone: pending || local.stage === 'cancelled' ? 'orange' : local.kind === 'arrival' ? 'green' : 'blue',
            tag, value: tag, detailTitle: tag, heading: local.kind === 'arrival' ? '账户检测' : 'Tibo 原帖 · 已读取', note, explanation,
            evidence: [['消息依据', note], [local.scope ? '社区收录范围' : '时间与范围', local.scope || '未明确部分请查看原帖；无精确倒计时']],
            accountNote: local.kind === 'arrival' || banked ? '新卡需手动使用，发卡不等于额度恢复。' : '公告不代表本账户已生效，以账户实际读数为准。' };
    }
    const forecast = state.forecast;
    const fresh = forecast && Number.isFinite(forecast.asOf) && now >= forecast.asOf - 60000 && now - forecast.asOf <= 21600000 && forecast.healthy && !state.error;
    const active = fresh && state.activeNotice && !state.records?.some(r => state.activeNotice.id && r.id === state.activeNotice.id && r.verified && Number.isFinite(r.publishedAt)) && state.activeNotice;
    if (active) {
        const banked = active.kind === 'banked';
        const completed = active.stage === 'completed';
        const event = banked ? '发卡' : '重置';
        const record = state.records?.find(r => active.id && r.id === active.id);
        const originalVerified = active.verified || (record?.verified && record.kind === active.kind);
        const originalStage = record?.verified ? record.stage : active.stage;
        const original = originalVerified ? originalStage === 'completed' ? `明确表示已${banked ? '发放重置卡' : '完成重置'}` : `明确预告将${banked ? '发放重置卡' : '重置额度'}` : '尚未通过原帖确认对应进展';
        const mismatch = originalVerified && originalStage !== active.stage;
        const value = completed ? `${active.verified ? '原帖' : '社区'}称已${event}` : banked ? '已有发卡预告' : '已有重置预告';
        const explanation = mismatch && completed ? `社区报告已${event}，原帖只确认了预告，还没有确认${banked ? '已经发放' : '已经完成'}。`
            : mismatch ? '社区与原帖记录的阶段不同，请分别查看下方依据。'
            : active.verified ? completed ? `原帖与社区记录均指向${event}已完成，本账户是否生效仍需单独确认。` : `原帖说的是“将${event}”，目前不能据此认定已经${banked ? '发放' : '执行'}。`
            : `这是社区收录的${completed ? '完成记录' : '预告'}，本应用尚未通过原帖确认这一进展。`;
        return { recordId: record?.id, value, detailTitle: active.verified ? completed ? `Tibo 表示已${event}` : `Tibo 预告将${event}` : completed ? `社区报告已${event}` : `社区收录${event}预告`,
            tag: active.verified ? completed ? `原帖称已${event}` : `${event}预告` : completed ? `社区称已${event}` : `社区预告${event}`,
            heading: active.verified ? 'Tibo 原帖 · 已读取' : '社区消息 · 进展待核实',
            note: `${active.verified ? '原帖已读取' : '社区记录 · 进展待核实'} · ${banked ? '需要手动用卡' : '账户生效情况待确认'}`,
            explanation, evidence: [['社区记录', completed ? `报告已${banked ? '发放重置卡' : '执行重置'}` : `收录${event}预告`], ['Tibo 原帖', original]],
            accountNote: banked ? '是否收到新卡需看账户记录；收到后仍需手动使用，发卡不等于额度恢复。' : '你的额度是否恢复，需要看账户实际变化；公告本身不代表本账户已生效。' };
    }
    if (fresh && Number.isFinite(forecast.percent)) return { value: `${forecast.percent}%`, detailTitle: `未来 24 小时概率约 ${forecast.percent}%`, tag: `预测 · ${forecast.percent}%`, tone: 'neutral', heading: '社区预测 · 未来 24 小时额外重置或发卡', note: '实验性估计 · 不代表本账户到账',
        explanation: '这是社区对额外重置或发卡事件的估计，不是你的额度剩余比例。', evidence: [['预测来源', '社区模型（非官方）'], ['事件进展', '暂无可显示的有效预告或近期完成记录']], accountNote: '这不是你的账户恢复额度或收到卡的概率。' };
    const reason = state.error || (!forecast?.asOf ? '尚未取得社区数据' : !forecast.healthy ? '社区来源异常或数据已过期' : now - forecast.asOf > 21600000 ? '社区数据超过 6 小时未更新' : '社区数据时间或概率无效');
    return { value: '—', detailTitle: '暂时无法预测', tag: '预测待更新', heading: '社区预测 · 待更新', note: `${reason} · 暂停显示概率`,
        explanation: `${reason}，暂不展示概率和事件进展。`, evidence: [['数据状态', reason], ['当前处理', '等待重新获取有效数据']], accountNote: '这不代表没有重置机会，也不影响查看账户额度。' };
}
if (typeof module !== 'undefined') module.exports = { noticePresentation };
if (typeof window !== 'undefined') window.noticePresentation = noticePresentation;
