'use strict';
(() => {
    const api = window.quota;
    const setCount = (id, state) => { const node = document.getElementById(id); if (node) node.textContent = state.unread ? state.unread > 99 ? '99+' : String(state.unread) : ''; };
    document.getElementById('nav-notices')?.addEventListener('click', () => { if (document.body.dataset.feedPage !== 'notices') void api.openNotices(); });
    document.getElementById('nav-tibo')?.addEventListener('click', () => { if (document.body.dataset.feedPage !== 'tibo') void api.openTibo(); });
    const offNotices = api.subscribeNotices(state => setCount('nav-notices-count', state));
    const offTibo = api.subscribeTibo(state => setCount('nav-tibo-count', state));
    void api.readNotices().then(state => setCount('nav-notices-count', state)).catch(() => {});
    void api.readTibo().then(state => setCount('nav-tibo-count', state)).catch(() => {});
    window.addEventListener('unload', () => { offNotices(); offTibo(); });
})();
