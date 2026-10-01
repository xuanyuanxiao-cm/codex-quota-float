'use strict';
(() => {
    const api = window.quota, $ = id => document.getElementById(id);
    const time = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未成功';
    const types = { post: '原帖', reply: '回复', quote: '引用', repost: '转推', unknown: '推文' };
    const opened = new Set(), expanded = new Set();
    let state, limit = 30, selectedId, busy = false;
    const node = (tag, text, className) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
    const button = (label, action) => { const el = node('button', label); el.type = 'button'; el.addEventListener('click', () => void action()); return el; };
    function showError(error) { $('error').hidden = false; $('error').textContent = '操作未完成，请重试。'; }
    async function act(action) { try { const next = await action(); if (next) render(next); } catch (error) { showError(error); } }
    function renderClock() {
        if (!state) return;
        const wait = Math.max(0, Math.ceil((state.manualCheckAt - Date.now()) / 1000));
        $('refresh').disabled = busy || state.loading || wait > 0;
        $('refresh').textContent = busy || state.loading ? '正在更新…' : wait ? `${wait} 秒后可更新` : '立即更新';
    }
    function post(record) {
        const article = node('article', null, 'feed-post'); article.dataset.id = record.id;
        if (record.id === selectedId) article.classList.add('post-selected');
        const meta = node('div', null, 'post-meta');
        meta.append(node('span', record.type === 'repost' ? `Tibo 转推 · @${record.author || '作者暂不可用'}` : 'Tibo'), node('span', types[record.type] || '推文'), node('span', time(record.publishedAt)));
        if (record.related) meta.append(node('span', '重置相关', 'post-related'));
        meta.append(node('span', record.read ? '已读' : '未读', 'post-unread')); article.append(meta);
        const text = record.chineseText || record.originalText || '此推文没有文字正文，可在 X 原帖中查看媒体。';
        const long = text.length > 500 && !expanded.has(record.id);
        article.append(node('p', long ? text.slice(0, 500) + '…' : text, 'post-body'));
        if (long) article.append(button('展开全文', () => { expanded.add(record.id); render(state); }));
        if (record.originalText) article.append(node('div', record.chineseText ? record.lang?.startsWith('zh') ? '中文原文' : '机器翻译，以原文为准' : '原文 · 中文翻译待完成', 'post-translation'));
        if (record.context) {
            const context = node('div', null, 'post-context');
            context.append(node('span', `${record.type === 'reply' ? '回复' : '引用'} @${record.context.author || '未知作者'}`, 'muted'), node('p', record.context.chineseText || record.context.originalText));
            if (record.context.chineseText) {
                const original = node('details'); original.append(node('summary', '机器翻译 · 查看上下文原文'), node('p', record.context.originalText)); context.append(original);
            }
            article.append(context);
        } else if (record.contextMissing) article.append(node('p', '上下文暂不可用', 'muted'));
        if (record.chineseText) {
            const original = node('details'); original.open = opened.has(record.id);
            original.append(node('summary', '展开原文'), node('p', record.originalText, 'post-original'));
            original.addEventListener('toggle', () => { if (original.open) opened.add(record.id); else opened.delete(record.id); }); article.append(original);
        }
        const actions = node('div', null, 'post-actions');
        actions.append(button('查看 X 原帖 ↗', () => act(() => api.openTiboSource(record.id))));
        if (record.originalText && !record.chineseText || record.context?.originalText && !record.context.chineseText) {
            const translate = button('翻译为中文', async () => { translate.disabled = true; translate.textContent = '正在翻译…'; await act(() => api.translateTibo(record.id)); });
            actions.append(translate);
        }
        const read = button(record.read ? '已读' : '标记已读', () => act(() => api.markTiboRead([{ id: record.id, revision: record.revision }]))); read.disabled = record.read; actions.append(read);
        if (record.related) actions.append(button('重置详情 →', () => act(() => api.openNotices(record.id))));
        if (record.media?.length) article.append(node('p', `包含 ${record.media.length} 项媒体，可在 X 原帖中查看`, 'muted'));
        article.append(actions); return article;
    }
    function render(next) {
        state = next; renderClock();
        $('sync').textContent = `最近成功同步：${time(state.lastSuccessAt)}${state.loading ? ' · 正在更新' : ''}；下次检查：${time(state.nextCheckAt)}`;
        $('error').hidden = !state.error; $('error').textContent = state.error || '';
        $('translation-status').textContent = state.translationError || (!state.translationConfigured ? '翻译服务未配置，先显示原文。' : '中文译文按需生成并保存在本地。');
        $('feed-list').replaceChildren(...state.records.slice(0, limit).map(post));
        $('read-all').disabled = !state.unread; $('empty').hidden = state.records.length > 0;
        $('empty').textContent = state.pending ? `${state.pending} 条候选正在等待原帖读取，搜索摘要不作为正文显示。` : '暂无收录内容。首次同步的历史动态默认已读。';
        $('more').hidden = limit >= state.records.length;
        const oldest = state.records.at(-1)?.publishedAt;
        $('coverage').textContent = `已收录 ${state.records.length} 条${oldest ? `，最早 ${time(oldest)}` : ''}。${state.pending ? `${state.pending} 条等待原帖读取。` : ''}${state.incomplete ? '分页尚未完成，将继续同步。' : ''}${state.coverage || '等待数据源返回收录范围。'}`;
        $('source').textContent = '推文与机器翻译：FxTwitter 公共接口（非 X 官方），无需密钥。';
        $('storage').textContent = `普通动态缓存：${(state.bytes / 1024).toFixed(1)} KB · ${state.records.length} 条正文`;
    }
    $('refresh').addEventListener('click', async () => { busy = true; renderClock(); await act(() => api.refreshTibo()); busy = false; renderClock(); });
    $('read-all').addEventListener('click', () => { const items = state.records.map(r => ({ id: r.id, revision: r.revision })); void act(() => api.markTiboRead(items)); });
    $('more').addEventListener('click', () => { limit += 30; render(state); });
    $('clear').addEventListener('click', () => { $('clear-confirm').hidden = false; });
    $('clear-no').addEventListener('click', () => { $('clear-confirm').hidden = true; });
    $('clear-yes').addEventListener('click', async () => { await act(() => api.clearTibo()); $('clear-confirm').hidden = true; });
    const off = api.subscribeTibo(render);
    const offSelection = api.subscribeTiboSelection(id => { selectedId = id; if (state) { const index = state.records.findIndex(r => r.id === id); limit = Math.max(limit, index + 1); render(state); document.querySelector('.post-selected')?.scrollIntoView({ block: 'nearest' }); } });
    void api.readTibo().then(render).catch(showError);
    const timer = setInterval(renderClock, 1000);
    window.addEventListener('unload', () => { off(); offSelection(); clearInterval(timer); });
})();
