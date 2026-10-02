'use strict';
(() => {
    const api = window.quota, $ = id => document.getElementById(id), put = (id, text) => window.readerText($(id), text);
    const time = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未检查';
    const types = { post: '原帖', reply: '回复', quote: '引用', repost: '转推', unknown: '推文' };
    let state, filter = 'unread', busy = false, shownId, requestedId, translatingId;
    const reader = new window.MessageReader($('feed-list'), r => [
        (r.chineseText || r.originalText || '媒体动态').replace(/\s+/g, ' ').slice(0, 64),
        `${types[r.type] || '推文'} · ${time(r.publishedAt)} · ${r.read ? '已读' : '未读'}${r.originalText && !r.chineseText ? ` · ${translationLabel(r)}` : ''}`,
    ], id => {
        const record = reader.selected();
        window.openMessageDetail(); void api.prioritizeTibo(id); render(state);
        if (record && !record.read) void act(() => api.markTiboRead([{ id: record.id, revision: record.revision }]));
    });
    function translationLabel(record) {
        if (state?.translatingId === record.id || translatingId === record.id) return '正在翻译…';
        if (!state?.translationConfigured) return '翻译暂不可用';
        return record.translationStatus === 'unavailable' || record.lastTranslationAttemptAt ? '暂未取得译文' : '等待翻译';
    }
    function showError() { $('error').hidden = false; put('error', '操作未完成，请重试。'); }
    async function act(action) { try { const next = await action(); if (next) render(next); } catch { showError(); } }
    function renderClock() {
        if (!state) return;
        const wait = Math.max(0, Math.ceil((state.manualCheckAt - Date.now()) / 1000));
        $('refresh').disabled = busy || state.loading || wait > 0;
        put('refresh', busy || state.loading ? '正在更新…' : wait ? `${wait} 秒后可更新` : '立即更新');
        const r = reader.selected(), translationWait = Math.max(0, Math.ceil(((r?.lastTranslationAttemptAt || 0) + 60000 - Date.now()) / 1000));
        $('translate').disabled = !state.translationConfigured || Boolean(state.translatingId || translatingId) || translationWait > 0;
        put('translate', r && (state.translatingId === r.id || translatingId === r.id) ? '正在翻译…' : translationWait ? `${translationWait} 秒后可重试` : r?.chineseText ? '翻译上下文' : r?.lastTranslationAttemptAt ? '重试翻译' : '优先翻译');
    }
    function render(next) {
        const selectedId = reader.selectedId;
        state = next; reader.accept(state.records);
        reader.selectedId = state.records.some(r => r.id === selectedId) ? selectedId : null;
        if (requestedId && state.records.some(r => r.id === requestedId)) { const id = requestedId; requestedId = null; reader.select(id); return; }
        renderClock();
        put('sync', `动态${state.loading ? '正在更新' : '最近获取'}：${time(state.lastReceivedAt || state.lastSuccessAt)} · 下次检查：${time(state.nextCheckAt)}`);
        $('error').hidden = !state.error; put('error', state.error || '');
        const pending = reader.pending(); $('new-posts').hidden = !pending.length; put('new-posts', `新增 ${pending.length} 条动态 · 点击查看`);
        const total = reader.render(r => filter !== 'unread' || !r.read);
        $('more').hidden = total <= reader.limit; $('empty').hidden = total > 0;
        put('empty', filter === 'unread' ? '没有未读动态。' : state.pending ? `${state.pending} 条内容正在等待原帖读取。` : '暂无收录内容。首次同步的历史动态默认已读。');
        $('read-all').disabled = !reader.visible().some(r => !r.read);
        $('filter-all').setAttribute('aria-pressed', String(filter === 'all')); $('filter-unread').setAttribute('aria-pressed', String(filter === 'unread'));
        put('filter-unread', `未读 ${state.unread}`);
        const r = reader.selected(); $('post-detail').hidden = !r; $('no-selection').hidden = Boolean(r);
        if (r) {
            if (shownId !== r.id) { for (const id of ['post-context', 'context-original-wrap', 'post-original-wrap']) $(id).open = false; shownId = r.id; void api.prioritizeTibo(r.id); }
            $('post-detail').dataset.id = r.id;
            put('post-meta', `${r.type === 'repost' ? `Tibo 转推 · @${r.author || '未知作者'}` : 'Tibo'} · ${types[r.type] || '推文'} · ${time(r.publishedAt)}`);
            put('post-title', r.context?.author ? `${r.type === 'reply' ? '回复' : '引用'} @${r.context.author}` : types[r.type] || '推文');
            put('post-read', r.read ? '已读' : '● 未读');
            put('post-body', r.chineseText || r.originalText || '此推文没有文字正文，可在 X 原帖中查看媒体。');
            put('post-translation', r.chineseText ? r.lang?.startsWith('zh') ? '中文原文' : '机器翻译 · 以原文为准' : r.originalText ? `${translationLabel(r)} · 原文可读` : '');
            $('translate').hidden = !(r.originalText && !r.chineseText || r.context?.originalText && !r.context.chineseText);
            $('post-context').hidden = !r.context; $('context-missing').hidden = !r.contextMissing;
            if (r.context) {
                put('context-heading', `${r.type === 'reply' ? '回复' : '引用'} @${r.context.author || '未知作者'} · 展开上下文`);
                put('context-body', r.context.chineseText || r.context.originalText);
                put('context-status', r.context.chineseText ? '上下文已翻译 · 以原文为准' : state.translatingId === r.id ? '上下文正在处理' : r.context.translationStatus === 'unavailable' || r.lastTranslationAttemptAt ? '上下文暂未取得译文' : '上下文等待翻译');
                $('context-original-wrap').hidden = !r.context.chineseText; put('context-original', r.context.originalText);
            }
            $('post-original-wrap').hidden = !r.chineseText; put('post-original', r.originalText);
            $('post-media').hidden = !r.media?.length; put('post-media', `包含 ${r.media?.length || 0} 项媒体，可在 X 原帖中查看`);
            $('mark-read').disabled = r.read; put('mark-read', r.read ? '已读' : '标记已读'); $('related').hidden = !r.related;
        }
        put('translation-status', state.translationError || `正文已翻译 ${state.records.filter(r => r.chineseText).length} 条；其余按当前阅读、未读和发布时间依次处理。`);
        put('coverage', `已收录 ${state.records.length} 条。${state.incomplete ? '历史分页尚未完成，将继续补齐。' : '本轮历史分页已完成。'}${state.coverage || ''}`);
        put('source', '推文与机器翻译：FxTwitter 公共接口（非 X 官方），无需密钥。第三方来源可能暂时不可用。');
        put('storage', `普通动态缓存：${(state.bytes / 1024).toFixed(1)} KB · ${state.records.length} 条正文`);
        renderClock();
    }
    $('refresh').addEventListener('click', async () => { busy = true; renderClock(); await act(() => api.refreshTibo()); busy = false; renderClock(); });
    $('new-posts').addEventListener('click', () => { reader.ids = state.records.map(r => r.id); render(state); });
    $('mark-read').addEventListener('click', () => { const r = reader.selected(); if (r) void act(() => api.markTiboRead([{ id: r.id, revision: r.revision }])); });
    $('read-all').addEventListener('click', () => void act(() => api.markTiboRead(reader.visible().map(r => ({ id: r.id, revision: r.revision })))));
    $('open-source').addEventListener('click', () => { if (reader.selected()) void act(() => api.openTiboSource(reader.selectedId)); });
    $('related').addEventListener('click', () => { if (reader.selected()) void act(() => api.openNotices(reader.selectedId)); });
    $('translate').addEventListener('click', async () => { const id = reader.selectedId; translatingId = id; render(state); await act(() => api.translateTibo(id)); translatingId = null; render(state); });
    for (const value of ['all', 'unread']) $(`filter-${value}`).addEventListener('click', () => { filter = value; render(state); });
    $('reader-back').addEventListener('click', () => window.closeMessageDetail());
    $('more').addEventListener('click', () => { reader.limit += 50; render(state); });
    $('clear').addEventListener('click', () => { $('clear-confirm').hidden = false; });
    $('clear-no').addEventListener('click', () => { $('clear-confirm').hidden = true; });
    $('clear-yes').addEventListener('click', async () => { await act(() => api.clearTibo()); $('clear-confirm').hidden = true; });
    const off = api.subscribeTibo(render);
    const offSelection = api.subscribeTiboSelection(id => {
        requestedId = typeof id === 'string' ? id : null;
        if (!requestedId) {
            reader.selectedId = null; reader.ids = null; shownId = null; filter = 'unread';
            window.closeMessageDetail(); void api.prioritizeTibo(null);
        }
        if (state) render(state);
    });
    void api.readTibo().then(render).catch(showError);
    const timer = setInterval(renderClock, 1000);
    window.addEventListener('unload', () => { off(); offSelection(); clearInterval(timer); void api.prioritizeTibo(null); });
})();
