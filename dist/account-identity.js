'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
function readAccountKey(file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json')) {
    try {
        const tokens = JSON.parse(fs.readFileSync(file, 'utf8')).tokens;
        if (typeof tokens?.account_id !== 'string' || !tokens.account_id) return null;
        let subject = '';
        try { subject = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8')).sub || ''; } catch {}
        return createHash('sha256').update(tokens.account_id + ':' + subject).digest('hex');
    } catch { return null; }
}
module.exports = { readAccountKey };
