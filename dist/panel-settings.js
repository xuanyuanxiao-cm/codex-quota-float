'use strict';
const fs = require('node:fs');
const defaults = { notices: true, tibo: true, trends: true };
class PanelSettings {
    constructor(file) {
        this.file = file; this.value = { ...defaults };
        try {
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            for (const key of Object.keys(defaults)) if (typeof saved?.[key] === 'boolean') this.value[key] = saved[key];
            if (typeof saved?.forecast === 'boolean') this.value.notices = saved.forecast || this.value.notices;
        } catch {}
    }
    set(key, enabled) {
        if (!Object.hasOwn(defaults, key) || typeof enabled !== 'boolean') throw new Error('Invalid feature setting');
        const next = { ...this.value, [key]: enabled };
        fs.writeFileSync(this.file + '.tmp', JSON.stringify(next));
        fs.renameSync(this.file + '.tmp', this.file);
        this.value = next;
    }
}
module.exports = { PanelSettings };
