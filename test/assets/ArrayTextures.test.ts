import { test, expect, end, delay } from '../util'
import { Engine3D, Float16ArrayTexture, Float32ArrayTexture, Uint8ArrayTexture } from '@orillusion/core'

// Regression tests for audit findings L8 / P2: array textures used a
// 256-aligned staging copy against tightly-packed CPU data (invalid or
// row-skewed for most widths), mipmapCount broke for 1-pixel dimensions,
// and Res.createTexture ignored its width/height parameters.

async function readbackRGBA8(ctx: any, tex: any, w: number, h: number): Promise<Uint8Array> {
    const device = ctx.device
    const bpr = Math.ceil((w * 4) / 256) * 256
    const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const enc = device.createCommandEncoder()
    enc.copyTextureToBuffer(
        { texture: tex.getGPUTexture() },
        { buffer: buf, bytesPerRow: bpr, rowsPerImage: h },
        { width: w, height: h, depthOrArrayLayers: 1 },
    )
    device.queue.submit([enc.finish()])
    await buf.mapAsync(GPUMapMode.READ)
    const mapped = new Uint8Array(buf.getMappedRange())
    const out = new Uint8Array(w * h * 4)
    for (let row = 0; row < h; row++) {
        out.set(mapped.subarray(row * bpr, row * bpr + w * 4), row * w * 4)
    }
    buf.unmap()
    buf.destroy()
    return out
}

function pattern(w: number, h: number): Uint8Array {
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
        data[i * 4 + 0] = i % 251
        data[i * 4 + 1] = (i * 7) % 251
        data[i * 4 + 2] = (i * 13) % 251
        data[i * 4 + 3] = 255
    }
    return data
}

await test('Uint8ArrayTexture works at odd widths with exact readback [audit L8/P2]', async () => {
    const engine = await Engine3D.init()
    const ctx = engine.context3D

    let uncaptured = 0
    ctx.device.addEventListener('uncapturederror', () => { uncaptured++ })

    for (const [w, h] of [[5, 3], [33, 2], [1, 1]] as Array<[number, number]>) {
        const data = pattern(w, h)
        const tex = new Uint8ArrayTexture()
        tex.create(w, h, data, w === 1, ctx)

        const back = await readbackRGBA8(ctx, tex, w, h)
        let equal = true
        for (let i = 0; i < data.length; i++) {
            if (back[i] !== data[i]) { equal = false; break }
        }
        expect(equal).toEqual(true)
    }

    await delay(200)
    expect(uncaptured).toEqual(0)
})

await test('array textures throw a readable error on insufficient data [audit P2]', async () => {
    const engine = await Engine3D.init()
    const ctx = engine.context3D

    let message = ''
    try {
        new Uint8ArrayTexture().create(8, 8, new Uint8Array(16), false, ctx)
    } catch (e: any) {
        message = String(e?.message ?? e)
    }
    expect(message.indexOf('needs') >= 0).toEqual(true)

    message = ''
    try {
        new Float32ArrayTexture().create(8, 8, new Float32Array(16), false, ctx)
    } catch (e: any) {
        message = String(e?.message ?? e)
    }
    expect(message.indexOf('needs') >= 0).toEqual(true)

    message = ''
    try {
        new Float16ArrayTexture().create(8, 8, [0, 0, 0, 0], false, ctx)
    } catch (e: any) {
        message = String(e?.message ?? e)
    }
    expect(message.indexOf('needs') >= 0).toEqual(true)
})

await test('Float32/Float16 textures accept non-aligned widths [audit P2]', async () => {
    const engine = await Engine3D.init()
    const ctx = engine.context3D

    let uncaptured = 0
    ctx.device.addEventListener('uncapturederror', () => { uncaptured++ })

    // width 5: bytesPerRow 80 (f32) / 40 (f16) — both were illegal on the
    // old copyBufferToTexture path.
    const f32 = new Float32ArrayTexture()
    f32.create(5, 2, new Float32Array(5 * 2 * 4).fill(0.25), false, ctx)

    const f16 = new Float16ArrayTexture()
    f16.create(5, 2, new Array(5 * 2 * 4).fill(0.5), false, ctx)

    // fromBuffer keeps the aligned copy path and must reject misaligned widths.
    let message = ''
    try {
        const gpuBuf = ctx.device.createBuffer({ size: 5 * 2 * 16, usage: GPUBufferUsage.COPY_SRC })
        new Float32ArrayTexture().fromBuffer(5, 2, gpuBuf, ctx)
    } catch (e: any) {
        message = String(e?.message ?? e)
    }
    expect(message.indexOf('multiple of 16') >= 0).toEqual(true)

    await delay(200)
    expect(uncaptured).toEqual(0)
})

await test('Res.createTexture honours its width/height parameters [audit L8]', async () => {
    const engine = await Engine3D.init()
    const tex = engine.res.createTexture(8, 4, 255, 0, 0, 255, 'test-8x4')
    expect(tex.width).toEqual(8)
    expect(tex.height).toEqual(4)
})

setTimeout(end, 500)
