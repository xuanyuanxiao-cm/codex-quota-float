'use strict';
// Shared list behaviour for the two independent message channels.
window.MessageReader = class {
    constructor(list, describe, onSelect) {
        this.list = list; this.describe = describe; this.onSelect = onSelect;
        this.ids = null; this.records = []; this.selectedId = null; this.limit = 50;
        this.buttons = new Map();
    }
    accept(records) {
        this.records = records;
        const available = new Set(records.map(r => r.id));
        this.ids = this.ids == null ? records.map(r => r.id) : this.ids.filter(id => available.has(id));
        if (!available.has(this.selectedId)) this.selectedId = this.ids[0] || null;
    }
    pending() { return this.records.filter(r => !this.ids.includes(r.id)); }
    selected() { return this.records.find(r => r.id === this.selectedId); }
    select(id) {
        if (!this.records.some(r => r.id === id)) return;
        if (!this.ids.includes(id)) this.ids.unshift(id);
        this.selectedId = id; this.onSelect?.(id);
    }
    showNew() {
        const first = this.pending()[0]; this.ids = this.records.map(r => r.id);
        if (first) this.select(first.id);
    }
    visible(filter = () => true) {
        const map = new Map(this.records.map(r => [r.id, r]));
        return this.ids.map(id => map.get(id)).filter(r => r && filter(r));
    }
    render(filter) {
        const rows = this.visible(filter), nodes = rows.slice(0, this.limit).map(record => {
            let button = this.buttons.get(record.id);
            if (!button) {
                button = document.createElement('button'); button.type = 'button'; button.className = 'history-item'; button.dataset.id = record.id;
                button.append(document.createElement('span'), document.createElement('small'));
                button.addEventListener('click', () => this.select(record.id)); this.buttons.set(record.id, button);
            }
            const [title, meta] = this.describe(record);
            window.readerText(button.firstChild, title); window.readerText(button.lastChild, meta);
            button.setAttribute('aria-pressed', String(record.id === this.selectedId)); return button;
        });
        // Reuse nodes on status/translation updates, retaining focus and list position.
        nodes.forEach((node, i) => { if (this.list.children[i] !== node) this.list.insertBefore(node, this.list.children[i] || null); });
        while (this.list.children.length > nodes.length) this.list.lastChild.remove();
        for (const id of this.buttons.keys()) if (!this.records.some(r => r.id === id)) this.buttons.delete(id);
        return rows.length;
    }
};
window.readerText = (element, text) => { const value = String(text ?? ''); if (element.textContent !== value) element.textContent = value; };
let messageListScroll = 0;
window.openMessageDetail = () => {
    if (matchMedia('(max-width: 640px)').matches) {
        if (!document.body.classList.contains('reader-detail')) messageListScroll = scrollY;
        document.body.classList.add('reader-detail'); window.scrollTo(0, 0);
    } else document.querySelector('.reader-content').scrollTop = 0;
};
window.closeMessageDetail = () => { document.body.classList.remove('reader-detail'); window.scrollTo(0, messageListScroll); };
