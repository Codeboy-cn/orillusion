// Probe a single sample against vite :4000. Usage:
//   electron test/multi/sample_check_one.mjs <sample-rel-path>
// e.g. sprite/Sample_Sprite_Quad.ts

import { app, BrowserWindow } from 'electron/main';

app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'Vulkan,UseSkiaRenderer');

const HOST = 'http://localhost:4000';
const WAIT_MS = 4000;

const sample = process.argv[process.argv.length - 1];
if (!sample || !sample.endsWith('.ts')) {
    process.stdout.write(`usage: electron sample_check_one.mjs <rel-path-ending-in.ts>\n`);
    process.exit(2);
}

const errors = [];
const logs = [];
function log(level, line) {
    const s = `[${level}] ${line}`;
    logs.push(s);
    if (level === 'error') errors.push(s);
}

async function main() {
    await app.whenReady();

    const win = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: { offscreen: false, sandbox: false },
    });
    win.webContents.on('console-message', (_e, level, msg) => {
        const lv = ['verbose', 'info', 'warning', 'error'][level] || 'log';
        log(lv, msg);
    });

    await win.loadURL(HOST + '/samples/');
    await win.webContents.executeJavaScript(`sessionStorage.setItem('target', '${sample}'); true`);
    await win.loadURL(HOST + '/samples/');
    await new Promise((r) => setTimeout(r, WAIT_MS));

    const fatal = errors.filter(
        (e) =>
            !e.includes('Electron Security') &&
            !e.includes('Content Security') &&
            !e.includes('Autofill.enable') &&
            !e.includes('Download the React') &&
            !e.includes('DevTools') &&
            !e.includes('"devtoolsUrl"'),
    );
    const warnLines = logs.filter((l) => l.startsWith('[warning]'));

    process.stdout.write(`===== ${sample} =====\n`);
    process.stdout.write(`logs: ${logs.length}   errors: ${fatal.length}   warnings: ${warnLines.length}\n`);
    for (const l of logs) process.stdout.write(l + '\n');
    process.exit(fatal.length ? 1 : 0);
}

main().catch((e) => {
    process.stderr.write('probe exception: ' + (e.stack || e.message) + '\n');
    process.exit(2);
});
