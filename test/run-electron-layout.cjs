const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.FIRECRAWL_API_KEY;
const args = process.argv.slice(2);
const script = args.includes('--regressions') ? 'electron-regressions.cjs' : args.includes('--notices') ? 'electron-notices.cjs' : args.includes('--trends') ? 'electron-trends.cjs' : args.includes('--alerts') ? 'electron-alerts.cjs' : 'electron-layout.cjs';
const result = spawnSync(require('electron'), [path.join(__dirname, script), ...args.filter((arg) => !['--alerts', '--trends', '--notices', '--regressions'].includes(arg))], {
  env, stdio: 'inherit', windowsHide: true,
});
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
