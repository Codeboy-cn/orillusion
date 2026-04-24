// Electron runner for the Frame Graph pixel-diff harness.
// Loads http://localhost:4000/test/fg-diff/?scene=<name>&mode=<legacy|fg>
// Captures a canvas screenshot on the harness `end` message.
// Exits non-zero on timeout / error so CI can gate on it.
//
// Usage:
//   npx electron test/fg-diff/runner.mjs --scene=cube_directional --mode=legacy
//   npx electron test/fg-diff/runner.mjs --scene=cube_directional --mode=fg

import { app, BrowserWindow } from 'electron/main';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';

app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'Vulkan,UseSkiaRenderer');

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '_out');
const TIMEOUT_MS = 30000;

function parseArgs() {
    const out = { scene: null, mode: 'legacy', frames: 3, host: 'http://localhost:4000' };
    for (const arg of process.argv.slice(2)) {
        const [k, v] = arg.replace(/^--/, '').split('=');
        if (k === 'scene') out.scene = v;
        else if (k === 'mode') out.mode = v;
        else if (k === 'frames') out.frames = Number.parseInt(v, 10);
        else if (k === 'host') out.host = v;
    }
    if (!out.scene) {
        console.error('error: --scene=<name> is required');
        process.exit(2);
    }
    if (out.mode !== 'legacy' && out.mode !== 'fg') {
        console.error(`error: --mode must be legacy|fg (got '${out.mode}')`);
        process.exit(2);
    }
    return out;
}

async function main() {
    const args = parseArgs();
    const url = `${args.host}/test/fg-diff/?scene=${encodeURIComponent(args.scene)}&mode=${args.mode}&frames=${args.frames}`;
    const outPng = join(OUT, `${args.scene}-${args.mode}.png`);

    await app.whenReady();
    await fs.mkdir(OUT, { recursive: true });

    const win = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: { offscreen: false, sandbox: false },
    });

    const logs = [];
    win.webContents.on('console-message', (_e, level, msg, line, source) => {
        const lv = ['verbose', 'info', 'warning', 'error'][level] || 'log';
        const s = `[${lv}] ${msg}  (${source}:${line})`;
        logs.push(s);
        process.stdout.write(s + '\n');
    });
    win.webContents.on('render-process-gone', (_e, details) => {
        logs.push(`render-process-gone: ${JSON.stringify(details)}`);
    });

    await win.loadURL(url);

    // Inject a listener that captures the harness end message.
    await win.webContents.executeJavaScript(`
        window.__endResult = null;
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'end') window.__endResult = e.data;
        });
        true;
    `);

    const deadline = Date.now() + TIMEOUT_MS;
    let endResult = null;
    while (!endResult && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 200));
        endResult = await win.webContents.executeJavaScript('window.__endResult');
    }

    let ok = false;
    if (!endResult) {
        logs.push(`TIMEOUT after ${TIMEOUT_MS} ms waiting for harness end event`);
    } else if (!endResult.pass) {
        logs.push(`harness reported failure: ${JSON.stringify(endResult)}`);
    } else {
        try {
            const png = await win.webContents.capturePage();
            await fs.writeFile(outPng, png.toPNG());
            logs.push(`screenshot saved: ${outPng}`);
            ok = true;
        } catch (e) {
            logs.push('capturePage failed: ' + e.message);
        }
    }

    await fs.writeFile(join(OUT, `${args.scene}-${args.mode}.log`), logs.join('\n'), 'utf8');
    process.exit(ok ? 0 : 1);
}

main().catch(async e => {
    console.error('runner exception:', e);
    process.exit(2);
});
