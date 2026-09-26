'use strict';
// Shared by both windows so reading an announcement never changes its business state.
function noticePresentation(state, now = Date.now()) {
    const forecast = state.forecast;
    const fresh = forecast && Number.isFinite(forecast.asOf) && now >= forecast.asOf - 60000 && now - forecast.asOf <= 21600000 && forecast.healthy && !state.error;
    const active = fresh && state.activeNotice;
    if (active) {
        const banked = active.kind === 'banked';
        const value = active.stage === 'completed' ? banked ? '已发放重置卡' : '已执行重置' : banked ? '已有发卡预告' : '已有重置预告';
        return { value, tag: active.verified ? banked ? '发卡已公告' : '重置已公告' : active.stage === 'completed' ? banked ? '社区记录发卡' : '社区记录重置' : '社区收录预告', heading: '额外重置 · 公告进展',
            note: `${active.verified ? '原帖已核验' : '社区记录 · 进展待核实'} · ${banked ? '需要手动用卡' : '账户生效情况待确认'}` };
    }
    if (fresh && Number.isFinite(forecast.percent)) return { value: `${forecast.percent}%`, tag: `社区 ${forecast.percent}%`, heading: '社区预测 · 未来 24h', note: '实验性估计 · 不代表本账户到账' };
    return { value: '—', tag: '预测待更新', heading: '社区预测 · 未来 24h', note: state.error || (forecast?.asOf ? '数据过期或来源异常 · 暂停显示概率' : '等待社区数据') };
}
if (typeof module !== 'undefined') module.exports = { noticePresentation };
if (typeof window !== 'undefined') window.noticePresentation = noticePresentation;
