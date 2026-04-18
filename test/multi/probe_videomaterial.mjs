// One-off probe for Sample_VideoMaterial that dumps ALL errors + screenshot.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_JS = join(__dirname, 'playwright', 'main.js');
const HOST = 'http://localhost:4000';

const app = await electron.launch({ executablePath: electronPath, args: [MAIN_JS], timeout: 30000 });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');

const BENIGN = [
    /Insecure Content-Security-Policy/i,
    /ExternalTexture.*not active/i,
    /While calling \[Queue\]/i,
    /devtoolsUrl/,
];
const isBenign = (s) => BENIGN.some(r => r.test(s));

page.on('console', msg => {
    const t = msg.type();
    if (t === 'log' || t === 'info' || t === 'debug') return;
    const txt = msg.text();
    if (isBenign(txt)) return;
    console.log(`[${t}]`, txt);
});
page.on('pageerror', err => console.log(`[pageerror]`, err.message));

await page.goto(HOST + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => {
    sessionStorage.setItem('target', t);
    sessionStorage.setItem('top', '0');
}, './material/Sample_VideoMaterial.ts');
await page.goto('about:blank');
await page.goto(HOST + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(10000);

console.log('--- capturing screenshot ---');
await page.screenshot({ path: 'test/multi/_out/videomaterial_debug.png', fullPage: false });

console.log('--- end of probe ---');
await app.close();
