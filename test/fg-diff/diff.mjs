#!/usr/bin/env node
// Pairwise PNG comparison. Phase A ships max-delta only; SSIM is a
// Phase C add-on once the Frame Graph render path exists and actually
// produces pixels to compare.
//
// Usage:
//   node test/fg-diff/diff.mjs <expected.png> <actual.png> [--threshold=2]
//
// Exit code 0 when every channel of every pixel is within +/-threshold
// LSBs of the baseline, 1 otherwise. Writes a summary line to stdout;
// fails loud to stderr on parse errors.

import { readFile } from 'fs/promises';
import zlib from 'zlib';
import { promisify } from 'util';

const inflate = promisify(zlib.inflate);

function parseArgs() {
    const out = { expected: null, actual: null, threshold: 2 };
    const pos = [];
    for (const a of process.argv.slice(2)) {
        if (a.startsWith('--threshold=')) out.threshold = Number(a.split('=')[1]);
        else pos.push(a);
    }
    if (pos.length !== 2) {
        console.error('usage: node test/fg-diff/diff.mjs <expected.png> <actual.png> [--threshold=N]');
        process.exit(2);
    }
    out.expected = pos[0];
    out.actual = pos[1];
    return out;
}

/**
 * Minimal PNG decoder sufficient for this harness. Supports:
 * - 8-bit RGB (color type 2) and RGBA (color type 6). Electron's
 *   `capturePage()` emits one or the other depending on platform.
 * - Single IDAT chunk or multiple concatenated IDATs.
 *
 * Rejects anything else loudly so callers do not silently diff a
 * wrong format. Intentionally does not handle interlacing, palettes,
 * or grayscale — those are out of scope for screenshot diffs.
 */
async function decodePng(path) {
    const buf = await readFile(path);
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47 || buf.readUInt32BE(4) !== 0x0D0A1A0A) {
        throw new Error(`${path}: not a PNG`);
    }
    let offset = 8;
    let width = 0, height = 0, bitDepth = 0, colorType = 0;
    const idatChunks = [];
    while (offset < buf.length) {
        const len = buf.readUInt32BE(offset); offset += 4;
        const type = buf.subarray(offset, offset + 4).toString('ascii'); offset += 4;
        const data = buf.subarray(offset, offset + len); offset += len;
        offset += 4; // CRC, skipped
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
                throw new Error(`${path}: unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType}); expected 8-bit RGB or RGBA`);
            }
        } else if (type === 'IDAT') {
            idatChunks.push(data);
        } else if (type === 'IEND') {
            break;
        }
    }
    const raw = await inflate(Buffer.concat(idatChunks));
    // Undo PNG filter types line-by-line. 3 bytes per pixel for RGB,
    // 4 for RGBA. Color type 2 = RGB, 6 = RGBA (validated above).
    const bpp = colorType === 6 ? 4 : 3;
    const stride = width * bpp;
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const rowStart = y * (stride + 1) + 1;
        const outStart = y * stride;
        for (let x = 0; x < stride; x++) {
            const cur = raw[rowStart + x];
            const left = x >= bpp ? pixels[outStart + x - bpp] : 0;
            const up = y > 0 ? pixels[outStart - stride + x] : 0;
            const upLeft = (x >= bpp && y > 0) ? pixels[outStart - stride + x - bpp] : 0;
            let recon;
            switch (filter) {
                case 0: recon = cur; break;                    // None
                case 1: recon = (cur + left) & 0xff; break;    // Sub
                case 2: recon = (cur + up) & 0xff; break;      // Up
                case 3: recon = (cur + ((left + up) >> 1)) & 0xff; break; // Average
                case 4: {                                       // Paeth
                    const p = left + up - upLeft;
                    const pa = Math.abs(p - left);
                    const pb = Math.abs(p - up);
                    const pc = Math.abs(p - upLeft);
                    const pred = (pa <= pb && pa <= pc) ? left : (pb <= pc) ? up : upLeft;
                    recon = (cur + pred) & 0xff;
                    break;
                }
                default: throw new Error(`${path}: unknown PNG filter ${filter} on row ${y}`);
            }
            pixels[outStart + x] = recon;
        }
    }
    return { width, height, pixels };
}

async function main() {
    const args = parseArgs();
    const [a, b] = await Promise.all([decodePng(args.expected), decodePng(args.actual)]);
    if (a.width !== b.width || a.height !== b.height) {
        console.error(`size mismatch: expected ${a.width}x${a.height}, actual ${b.width}x${b.height}`);
        process.exit(1);
    }
    let maxDelta = 0;
    let mismatched = 0;
    const total = a.pixels.length;
    for (let i = 0; i < total; i++) {
        const d = Math.abs(a.pixels[i] - b.pixels[i]);
        if (d > maxDelta) maxDelta = d;
        if (d > args.threshold) mismatched++;
    }
    const pct = (mismatched / total * 100).toFixed(4);
    console.log(`pixels=${a.width * a.height} maxDelta=${maxDelta} mismatched=${mismatched}/${total} (${pct}%) threshold=${args.threshold}`);
    process.exit(mismatched === 0 ? 0 : 1);
}

main().catch(e => {
    console.error(e.stack || e.message);
    process.exit(2);
});
