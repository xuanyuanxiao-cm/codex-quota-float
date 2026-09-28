const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('account identity excludes credentials, separates accounts and tolerates unavailable auth', t => {
    const { readAccountKey } = require('../dist/account-identity');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-key-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'auth.json');
    assert.equal(readAccountKey(file), null);
    fs.writeFileSync(file, JSON.stringify({ tokens: { account_id: 'account-a', access_token: 'secret-a' } }));
    const a = readAccountKey(file); assert.match(a, /^[a-f0-9]{64}$/);
    fs.writeFileSync(file, JSON.stringify({ tokens: { account_id: 'account-a', access_token: 'secret-b' } }));
    assert.equal(readAccountKey(file), a);
    fs.writeFileSync(file, JSON.stringify({ tokens: { account_id: 'account-b' } }));
    assert.notEqual(readAccountKey(file), a);
});
