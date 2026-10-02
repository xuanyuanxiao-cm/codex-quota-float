const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ResetNotices, classifyPost, DAY, HOUR } = require('../dist/notices');
const { noticePresentation } = require('../dist/renderer/notice-presentation');
const { url } = require('./notice-fixtures.cjs');
const { snapshot, original } = require('./notice-fixtures.cjs');
const { parseCommunity } = require('../dist/community-reset');
const NOW = Date.parse('2026-09-28T08:00:00Z');
function store(t, records, extra = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-revision-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'notices.json');
    fs.writeFileSync(file, JSON.stringify({ version: 2, initialized: true, records, ...extra }));
    const service = new ResetNotices(file, { now: () => NOW, loadOriginal: null });
    t.after(() => service.stop()); return service;
}
function record(id, text, extra = {}) { return { id, url: url(id), publishedAt: NOW - HOUR, text, originalText: text, verifiedAt: NOW - HOUR, verified: true, read: false, kind: 'reset', stage: 'announced', ...extra }; }
test('short Tibo promise is actionable but questions, negation and conditions are not promises', () => {
    assert.deepEqual(classifyPost('Sorry Gia. More resets coming next week'), { kind: 'reset', stage: 'announced' });
    for (const text of ['Will we reset Codex limits?', "We won't reset Codex limits.", 'We will reset Codex limits if the outage lasts.']) assert.equal(classifyPost(text).stage, 'hint');
    assert.equal(classifyPost('Sorry about the Codex server outage.').kind, 'service');
    assert.equal(classifyPost('Sorry about the weather.').kind, 'unrelated');
    assert.equal(classifyPost('Reset your password.').kind, 'unrelated');
    assert.equal(classifyPost('Banked resets expire after 30 days.').kind, 'limits');
    assert.equal(classifyPost('The Codex reset announced earlier is cancelled.').stage, 'cancelled');
});
test('archive retains more than 200 old unread messages across restart', t => {
    const records = Array.from({ length: 230 }, (_, i) => record(String(12345678000 + i), "We'll reset Codex usage limits.", { publishedAt: NOW - (40 + i) * DAY }));
    const s = store(t, records); s.persist();
    const restarted = new ResetNotices(s.file, { now: () => NOW, loadOriginal: null });
    assert.equal(restarted.view().records.length, 230); assert.equal(restarted.view().unread, 230);
});
test('Sep 27 rejected original migrates once without treating rejection as failed authenticity', t => {
    const s = store(t, [record('2103963215885701493', 'Sorry Gia. More resets coming next week', { verified: false, read: true, kind: 'hint', stage: 'hint', verificationStatus: 'rejected', eligible: true })]);
    assert.equal(s.view().unread, 1); assert.equal(s.view().records[0].verified, true);
    assert.equal(noticePresentation(s.view(), NOW).tag, '重置预告');
    s.markRead('2103963215885701493');
    const restarted = new ResetNotices(s.file, { now: () => NOW });
    assert.equal(restarted.view().unread, 0);
});
test('mark all acknowledges only the supplied revisions; later messages remain unread', t => {
    const s = store(t, [record('12345678901', "We'll reset Codex usage limits.")]);
    const seen = s.view().records.map(r => ({ id: r.id, revision: r.revision }));
    s.saved.records.push(record('12345678902', "We'll reset Codex usage limits."));
    s.markReadBatch(seen);
    assert.equal(s.view().unread, 1);
    s.saved.records[0].revision += 1; s.saved.records[0].read = false;
    s.markReadBatch(seen); assert.equal(s.view().unread, 2);
});
test('verified local promise survives feed failure and unread does not affect label', t => {
    const s = store(t, [record('12345678901', "We'll reset Codex usage limits.")]);
    s.error = 'offline';
    assert.equal(noticePresentation(s.view(), NOW).tag, '重置预告');
    s.markRead('12345678901');
    assert.equal(noticePresentation(s.view(), NOW).tag, '重置预告');
    assert.equal(noticePresentation(s.view(), NOW + 3 * DAY).tag, '预测待更新');
});
test('explicit deadline becomes pending then stops occupying label without clearing unread', t => {
    const s = store(t, [record('12345678901', "We'll reset Codex usage limits.", { deadlineAt: NOW - HOUR })]);
    assert.equal(noticePresentation(s.view(), NOW).tag, '重置待确认');
    assert.equal(noticePresentation(s.view(), NOW + DAY).tag, '预测待更新');
    assert.equal(s.view().unread, 1);
});
test('parser preserves old history and service activity without calling it a reset', () => {
    const data = snapshot(NOW, [{ id: '12345678901', time: NOW - 75 * DAY }], false);
    data.latestTiboActivity = { sourceUrl: url('12345678902'), createdAt: new Date(NOW).toISOString(), classification: 'other', text: 'Sorry about the Codex outage.' };
    assert.equal(parseCommunity(data, NOW).records.length, 2);
});
test('per-account card history survives restart and missing data without switching-account false alarms', t => {
    const s = store(t, []);
    const account = (key, ids) => ({ status: 'ready', accountKey: key, planType: 'pro', lastUpdatedAt: NOW,
        resetCredits: ids ? { credits: ids.map(id => ({ id, status: 'available', expiresAt: NOW + DAY })) } : null });
    s.updateAccount(account('account-a', ['a'])); assert.equal(s.view().unread, 0);
    s.updateAccount(account('account-b', ['b'])); assert.equal(s.view().unread, 0);
    s.updateAccount(account('account-a', null));
    const restarted = new ResetNotices(s.file, { now: () => NOW });
    restarted.updateAccount(account('account-a', ['a', 'c']));
    assert.equal(restarted.view().unread, 1); assert.equal(restarted.view().cardArrival.count, 1);
    restarted.updateAccount(account('account-a', ['a', 'c'])); assert.equal(restarted.view().unread, 1);
    restarted.markRead(restarted.view().records[0].id);
    restarted.updateAccount(account('account-b', ['b'])); assert.equal(restarted.view().unread, 0);
});
test('community summary edits preserve verified originals, translations and manual acknowledgement', async t => {
    const s = store(t, [record('12345678901', "We'll reset Codex usage limits.", { read: true, manualReadAt: NOW - 1000 })]);
    s.loadCommunity = async () => snapshot(NOW, [{ id: '12345678901', time: NOW - HOUR, text: 'New community summary' }]);
    await s.refresh();
    assert.equal(s.view().records[0].originalText, "We'll reset Codex usage limits.");
    assert.equal(s.view().unread, 0);
});
test('a timeline cancellation restores one unread revision and duplicate imports do not increment it', t => {
    const s = store(t, [record('12345678901', "We'll reset Codex usage limits.", { read: true, manualReadAt: NOW - HOUR, source: 'community' })]);
    const post = original('12345678901', 'The Codex reset is cancelled.');
    s.importTiboPost(post); s.importTiboPost(post);
    assert.equal(s.view().unread, 1); assert.equal(s.view().records[0].revision, 2);
    assert.equal(noticePresentation(s.view(), NOW).tag, '预告已取消');
});
test('fresh forecasts are saved with original probabilities and missing observation windows stay unscorable', async t => {
    const s = store(t, []); let now = NOW; s.now = () => now;
    s.loadCommunity = async () => snapshot(now);
    await s.refresh();
    assert.equal(s.saved.forecasts.length, 1); assert.equal(s.saved.forecasts[0].probability, 0.35);
    now += 2 * DAY; await s.refresh();
    assert.equal(s.saved.forecasts[0].outcome, 'unscorable');
    assert.equal(s.saved.forecasts[0].probability, 0.35);
});
test('archive import is silent, idempotent and never overwrites a verified original or manual read', t => {
    const s = store(t, [record('12345678901', "We'll reset Codex usage limits.", { read: false })]);
    const seed = { requestedFrom: '2026-06-28', requestedTo: '2026-09-28', records: [
        record('12345678901', 'Community summary', { verified: true, read: true }),
        record('12345678902', 'Historical banked distribution', { publishedAt: NOW - 60 * DAY, kind: 'banked' })] };
    s.importArchive(seed); s.importArchive(seed);
    assert.equal(s.view().records.length, 2); assert.equal(s.view().unread, 1);
    const old = s.view().records.find(r => r.id === '12345678902');
    assert.equal(old.verified, false); assert.equal(old.read, true); assert.equal(old.originalText, undefined);
    assert.equal(s.view().records.find(r => r.id === '12345678901').originalText, "We'll reset Codex usage limits.");
    assert.match(s.view().coverage.note, /不完整/);
});
test('unrelated questions do not veto an affirmative reset clause and wishes do not become promises', () => {
    assert.equal(classifyPost("Ready? We'll reset Codex usage limits tomorrow.").stage, 'announced');
    assert.equal(classifyPost('I hope we get a reset next week.').stage, 'hint');
    assert.equal(classifyPost('Reset Codex configuration tomorrow.').kind, 'unrelated');
});
test('explicit linked completion replaces its own promise while a different future promise remains', () => {
    const records = [record('12345678901', "We'll reset Codex limits.", { eventId: 'one', publishedAt: NOW - HOUR }),
        record('12345678902', 'We reset Codex limits.', { eventId: 'one', stage: 'completed', publishedAt: NOW })];
    const view = noticePresentation({ records }, NOW);
    assert.equal(view.tag, '原帖称已重置');
    assert.match(view.heading, /原帖 · 已读取/);
    assert.match(view.accountNote, /不代表本账户已生效/);
    assert.equal(view.tone, 'blue');
    records.push(record('12345678903', 'More resets coming next week', { eventId: 'two', publishedAt: NOW - HOUR }));
    assert.equal(noticePresentation({ records }, NOW).recordId, '12345678903');
});
test('verified explicit zoned deadline drives pending state; relative next week stays imprecise', async t => {
    const s = store(t, []);
    s.loadCommunity = async () => snapshot(NOW, [{ id: '12345678901', time: NOW - HOUR }]);
    s.loadOriginal = async () => original('12345678901', "We'll reset Codex usage limits by 2026-09-28T07:00:00Z.");
    await s.refresh(); assert.equal(noticePresentation(s.view(), NOW).tag, '重置待确认');
    assert.equal(s.view().records[0].deadlineAt, NOW - HOUR);
});
test('a targeted replacement original cannot validate a broad reset prediction', async t => {
    const s = store(t, []);
    s.loadCommunity = async () => snapshot(NOW, [{ id: '12345678901', time: NOW - HOUR }]);
    s.loadOriginal = async () => original('12345678901', "We've added a banked reset for affected Codex users whose card failed.");
    await s.refresh(); assert.equal(s.view().records[0].outcomeScope, 'targeted');
});
test('unreadable saved data is preserved instead of silently overwritten', t => {
    const s = store(t, []); fs.writeFileSync(s.file, '{broken json');
    const restarted = new ResetNotices(s.file, { now: () => NOW }); restarted.persist();
    assert.equal(fs.readFileSync(s.file, 'utf8'), '{broken json');
    assert.match(restarted.view().error, /读取/);
});
test('discussion of a past reset is not confirmation that a reset occurred', () => {
    assert.equal(classifyPost('The Codex reset was discussed yesterday.').stage, 'hint');
    assert.equal(classifyPost('We were considering Codex resets.').stage, 'hint');
    assert.equal(classifyPost('Reset all propagated. Sweet dreams.').stage, 'completed');
    assert.equal(classifyPost('The Codex usage limits have been reset.').stage, 'completed');
});
test('failed acknowledgement stays unread and a later successful save clears only its storage error', t => {
    const s = store(t, [record('12345678901', "We'll reset Codex limits.")]);
    const rename = fs.renameSync;
    try {
        fs.renameSync = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
        s.markRead('12345678901');
        assert.equal(s.view().unread, 1); assert.match(s.view().error, /保存/);
    } finally { fs.renameSync = rename; }
    s.markRead('12345678901'); assert.equal(s.view().unread, 0); assert.equal(s.view().error, null);
    s.error = '社区更新失败'; s.persist(); assert.equal(s.view().error, '社区更新失败');
});
