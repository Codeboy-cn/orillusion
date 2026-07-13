import { test, expect, end } from '../util'
import { BytesArray } from '@orillusion/core'

// Regression tests for audit finding P4: the prefab binary reader's
// primitives were misaligned (readBoolean double-advanced, readByte read
// undefined, readUnit16/32 read big-endian, readUTF mangled non-ASCII).

function buildStream(): ArrayBuffer {
    const text = new TextEncoder().encode('名字abc')
    const pad = (4 - (text.length % 4)) % 4
    const size = 4 /*bool*/ + 4 /*int after bool*/ + 4 + text.length + pad /*utf*/ + 2 /*u16*/ + 4 /*u32*/ + 1 /*byte*/
    const buf = new ArrayBuffer(size)
    const dv = new DataView(buf)
    let o = 0
    dv.setInt32(o, 1, true); o += 4                       // boolean true
    dv.setInt32(o, 12345, true); o += 4                   // the field right after
    dv.setInt32(o, text.length, true); o += 4             // utf length
    new Uint8Array(buf, o, text.length).set(text); o += text.length + pad
    dv.setUint16(o, 0xBEEF, true); o += 2                 // little-endian u16
    dv.setUint32(o, 0xDEADBEEF, true); o += 4             // little-endian u32
    dv.setUint8(o, 200); o += 1                           // single byte
    return buf
}

await test('BytesArray primitives read a little-endian stream correctly [audit P4]', async () => {
    const bytes = new BytesArray(buildStream())

    expect(bytes.readBoolean()).toEqual(true)
    // The double-advance used to swallow this field entirely.
    expect(bytes.readInt32()).toEqual(12345)
    // Non-ASCII UTF-8 survives decoding.
    expect(bytes.readUTF()).toEqual('名字abc')
    expect(bytes.readUnit16()).toEqual(0xBEEF)
    expect(bytes.readUnit32()).toEqual(0xDEADBEEF)
    // readByte used to index the ArrayBuffer itself → undefined.
    expect(bytes.readByte()).toEqual(200)
})

await test('BytesArray view with a non-zero byteOffset is not double-offset [audit P4]', async () => {
    const stream = buildStream()
    const shifted = new ArrayBuffer(stream.byteLength + 8)
    new Uint8Array(shifted, 8).set(new Uint8Array(stream))

    const bytes = new BytesArray(shifted, 8)
    expect(bytes.readBoolean()).toEqual(true)
    expect(bytes.readInt32()).toEqual(12345)
    expect(bytes.readUTF()).toEqual('名字abc')
})

setTimeout(end, 500)
