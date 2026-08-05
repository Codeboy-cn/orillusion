import { test, expect, end } from '../util'
import { Engine3D, GLBParser } from '@orillusion/core'

// Regression tests for audit findings L5 (GLB bounds/external images) and
// L4 (UTF-8 JSON chunk decoding). All fixtures are built in memory.

const JSON_TYPE = 0x4e4f534a
const BIN_TYPE = 0x004e4942

function buildGLB(json: any, bin?: Uint8Array): ArrayBuffer {
    const enc = new TextEncoder()
    let jsonBytes: Uint8Array = enc.encode(JSON.stringify(json))
    const pad = (4 - (jsonBytes.length % 4)) % 4
    if (pad) {
        const padded = new Uint8Array(jsonBytes.length + pad)
        padded.set(jsonBytes)
        padded.fill(0x20, jsonBytes.length)
        jsonBytes = padded
    }
    const binPadded = bin ? Math.ceil(bin.length / 4) * 4 : 0
    const total = 12 + 8 + jsonBytes.length + (bin ? 8 + binPadded : 0)
    const buf = new ArrayBuffer(total)
    const dv = new DataView(buf)
    dv.setUint32(0, 0x46546c67, true)
    dv.setUint32(4, 2, true)
    dv.setUint32(8, total, true)
    dv.setUint32(12, jsonBytes.length, true)
    dv.setUint32(16, JSON_TYPE, true)
    new Uint8Array(buf, 20, jsonBytes.length).set(jsonBytes)
    if (bin) {
        const off = 20 + jsonBytes.length
        dv.setUint32(off, binPadded, true)
        dv.setUint32(off + 4, BIN_TYPE, true)
        new Uint8Array(buf, off + 8, bin.length).set(bin)
    }
    return buf
}

function minimalGltf(extra: any = {}): any {
    return Object.assign({
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [] }],
        nodes: [],
    }, extra)
}

async function expectThrow(run: () => Promise<any>): Promise<string> {
    try {
        await run()
    } catch (e: any) {
        return String(e?.message ?? e)
    }
    return ''
}

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

await test('truncated GLB throws a readable error [audit L5]', async () => {
    const engine = await Engine3D.init()
    const full = buildGLB(minimalGltf({ buffers: [{ byteLength: 4 }] }), new Uint8Array([1, 2, 3, 4]))

    const parser = new GLBParser()
    ;(parser as any).ctx = engine.context3D
    parser.baseUrl = '/'
    parser.initUrl = '/mem.glb'

    const message = await expectThrow(() => parser.parseBuffer(full.slice(0, full.byteLength - 6)))
    expect(message.indexOf('truncated') >= 0).toEqual(true)
})

await test('chunk declaring more bytes than the file holds throws [audit L5]', async () => {
    const engine = await Engine3D.init()
    const full = buildGLB(minimalGltf())
    // Corrupt the JSON chunk length to reach far past the end.
    const dv = new DataView(full)
    dv.setUint32(12, 0x0fffffff, true)

    const parser = new GLBParser()
    ;(parser as any).ctx = engine.context3D
    const message = await expectThrow(() => parser.parseBuffer(full))
    expect(message.length > 0).toEqual(true)
})

await test('GLB with declared buffer but missing BIN chunk throws [audit L5]', async () => {
    const engine = await Engine3D.init()
    const noBin = buildGLB(minimalGltf({ buffers: [{ byteLength: 16 }] }))

    const parser = new GLBParser()
    ;(parser as any).ctx = engine.context3D
    const message = await expectThrow(() => parser.parseBuffer(noBin))
    expect(message.indexOf('BIN') >= 0).toEqual(true)
})

await test('non-GLB magic throws instead of returning false [audit L5]', async () => {
    const engine = await Engine3D.init()
    const junk = new Uint8Array(32)
    junk.fill(0xab)

    const parser = new GLBParser()
    ;(parser as any).ctx = engine.context3D
    const message = await expectThrow(() => parser.parseBuffer(junk.buffer))
    expect(message.indexOf('magic') >= 0).toEqual(true)
})

await test('Chinese scene/material names survive UTF-8 decoding [audit L4]', async () => {
    const engine = await Engine3D.init()
    const glb = buildGLB(minimalGltf({ scenes: [{ nodes: [], name: '中文场景名' }] }))

    const parser = new GLBParser()
    ;(parser as any).ctx = engine.context3D
    parser.baseUrl = '/'
    parser.initUrl = '/mem.glb'
    await parser.parseBuffer(glb)
    // Latin-1 decoding produced mojibake here.
    expect((parser as any)._gltf.scenes[0].name).toEqual('中文场景名')
})

await test('GLB image with a data: URI loads instead of crashing [audit L5]', async () => {
    const engine = await Engine3D.init()
    const glb = buildGLB(minimalGltf({ images: [{ uri: PNG_1x1, name: 'dot' }] }))

    const parser = new GLBParser()
    ;(parser as any).ctx = engine.context3D
    parser.baseUrl = '/'
    parser.initUrl = '/mem.glb'
    await parser.parseBuffer(glb)
    // The old code dereferenced image.bufferView.toString() and threw.
    expect(!!(parser as any)._gltf.resources['dot']).toEqual(true)
})

await test('GLB image with neither uri nor bufferView throws [audit L5]', async () => {
    const engine = await Engine3D.init()
    const glb = buildGLB(minimalGltf({ images: [{ name: 'broken' }] }))

    const parser = new GLBParser()
    ;(parser as any).ctx = engine.context3D
    const message = await expectThrow(() => parser.parseBuffer(glb))
    expect(message.indexOf('bufferView') >= 0).toEqual(true)
})

setTimeout(end, 500)
