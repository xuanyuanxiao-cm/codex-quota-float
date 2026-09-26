"use strict";
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const quote = (value) => `'${value.replace(/'/g, "''")}'`;

class CodexAutoStart {
    constructor(userData, startup, executable, options = {}) {
        this.file = path.join(userData, 'codex-follow.json');
        this.script = path.join(userData, 'follow-codex.ps1');
        this.shortcut = path.join(startup, 'Codex Quota Float Follow.lnk');
        this.executable = executable;
        this.execFile = options.execFile ?? childProcess.execFile;
        this.spawn = options.spawn ?? childProcess.spawn;
        this.powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        this.enabled = false;
        this.configured = false;
        try {
            const settings = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            this.enabled = settings.enabled === true;
            this.configured = true;
        } catch {}
    }
    async setEnabled(enabled) {
        if (!enabled) {
            fs.writeFileSync(this.file, JSON.stringify({ enabled: false, executable: this.executable }));
            fs.rmSync(this.shortcut, { force: true });
            this.enabled = false;
            this.configured = true;
            return;
        }
        fs.copyFileSync(path.join(__dirname, 'follow-codex.ps1'), this.script);
        fs.writeFileSync(this.file, JSON.stringify({ enabled: true, executable: this.executable }));
        const args = `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${this.script}"`;
        const command = `$shell = New-Object -ComObject WScript.Shell; $link = $shell.CreateShortcut(${quote(this.shortcut)}); $link.TargetPath = ${quote(this.powershell)}; $link.Arguments = ${quote(args)}; $link.WindowStyle = 7; $link.Description = '打开 Codex 时自动启动额度悬浮球'; $link.Save()`;
        try {
            await new Promise((resolve, reject) => this.execFile(this.powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 }, (error) => error ? reject(error) : resolve()));
            const watcher = this.spawn(this.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', this.script], { detached: true, stdio: 'ignore', windowsHide: true });
            await new Promise((resolve, reject) => { watcher.once('spawn', resolve); watcher.once('error', reject); });
            watcher.unref();
            this.enabled = true;
            this.configured = true;
        } catch (error) {
            fs.writeFileSync(this.file, JSON.stringify({ enabled: false, executable: this.executable }));
            fs.rmSync(this.shortcut, { force: true });
            this.enabled = false;
            throw error;
        }
    }
}
module.exports = { CodexAutoStart };
