'use strict';
(() => {
    const api = window.quota;
    const $ = id => document.getElementById(id);
    const time = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未检查';
    const titles = { reset: '额度重置动态', banked: '重置卡发放动态', limits: '额度上限调整动态', hint: '发现重置线索' };
    let state, selectedId, marking = false;
    function render(next) {
        state = next;
        $('enabled').checked = state.enabled;
        $('show-probability').checked = state.showProbability === true;
        $('check').disabled = state.loading || !state.enabled;
        $('check').textContent = state.loading ? '检查中…' : '立即检查';
        $('checked').textContent = `上次成功检查：${time(state.lastSuccessAt)}${state.enabled ? '' : ' · 已暂停'}`;
        const policy = state.policy || { mode: 'hourly', samples: 0 };
        const hour = utc => { const d = new Date(); d.setUTCHours(utc, 0, 0, 0); return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); };
        $('schedule').textContent = (policy.mode === 'adaptive' ? `较集中时段 ${hour(policy.startHourUTC)}–${hour(policy.startHourUTC + 4)}（本地时间）每 30 分钟检查，其他时段每 2 小时。${policy.samples} 组样本中有 ${policy.windowSamples} 组落在该时段。` : `历史样本不足或分布分散，暂按每小时检查。当前 ${policy.samples} 组样本。`) + (state.enabled ? ` 下次计划：${time(state.nextCheckAt)}。` : ' 已暂停自动检查。');
        $('error').hidden = !state.error; $('error').textContent = state.error || '';
        const forecast = state.forecast;
        const age = Date.now() - forecast?.asOf;
        const estimated = forecast?.status === 'estimated' && age >= 0 && age <= 21600000;
        $('forecast-value').textContent = state.unread ? '已宣布' : estimated ? `${forecast.percent}%` : '—';
        $('forecast-note').textContent = state.unread ? '有新的已核验公告，账户生效情况待确认' : estimated ? `实验性估计 · ${time(forecast.asOf)} 更新` : `暂无法估计 · ${age > 21600000 ? '数据超过 6 小时未更新' : forecast?.reason || '等待数据'}`;
        $('forecast-basis-text').textContent = estimated ? `按最近收录记录划分 ${forecast.days} 个完整的 24 小时窗口，其中 ${forecast.positive} 个窗口收录了额外重置公告。相邻 6 小时内的帖子粗略合并，共 ${forecast.samples} 组。采用平滑频率（有公告的窗口数 + 1）÷（总窗口数 + 2），显示整数百分比。` : '至少需要 14 个完整日窗口和 12 组历史记录；数据超过 6 小时未更新时暂停显示百分比。';
        const record = state.records.find(r => r.id === selectedId) || state.records[0];
        selectedId = record?.id;
        $('status').textContent = record ? record.verified ? '≡ 已宣布' : '◇ 待核实' : '暂无新动态';
        $('status').className = `tag${record?.verified ? ' verified' : ''}`;
        $('title').textContent = record ? titles[record.kind] || titles.hint : '暂无重置消息';
        $('published').textContent = record ? `发布于 ${time(record.publishedAt)}` : '';
        $('summary').textContent = !record ? '下一次额外重置暂无明确时间。' : !record.verified ? '第三方记录收录了相关消息，原帖尚未核实，不能确认重置会发生。' : record.kind === 'banked' ? '原帖包含重置卡相关公告。请查看原文中的适用范围与条件；赠送重置卡不等于立即恢复额度。' : record.kind === 'limits' ? '原帖包含额度上限调整消息。请查看原文中的适用套餐与生效条件。' : '原帖包含明确的额度重置消息。适用范围与生效时间请查看原文，账户状态单独检查。';
        $('source').textContent = record ? `Tibo · @thsottiaux ／ ${record.verified ? '原帖已读取核验' : '来源：recodex.lol（第三方）'}` : '';
        $('original').hidden = !record; $('quote-wrap').hidden = !record;
        $('quote').textContent = record?.text || '';
        const account = state.account;
        const recovered = Object.entries(state.recoveries || {}).filter(([key, r]) => !(key === 'fiveHour' && account?.hasFiveHour === false) && record && r.at >= record.publishedAt && Date.now() - r.at < 86400000);
        const labels = { fiveHour: '5 小时', weekly: '每周' };
        $('account-status').className = !account?.stale && recovered.length ? 'recovered' : '';
        $('account-status').textContent = !account ? '等待额度数据' : account.stale ? '额度暂未更新，以下为上次读数' : recovered.length ? recovered.map(([key, r]) => `✓ ${labels[key]}额度于 ${time(r.at)} 恢复`).join('；') : '暂未检测到额度恢复';
        const percent = value => Number.isFinite(value) ? `${Math.round(value)}%` : '未知';
        $('account-values').textContent = account ? `${account.hasFiveHour === false ? '' : `5 Hours ${percent(account.fiveHour)}　·　`}Weekly ${percent(account.weekly)}` : '';
        $('account-note').textContent = account ? `额度更新：${time(account.updatedAt)}。${recovered.length ? '恢复可能来自正常周期、手动用卡或额外重置，不能据此确定原因。' : '尚未观察到恢复不等于未到账；首次读取不能判断此前变化。'}` : '公告已宣布不代表本账户已到账。';
        $('history').replaceChildren(...state.records.map(r => {
            const button = document.createElement('button'); button.className = 'history-item';
            button.setAttribute('aria-pressed', String(r.id === selectedId));
            button.textContent = `${r.verified ? '≡ 已宣布' : '◇ 待核实'} · ${titles[r.kind] || titles.hint}`;
            const stamp = document.createElement('small'); stamp.textContent = time(r.publishedAt); button.append(stamp);
            button.addEventListener('click', () => { selectedId = r.id; render(state); }); return button;
        }));
        $('history-count').textContent = `${state.records.length} 条 · 点击展开`;
        if (state.unread && document.hasFocus() && !marking) {
            marking = true; api.markNoticesRead().finally(() => { marking = false; });
        }
    }
    $('check').addEventListener('click', async () => {
        if (state?.lastAttemptAt && Date.now() - state.lastAttemptAt < 60000) {
            $('error').hidden = false; $('error').textContent = '刚刚已检查，请间隔一分钟后再试。'; return;
        }
        try { render(await api.refreshNotices()); } catch { $('error').hidden = false; $('error').textContent = '公告检查失败，请重试。'; }
    });
    $('enabled').addEventListener('change', async () => { render(await api.enableNotices($('enabled').checked)); });
    $('show-probability').addEventListener('change', async () => { render(await api.showProbability($('show-probability').checked)); });
    $('original').addEventListener('click', () => { if (selectedId) void api.openNoticeSource(selectedId); });
    $('refresh-account').addEventListener('click', async () => {
        $('refresh-account').disabled = true;
        try { await api.refreshNow(); } finally { $('refresh-account').disabled = false; }
    });
    window.addEventListener('focus', () => { if (state?.unread) void api.markNoticesRead(); });
    api.subscribeNotices(render);
    api.readNotices().then(render).catch(() => { $('error').hidden = false; $('error').textContent = '无法读取公告记录，请重新打开窗口。'; });
    window.setInterval(() => { if (state) render(state); }, 60000);
})();
