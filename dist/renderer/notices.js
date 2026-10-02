'use strict';
(() => {
    const api = window.quota;
    const $ = id => document.getElementById(id);
    const time = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未检查';
    const titles = { reset: '额度重置消息', banked: '重置卡消息', limits: '额度与重置卡规则', hint: '重置相关讨论', service: '服务动态', arrival: '账户新增重置卡' };
    const stage = r => r.stage === 'cancelled' ? '已取消' : r.stage === 'in-progress' ? '进行中' : r.kind === 'hint' ? '相关讨论 · 非明确承诺' : r.kind === 'service' ? '服务动态' : r.kind === 'limits' ? '规则信息' : r.stage === 'completed' ? r.kind === 'banked' ? '已发卡' : '已完成' : '已预告';
    const status = r => r.kind === 'arrival' ? '账户检查发现' : r.verified ? `${stage(r)} · 原帖已核验` : r.verificationStatus === 'rejected' ? '原帖已读取 · 待重新分类' : '社区收录 · 待核验';
    let state, selectedId, checking = false, filter = 'all', shownId, translating = false;
    const put = (id, value) => window.readerText($(id), value);
    const reader = new window.MessageReader($('history'), r => [(r.chineseText && r.translationOriginalText === r.originalText ? r.chineseText : r.originalText || r.text || titles[r.kind] || titles.hint).replace(/\s+/g, ' ').slice(0, 64),
        `${r.verified && !r.read ? '未读 · ' : ''}${status(r)} · ${time(r.publishedAt)}`
    ], id => { selectedId = id; window.openMessageDetail(); render(state); });
    function renderCheck() {
        if (!state) return;
        const loading = checking || state.loading;
        const failed = state.failures > 0;
        const seconds = Math.max(0, Math.ceil((state.manualCheckAt - Date.now()) / 1000));
        const countdown = seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒` : `${seconds} 秒`;
        $('check').disabled = loading || seconds > 0;
        $('check').textContent = loading ? '正在检查…' : seconds ? `${countdown}后可${failed ? '重试' : '检查'}` : failed ? '立即重试' : '立即检查';
        $('sync-status').textContent = loading ? '正在获取最新动态' : failed ? '更新失败' : '';
        $('sync-status').hidden = !$('sync-status').textContent;
        $('sync-mode').textContent = state.enabled ? '自动检查开启' : '自动检查已暂停';
        $('sync-panel').classList.toggle('failed', failed && !loading);
        $('sync-reason').textContent = loading ? '正在检查社区动态与公告，请稍候。' : failed ? `保留上次读取结果。${seconds ? '短暂等待后可手动重试。' : '现在可以手动重试。'}` : !state.enabled && !seconds ? '后台定时检查已暂停，你仍可手动检查。' : '';
        $('sync-reason').hidden = !$('sync-reason').textContent;
        $('sync-last').textContent = `最近检查：${time(state.lastAttemptAt)}；上次成功：${time(state.lastSuccessAt)}`;
        $('sync-next').textContent = state.enabled ? `${failed ? '自动重试' : '下次检查'}：${time(state.nextCheckAt)}` : '自动检查已暂停';
        put('sync-summary', `${loading ? '正在检查' : failed ? '更新失败，保留本地内容' : '最近同步'} · ${time(state.lastSuccessAt)}${state.enabled ? ` · 下次 ${time(state.nextCheckAt)}` : ' · 自动检查已暂停'}`);
        const record = reader.selected(), wait = Math.max(0, Math.ceil(((record?.lastTranslationAttemptAt || 0) + 60000 - Date.now()) / 1000));
        $('translate-notice').disabled = translating || Boolean(state.translatingId) || wait > 0;
        put('translate-notice', translating || state.translatingId === record?.id ? '正在翻译…' : wait ? `${wait} 秒后可重试` : '重试翻译');
    }
    function render(next) {
        state = next;
        reader.accept(state.records);
        if (selectedId && state.records.some(r => r.id === selectedId)) { reader.selectedId = selectedId; if (!reader.ids.includes(selectedId)) reader.ids.unshift(selectedId); }
        $('enabled').checked = state.enabled;
        $('show-probability').checked = state.showProbability === true;
        renderCheck();
        $('checked').textContent = `社区数据：${time(state.forecast?.asOf)}`;
        $('schedule').textContent = `自动每 30 分钟检查一次，手动检查间隔 10 分钟；失败后 30 秒可手动重试，自动重试间隔延长至 1 小时。${state.enabled ? '' : '已暂停自动检查，仍可手动检查。'}`;
        $('error').hidden = !state.error; $('error').textContent = state.error || '';
        const presentation = window.noticePresentation(state);
        $('forecast-heading').textContent = presentation.heading;
        $('forecast-value').textContent = presentation.detailTitle;
        $('forecast-note').textContent = presentation.explanation;
        $('forecast-evidence').replaceChildren(...presentation.evidence.map(([label, text]) => {
            const row = document.createElement('div'), term = document.createElement('dt'), description = document.createElement('dd');
            term.textContent = label; description.textContent = text; row.append(term, description); return row;
        }));
        $('forecast-account-note').textContent = presentation.accountNote;
        $('forecast-basis-text').textContent = `上游计算时间：${time(state.forecast?.asOf)}。接口最近读取：${time(state.lastSuccessAt)}。`;
        const record = reader.selected();
        selectedId = record?.id;
        if (shownId !== selectedId) { $('quote-wrap').open = false; $('notice-context').open = false; shownId = selectedId; }
        const unseen = reader.pending();
        $('new-notice').hidden = !unseen.length;
        put('new-notice', `新增 ${unseen.length} 条消息 · 点击查看`);
        $('status').textContent = record ? status(record) : '暂无新动态';
        $('status').className = `tag${record?.verified ? ' verified' : ''}`;
        put('title', record ? titles[record.kind] || titles.hint : '暂无收录消息');
        $('published').textContent = record ? `${record.kind === 'arrival' ? '检查发现时间' : record.timestampBasis === 'archive-event' ? '存档事件时间（原帖发布时间未核实）' : '收录发布时间'}：${time(record.publishedAt)}` : '';
        const summaries = { hint: '这是重置相关讨论，包含疑问、否定或条件时，不解释为明确承诺。', service: '服务故障、恢复或致歉不等于承诺补偿，不自动提高预测概率。', limits: '额度或重置卡规则信息，不等同于一次重置。', arrival: record?.text };
        $('summary').textContent = !record ? '目前没有收录的相关消息。' : !record.verified ? '社区收录，尚未核验原帖；来源有覆盖缺口，不能据此确认你的账户已到账。' : summaries[record.kind] || (record.stage === 'cancelled' ? '安排已取消，以最新原文为准。' : record.stage === 'completed' ? '原帖确认已完成，账户实际生效情况仍需单独确认。' : record.stage === 'in-progress' ? '原帖表示正在执行，尚未确认全部完成。' : '明确预告；具体时间、适用范围和重置方式以原文为准，未说明的部分保留未知。');
        $('source').textContent = record ? `${record.kind === 'arrival' ? '账户检测' : `Tibo · @thsottiaux ／ ${record.verified ? '本地原帖核验通过' : '社区收录 · 待核验'}`}。${record.read && record.manualReadAt ? '已手动标记已读' : record.processingReason || (record.read ? '已读' : '待手动标记')}。${record.archiveSource ? `补录来源：${record.archiveSource}` : ''}` : '';
        $('original').hidden = !record?.url; $('quote-wrap').hidden = !record;
        $('quote-label').textContent = record?.originalText ? '查看读取到的原帖' : '查看社区收录内容';
        put('quote', record?.originalText || record?.text || '');
        const translated = record?.chineseText && record.translationOriginalText === record.originalText;
        $('translation-wrap').hidden = !record;
        put('quote-zh', translated ? record.chineseText : record?.originalText || record?.text || '');
        put('translation-state', !record ? '' : !record.originalText ? record.kind === 'arrival' ? '本账户检查记录' : '社区收录摘要 · 非已核验原文' : translated ? '机器翻译 · 以原文为准' : state.translatingId === record.id ? '正在翻译…' : record.translationStatus === 'unavailable' || record.translationAttempts ? '暂未取得译文 · 原文可读' : '等待翻译 · 原文可读');
        $('translate-notice').hidden = !state.translationEnabled || !record?.verified || !record.originalText || Boolean(translated && (!record.context?.originalText || record.context.chineseText));
        $('notice-context').hidden = !record?.context;
        if (record?.context) {
            put('notice-context-heading', `回复 / 引用 @${record.context.author || '未知作者'} · 展开上下文`);
            put('notice-context-body', record.context.chineseText || record.context.originalText);
            put('notice-context-state', record.context.chineseText ? '上下文已翻译 · 以原文为准' : '上下文原文 · 翻译暂不可用');
        }
        $('mark-read').hidden = !record?.verified;
        $('mark-read').disabled = record?.read !== false;
        $('mark-read').textContent = record?.read === false ? '标记已读' : '已读';
        const account = state.account;
        const recovered = Object.entries(state.recoveries || {}).filter(([key, r]) => !(key === 'fiveHour' && account?.hasFiveHour === false) && Date.now() - r.at < 86400000);
        const arrival = state.cardArrival && Date.now() - state.cardArrival.at < 86400000 ? state.cardArrival : null;
        const labels = { fiveHour: '5 小时', weekly: '每周' };
        $('account-status').className = !account?.stale && (recovered.length || arrival) ? 'recovered' : '';
        $('account-status').textContent = !account ? '等待额度数据' : account.stale ? '额度暂未更新，以下为上次读数' : arrival ? `✓ ${time(arrival.at)} 观察到新增 ${arrival.count} 张重置卡` : recovered.length ? recovered.map(([key, r]) => `✓ ${labels[key]}额度于 ${time(r.at)} 回升`).join('；') : '尚未观察到额度恢复或新卡到账';
        put('account-summary', `本账户：${$('account-status').textContent}。与公告分别记录。`);
        const percent = value => Number.isFinite(value) ? `${Math.round(value)}%` : '未知';
        $('account-values').textContent = account ? `${account.hasFiveHour === false ? '' : `5 Hours ${percent(account.fiveHour)}　·　`}Weekly ${percent(account.weekly)}　·　重置卡 ${account.credits ?? '未知'}` : '';
        $('account-note').textContent = account ? `额度更新：${time(account.updatedAt)}。${recovered.length || arrival ? '仅记录读数变化，不能据此确定由本次公告触发；新卡需手动使用。' : '首次读取不能判断此前变化，尚未观察到恢复不等于未到账。'}` : '公告和账户状态分别记录。';
        const range = $('history-range').value;
        const historyFilter = r => (filter !== 'unread' || r.verified && !r.read) && (range === 'all' || r.publishedAt >= Date.now() - 30 * 86400000 || r.verified && !r.read);
        const total = reader.render(historyFilter);
        put('history-count', `${state.records.length} 条 · ${state.unread} 条未读`);
        $('history-more').hidden = reader.limit >= total; $('empty-history').hidden = total > 0;
        $('mark-all-read').disabled = !reader.visible().some(r => r.verified && !r.read);
        $('filter-all').setAttribute('aria-pressed', String(filter === 'all'));
        $('filter-unread').setAttribute('aria-pressed', String(filter === 'unread'));
        put('filter-unread', `未读 ${state.unread}`);
        $('coverage').textContent = state.coverage?.note || '记录长期保存；来源仅覆盖部分公开消息，无法保证完整时间线。';
        const journal = state.forecastHistory;
        $('prediction-history').textContent = journal ? `预测记录 ${journal.total} 次 · 待观察 ${journal.pending} · 有事件证据 ${journal.events} · 无法评价 ${journal.unscorable}。未发现事件不代表未发生；尚不计算准确率。` : '';
        const fresh = state.forecast?.healthy && Date.now() - state.forecast.asOf <= 21600000;
        $('community-health').textContent = `社区接口：${state.error || (fresh ? '正常' : '数据过期或尚不可用')} · ${time(state.lastSuccessAt)}`;
        const verification = { verified: '原帖可信，内容含义单独分类', rejected: '等待重新分类', unreadable: '原文暂不可读，将重试', 'network-error': '网络失败，等待重试', observed: '账户检查发现' };
        $('verification-health').textContent = `当前核验：${verification[record?.verificationStatus] || (!state.verificationEnabled ? '核验未配置，保留为社区收录' : '等待核验')}${record?.nextVerificationAt ? ` · 重试不早于 ${time(record.nextVerificationAt)}` : ''}`;
    }
    $('check').addEventListener('click', async () => {
        renderCheck();
        if (!state || $('check').disabled) return;
        checking = true; renderCheck();
        try { render(await api.refreshNotices()); } catch { $('error').hidden = false; $('error').textContent = '公告检查失败，请重试。'; }
        finally { checking = false; renderCheck(); }
    });
    $('enabled').addEventListener('change', async () => { render(await api.enableNotices($('enabled').checked)); });
    $('show-probability').addEventListener('change', async () => { render(await api.showProbability($('show-probability').checked)); });
    $('original').addEventListener('click', () => { if (selectedId) void api.openNoticeSource(selectedId); });
    $('new-notice').addEventListener('click', () => { reader.showNew(); render(state); });
    $('mark-read').addEventListener('click', async () => {
        const record = state.records.find(r => r.id === selectedId);
        try { render(await api.markNoticesRead([{ id: record.id, revision: record.revision || 1 }])); } catch { $('error').hidden = false; $('error').textContent = '未能标记已读，请重试。'; }
    });
    $('mark-all-read').addEventListener('click', async () => {
        const seen = reader.visible().filter(r => r.verified && !r.read).map(r => ({ id: r.id, revision: r.revision || 1 }));
        try { render(await api.markNoticesRead(seen)); } catch { $('error').hidden = false; $('error').textContent = '未能标记已读，请重试。'; }
    });
    $('history-range').addEventListener('change', () => { reader.limit = 50; render(state); });
    $('history-more').addEventListener('click', () => { reader.limit += 50; render(state); });
    api.subscribeNoticeSelection?.(id => { selectedId = id; window.openMessageDetail(); if (state) render(state); });
    $('refresh-account').addEventListener('click', async () => {
        $('refresh-account').disabled = true;
        try { await api.refreshNow(); } catch { $('error').hidden = false; $('error').textContent = '账户刷新失败，请稍后重试。'; }
        finally { $('refresh-account').disabled = false; }
    });
    $('reader-back').addEventListener('click', () => window.closeMessageDetail());
    for (const value of ['all', 'unread']) $(`filter-${value}`).addEventListener('click', () => { filter = value; render(state); });
    $('translate-notice').addEventListener('click', async () => {
        translating = true; renderCheck();
        try { render(await api.translateNotice(selectedId)); } catch { $('error').hidden = false; put('error', '翻译暂不可用，请稍后重试。'); }
        finally { translating = false; renderCheck(); }
    });
    api.subscribeNotices(render);
    api.readNotices().then(render).catch(() => { $('error').hidden = false; $('error').textContent = '无法读取公告记录，请重新打开窗口。'; });
    window.setInterval(() => { if (state) render(state); }, 60000);
    window.setInterval(renderCheck, 1000);
})();
