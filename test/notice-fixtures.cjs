const url = id => `https://x.com/thsottiaux/status/${id}`;
const postText = "We'll reset usage limits for all paid users across Codex.";
const original = (id, text = postText) => `<p>Author: Tibo @thsottiaux URL: ${url(id)}</p><h2>Post</h2><p>${text}</p><h2>Thread</h2><p>Replies are excluded</p>`;
function snapshot(now, items = [], active = true) {
    const latest = items[0];
    return { schemaVersion: 'public-v1', checkedAt: new Date(now).toISOString(), dataHealth: { overall: 'ok', stale: false },
        viewModel: { probability24h: 0.35, activeWindow: latest && active ? { active: true, kind: 'official', noticeKind: 'forced', source: url(latest.id), openedAt: new Date(latest.time).toISOString(), summary: postText } : null,
            recentHistory: items.map(r => ({ recordKind: 'confirmed_global', source: url(r.id), date: new Date(r.time).toISOString(), summary: r.text || postText })) },
        latestTiboActivity: latest ? { classification: 'official_notice', sourceUrl: url(latest.id), createdAt: new Date(latest.time).toISOString(), text: latest.text || postText } : null };
}
module.exports = { url, postText, original, snapshot };
