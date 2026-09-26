'use strict';
(() => {
    const api = window.quota;
    const $ = id => document.getElementById(id);
    const time = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未检查';
    const titles = { reset: '额度重置公告', banked: '重置卡发放公告', limits: '额度上限调整', hint: '重置相关动态' };
    const stage = r => r.kind === 'hint' ? '相关线索' : r.kind === 'limits' ? '上限调整' : r.stage === 'completed' ? r.kind === 'banked' ? '已发卡' : '已执行' : '已预告';
    const status = r => r.verified ? `${stage(r)} · 原帖已核验` : r.verificationStatus === 'rejected' ? '未确认公告 · 原帖已读取' : '社区收录 · 待核验';
    let state, selectedId;
    function render(next) {
        state = next;
        $('enabled').checked = state.enabled;
        $('show-probability').checked = state.showProbability === true;
        $('check').disabled = state.loading || !state.enabled;
        $('check').textContent = state.loading ? '检查中…' : '立即检查';
        $('checked').textContent = `社区数据：${time(state.forecast?.asOf)}${state.enabled ? '' : ' · 已暂停'}`;
        $('schedule').textContent = `正常每 10 分钟读取社区接口，失败时逐步延长至 1 小时。${state.enabled ? `下次计划：${time(state.nextCheckAt)}。` : '已暂停自动检查。'}`;
        $('error').hidden = !state.error; $('error').textContent = state.error || '';
        const presentation = window.noticePresentation(state);
        $('forecast-heading').textContent = presentation.heading;
        $('forecast-value').textContent = presentation.value;
        $('forecast-note').textContent = presentation.note;
        $('forecast-basis-text').textContent = `上游计算时间：${time(state.forecast?.asOf)}。接口最近读取：${time(state.lastSuccessAt)}。`;
        const record = state.records.find(r => r.id === selectedId) || state.records.find(r => r.id === state.activeNotice?.id) || state.records[0];
        selectedId = record?.id;
        const unseen = state.records.filter(r => r.verified && !r.read && r.id !== selectedId);
        $('new-notice').hidden = !unseen.length;
        $('new-notice').textContent = `查看 ${unseen.length} 条新公告`;
        $('status').textContent = record ? status(record) : '暂无新动态';
        $('status').className = `tag${record?.verified ? ' verified' : ''}`;
        $('title').textContent = record ? titles[record.kind] || titles.hint : '下一次额外重置，暂无明确时间';
        $('published').textContent = record ? `收录事件时间：${time(record.publishedAt)}` : '';
        $('summary').textContent = !record ? '目前没有收录的重置公告。' : record.verificationStatus === 'rejected' ? '读取到的原帖不足以确认重置或发卡，保留为相关动态。' : !record.verified ? '以下为社区收录的信息，本应用尚未核验原帖；社区的执行记录不代表本账户已到账。' : record.kind === 'banked' ? '原帖包含发卡消息；需要手动使用重置卡，发卡不等于额度已恢复。' : record.kind === 'limits' ? '原帖包含额度上限调整消息，不将其显示为重置公告。' : record.stage === 'announced' ? '原帖已预告重置。具体适用范围与生效时间请查看原文，账户状态单独确认。' : '原帖表示已执行重置，本账户生效情况仍以账户读数为准。';
        $('source').textContent = record ? `Tibo · @thsottiaux ／ ${record.verified ? '本地原帖核验通过' : record.source === 'legacy' ? '旧版历史 · 待重新核验' : 'Codex Reset Observatory（社区）'}` : '';
        $('original').hidden = !record; $('quote-wrap').hidden = !record;
        $('quote-label').textContent = record?.originalText ? '查看读取到的原帖' : '查看社区收录内容';
        $('quote').textContent = record?.originalText || record?.text || '';
        $('mark-read').hidden = !record?.verified;
        $('mark-read').disabled = record?.read !== false;
        $('mark-read').textContent = record?.read === false ? '标记已读' : '已读';
        const account = state.account;
        const recovered = Object.entries(state.recoveries || {}).filter(([key, r]) => !(key === 'fiveHour' && account?.hasFiveHour === false) && Date.now() - r.at < 86400000);
        const arrival = state.cardArrival && Date.now() - state.cardArrival.at < 86400000 ? state.cardArrival : null;
        const labels = { fiveHour: '5 小时', weekly: '每周' };
        $('account-status').className = !account?.stale && (recovered.length || arrival) ? 'recovered' : '';
        $('account-status').textContent = !account ? '等待额度数据' : account.stale ? '额度暂未更新，以下为上次读数' : arrival ? `✓ ${time(arrival.at)} 观察到新增 ${arrival.count} 张重置卡` : recovered.length ? recovered.map(([key, r]) => `✓ ${labels[key]}额度于 ${time(r.at)} 回升`).join('；') : '尚未观察到额度恢复或新卡到账';
        const percent = value => Number.isFinite(value) ? `${Math.round(value)}%` : '未知';
        $('account-values').textContent = account ? `${account.hasFiveHour === false ? '' : `5 Hours ${percent(account.fiveHour)}　·　`}Weekly ${percent(account.weekly)}　·　重置卡 ${account.credits ?? '未知'}` : '';
        $('account-note').textContent = account ? `额度更新：${time(account.updatedAt)}。${recovered.length || arrival ? '仅记录读数变化，不能据此确定由本次公告触发；新卡需手动使用。' : '首次读取不能判断此前变化，尚未观察到恢复不等于未到账。'}` : '公告和账户状态分别记录。';
        $('history').replaceChildren(...state.records.map(r => {
            const button = document.createElement('button'); button.className = 'history-item';
            button.setAttribute('aria-pressed', String(r.id === selectedId));
            button.textContent = `${r.verified && !r.read ? '未读 · ' : ''}${status(r)} · ${titles[r.kind] || titles.hint}`;
            const stamp = document.createElement('small'); stamp.textContent = time(r.publishedAt); button.append(stamp);
            button.addEventListener('click', () => { selectedId = r.id; render(state); }); return button;
        }));
        $('history-count').textContent = `${state.records.length} 条 · 点击展开`;
        const fresh = state.forecast?.healthy && Date.now() - state.forecast.asOf <= 21600000;
        $('community-health').textContent = `社区接口：${state.error || (fresh ? '正常' : '数据过期或尚不可用')} · ${time(state.lastSuccessAt)}`;
        const verification = { verified: '通过', rejected: '未确认公告', unreadable: '页面结构不可识别', 'network-error': '网络失败，等待重试' };
        $('verification-health').textContent = `当前原帖核验：${!state.verificationEnabled ? '未配置 FIRECRAWL_API_KEY，保留为社区收录' : verification[record?.verificationStatus] || '等待核验'}${record?.nextVerificationAt ? ` · 重试不早于 ${time(record.nextVerificationAt)}` : ''}`;
    }
    $('check').addEventListener('click', async () => {
        if (state?.lastAttemptAt && Date.now() - state.lastAttemptAt < 600000) {
            $('error').hidden = false; $('error').textContent = '社区数据每 10 分钟更新，请稍后再检查。'; return;
        }
        try { render(await api.refreshNotices()); } catch { $('error').hidden = false; $('error').textContent = '公告检查失败，请重试。'; }
    });
    $('enabled').addEventListener('change', async () => { render(await api.enableNotices($('enabled').checked)); });
    $('show-probability').addEventListener('change', async () => { render(await api.showProbability($('show-probability').checked)); });
    $('original').addEventListener('click', () => { if (selectedId) void api.openNoticeSource(selectedId); });
    $('new-notice').addEventListener('click', () => { selectedId = state.records.find(r => r.verified && !r.read && r.id !== selectedId)?.id; render(state); });
    $('mark-read').addEventListener('click', async () => {
        try { render(await api.markNoticeRead(selectedId)); } catch { $('error').hidden = false; $('error').textContent = '未能标记已读，请重试。'; }
    });
    $('refresh-account').addEventListener('click', async () => {
        $('refresh-account').disabled = true;
        try { await api.refreshNow(); } catch { $('error').hidden = false; $('error').textContent = '账户刷新失败，请稍后重试。'; }
        finally { $('refresh-account').disabled = false; }
    });
    api.subscribeNotices(render);
    api.readNotices().then(render).catch(() => { $('error').hidden = false; $('error').textContent = '无法读取公告记录，请重新打开窗口。'; });
    window.setInterval(() => { if (state) render(state); }, 60000);
})();
