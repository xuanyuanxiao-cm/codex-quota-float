'use strict';
(() => {
    const api = window.quota, inputs = [...document.querySelectorAll('[data-feature]')], error = document.getElementById('error');
    const pending = new Set();
    const render = settings => { for (const input of inputs) if (!pending.has(input.dataset.feature)) { input.checked = settings[input.dataset.feature]; input.disabled = false; } };
    for (const input of inputs) input.addEventListener('change', async () => {
        const key = input.dataset.feature, enabled = input.checked;
        pending.add(key); input.disabled = true; error.hidden = true;
        try { await api.setPanelItem(key, enabled); }
        catch { input.checked = !enabled; error.textContent = '设置未能保存，请重试。'; error.hidden = false; }
        finally { pending.delete(key); input.disabled = false; }
    });
    const off = api.subscribePanelSettings(render);
    void api.readPanelSettings().then(render).catch(() => { error.textContent = '设置未能读取，请重新打开。'; error.hidden = false; });
    document.getElementById('done').addEventListener('click', () => { if (!pending.size) void api.closeSettings(); });
    window.addEventListener('unload', off);
})();
