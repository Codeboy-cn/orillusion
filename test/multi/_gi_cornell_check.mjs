// GI regression check: loads gi/Sample_GICornellBox.ts and samples canvas
// pixels to assert the DDGI result is sane:
//   - left wall red-dominant, right wall green-dominant
//   - ceiling / upper back wall lit and not green-polluted (historical
//     probe GBuffer positionMap-clear bug)
//   - probe color bleeding visible: shadowed floor behind the tall box
//     reads the red wall's tint, floor by the green wall reads green
//   - ceiling / back-wall junction not blown to full saturation
// Coordinates assume the sample's stock camera (hoverCtrl distance 26)
// and its 2026-07 scene: cavity lit by a ceiling point light (0.8) plus
// the gltf's emissive lamp quad — no DirectLight, no sky (skyExposure 0).
// Assumes vite on :4000. Exit code 0 = pass.
//
// Usage: node test/multi/_gi_cornell_check.mjs [wait_ms]
import { spawn } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const HOST = 'http://localhost:4000';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WAIT_MS = Number(process.argv[2] ?? 40000);
const userDataDir = mkdtempSync(join(tmpdir(), 'cdp-gicheck-'));
const port = 9222 + Math.floor(Math.random() * 1000);

const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
    '--enable-unsafe-webgpu', '--enable-features=Vulkan',
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1024,768', '--window-position=2400,2400',
    'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => {}); chrome.stdout.on('data', () => {});

async function fetchJson(u) { return (await fetch(u)).json(); }
async function waitPort() {
    for (let i = 0; i < 60; i++) { try { return await fetchJson(`http://localhost:${port}/json/version`); } catch {} await new Promise(r => setTimeout(r, 250)); }
    throw new Error('no cdp');
}
class CDP {
    constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); this.l = new Set();
        ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
            if (m.id != null && this.p.has(m.id)) { const x = this.p.get(m.id); this.p.delete(m.id); m.error ? x.rej(new Error(m.error.message)) : x.res(m.result); }
            else if (m.method) for (const fn of this.l) fn(m); });
    }
    send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.p.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
}

async function main() {
    await waitPort();
    const tabs = await fetchJson(`http://localhost:${port}/json`);
    const tab = tabs.find(t => t.type === 'page');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r, rj) => { ws.addEventListener('open', r); ws.addEventListener('error', rj); });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Page.navigate', { url: HOST + '/' });
    await new Promise(r => { const off = (m) => { if (m.method === 'Page.loadEventFired') { cdp.l.delete(off); r(); } }; cdp.l.add(off); });
    await cdp.send('Runtime.evaluate', { expression: `sessionStorage.setItem('target', './gi/Sample_GICornellBox.ts')` });
    await cdp.send('Page.reload');
    await new Promise(r => { const off = (m) => { if (m.method === 'Page.loadEventFired') { cdp.l.delete(off); r(); } }; cdp.l.add(off); });
    await new Promise(r => setTimeout(r, WAIT_MS));

    const res = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
            const f = document.querySelector('iframe');
            const d = f.contentDocument, w = f.contentWindow;
            const src = d.querySelector('canvas');
            if (!src) return { err: 'no canvas' };
            const c = d.createElement('canvas');
            c.width = src.width; c.height = src.height;
            const ctx = c.getContext('2d');
            await new Promise(r => w.requestAnimationFrame(r));
            ctx.drawImage(src, 0, 0);
            function px(fx, fy) {
                const p = ctx.getImageData(Math.round(src.width * fx), Math.round(src.height * fy), 1, 1).data;
                return [p[0], p[1], p[2]];
            }
            // Ceiling/back-wall junction (~fy 0.198 at the stock camera).
            // A leak lights the concave corner ABOVE its flanking
            // surfaces; legitimately the corner is the darkest spot
            // (corner occlusion). Compare the junction against both
            // flanks instead of absolute values so lamp-driven ACES
            // saturation on the near-lamp ceiling cannot trip it.
            function lum(fx, fy) { const p = px(fx, fy); return (p[0] + p[1] + p[2]) / 3; }
            let seamMax = 0;
            for (let fy = 0.190; fy <= 0.206; fy += 0.002) seamMax = Math.max(seamMax, lum(0.5, fy));
            const seamFlankCeiling = lum(0.5, 0.172);
            const seamFlankWall = lum(0.5, 0.225);
            return {
                leftWall: px(0.12, 0.48),
                rightWall: px(0.87, 0.48),
                // 0.34 keeps the ceiling sample off the lamp quad, whose
                // reading swings between blown-out (emissive on) and pure
                // black (point-light-only benching) — neither says anything
                // about the GI field on the ceiling itself.
                ceiling: px(0.34, 0.11),
                backTop: px(0.50, 0.24),
                // red wall inside the tall box's shadow — direct light is
                // fully blocked there, so any red is bounce-carried
                bleedRed: px(0.247, 0.637),
                // green wall base at the bottom-right, likewise shadowed
                bleedGreen: px(0.880, 0.963),
                seamMax,
                seamFlankCeiling,
                seamFlankWall,
            };
        })()`,
        awaitPromise: true, returnByValue: true,
    });
    chrome.kill('SIGTERM');

    const v = res.result?.value;
    if (!v || v.err) { console.error('sample failed:', v && v.err); process.exit(2); }
    console.log(JSON.stringify(v));
    const fails = [];
    // Difference-based dominance: under the bright point light ACES
    // compresses ratios (a lit red wall reads ~240/167/158), so ratio
    // thresholds would need the red channel near saturation.
    const [lr, lg, lb] = v.leftWall;
    if (!(lr > 60 && lr > lg + 40 && lr > lb + 40)) fails.push(`leftWall not red-dominant: ${v.leftWall}`);
    const [rr, rg] = v.rightWall;
    if (!(rg > 60 && rg > rr + 25)) fails.push(`rightWall not green-dominant: ${v.rightWall}`);
    for (const name of ['ceiling', 'backTop']) {
        const [r, g, b] = v[name];
        const lum = (r + g + b) / 3;
        if (lum < 35) fails.push(`${name} too dark (dead GI): ${v[name]}`);
        if (g > r * 1.35 && g > b * 1.35) fails.push(`${name} green-polluted: ${v[name]}`);
    }
    const [br, bg] = v.bleedRed;
    if (!(br > 60 && br > bg + 30)) fails.push(`no bounce light on shadowed red wall: ${v.bleedRed}`);
    const [gr, gg, gb] = v.bleedGreen;
    if (!(gg > 60 && gg > gb + 15 && gg > gr + 15)) fails.push(`no bounce light on shadowed green wall: ${v.bleedGreen}`);
    // A leak lights the concave junction ABOVE both flanking surfaces;
    // legitimately it is the local minimum (corner occlusion).
    const flankMax = Math.max(v.seamFlankCeiling, v.seamFlankWall);
    if (v.seamMax > flankMax + 10) fails.push(`junction brighter than both flanks (leak): ${v.seamMax.toFixed(0)} vs flanks ${v.seamFlankCeiling.toFixed(0)}/${v.seamFlankWall.toFixed(0)}`);
    if (fails.length) {
        for (const m of fails) console.error('FAIL:', m);
        process.exit(1);
    }
    console.log('GI cornell check PASS');
    process.exit(0);
}
main().catch((e) => { console.error('err:', e); chrome.kill('SIGTERM'); process.exit(2); });
