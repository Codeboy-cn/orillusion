import { test, expect, end } from '../util'
import { makeSequentialTriIndices, normalizeIndexArray } from '@orillusion/core'

// Regression tests for audit finding L3: non-indexed glTF primitives got
// Uint8Array indices (wrap at 256) and index widening keyed off element
// count instead of the maximum index value.

await test('86-triangle non-indexed primitive produces no index wrap [audit L3]', async () => {
    // 86 triangles = 258 vertices — indices above 255 used to wrap.
    const idx = makeSequentialTriIndices(258)
    expect(idx.length).toEqual(258)
    expect(idx instanceof Uint16Array).toEqual(true)
    // Last triangle: base 255 → (257, 255, 256) with the (2,0,1) winding.
    expect(idx[255]).toEqual(257)
    expect(idx[256]).toEqual(255)
    expect(idx[257]).toEqual(256)
    // Monotone coverage: every vertex referenced exactly once.
    const seen = new Set<number>()
    for (let i = 0; i < idx.length; i++) seen.add(idx[i])
    expect(seen.size).toEqual(258)

    // First triangle keeps the original winding.
    expect(idx[0]).toEqual(2)
    expect(idx[1]).toEqual(0)
    expect(idx[2]).toEqual(1)
})

await test('very large non-indexed primitive selects 32-bit indices [audit L3]', async () => {
    const idx = makeSequentialTriIndices(65538 * 3)
    expect(idx instanceof Uint32Array).toEqual(true)
    expect(idx[idx.length - 2]).toEqual(65538 * 3 - 3)
})

await test('normalizeIndexArray widens by max index value, not element count [audit L3]', async () => {
    // Short list referencing vertex 70000: element-count logic chose
    // Uint16 and truncated the value.
    const wide = normalizeIndexArray([0, 1, 70000])
    expect(wide instanceof Uint32Array).toEqual(true)
    expect(wide[2]).toEqual(70000)

    // Small values stay 16-bit.
    const narrow = normalizeIndexArray([0, 1, 2, 65535])
    expect(narrow instanceof Uint16Array).toEqual(true)
    expect(narrow[3]).toEqual(65535)

    // Existing typed arrays are returned by reference (no copy).
    const u16 = new Uint16Array([1, 2, 3])
    expect(normalizeIndexArray(u16) === u16).toEqual(true)
    const u32 = new Uint32Array([1, 2, 3])
    expect(normalizeIndexArray(u32) === u32).toEqual(true)
})

setTimeout(end, 500)
