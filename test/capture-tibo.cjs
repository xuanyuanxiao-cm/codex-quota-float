const { app, BrowserWindow, ipcMain, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { TiboFeed } = require('../dist/tibo-feed');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tibo-capture-')));
app.whenReady().then(async () => {
    if (process.argv.includes('--probe')) {
        const source = require('../dist/tibo-source').createTiboSource({ fetchImpl: net.fetch.bind(net) });
        const page = await source.loadPage({ since: Date.now() - 30 * 86400000 });
        const record = page.records.find(r => r.type === 'post');
        const translated = await source.hydrate(record);
        console.log(JSON.stringify({ electronNetwork: true, records: page.records.length, translationMatched: translated.originalText === record.originalText, chinese: Boolean(translated.chineseText) }));
    }
    const feed = new TiboFeed(path.join(__dirname, '../release/tibo-preview/live-feed.json'));
    ipcMain.handle('quota:read-tibo', () => feed.view());
    ipcMain.handle('quota:read-notices', () => ({ unread: 0 }));
    const win = new BrowserWindow({ width: 620, height: 920, show: false, webPreferences: { preload: path.join(__dirname, '../dist/preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    await win.loadFile(path.join(__dirname, '../dist/renderer/tibo.html'));
    await new Promise(resolve => setTimeout(resolve, 500));
    const layout = await win.webContents.executeJavaScript('({ posts:document.querySelectorAll(".feed-post").length, overflow:document.body.scrollWidth>innerWidth })');
    fs.writeFileSync(path.join(__dirname, '../release/tibo-preview/tibo-live.png'), (await win.webContents.capturePage()).toPNG());
    console.log(JSON.stringify(layout)); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
