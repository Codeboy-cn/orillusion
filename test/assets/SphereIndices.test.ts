import { test, expect, end } from '../util'
import { Engine3D, SphereGeometry, VertexAttributeName } from '@orillusion/core'

// Regression test for audit finding P9: SphereGeometry allocated its
// index buffer at full quad capacity, but the pole rings only emit one
// triangle per quad — the 2*segW*3 unwritten slots stayed as (0,0,0)
// degenerate triangles that raycasts and statistics still visited.

await test('16x12 sphere has zero degenerate triangles [audit P9]', async () => {
    await Engine3D.init()

    const segW = 16, segH = 12
    const geo = new SphereGeometry(1, segW, segH)
    const idx = geo.getAttribute(VertexAttributeName.indices).data as Uint16Array

    // Actual triangle budget: two per quad, minus one per pole-ring quad.
    expect(idx.length).toEqual(segW * segH * 2 * 3 - 2 * segW * 3)

    let degenerate = 0
    for (let i = 0; i < idx.length; i += 3) {
        if (idx[i] === idx[i + 1] || idx[i + 1] === idx[i + 2] || idx[i] === idx[i + 2]) degenerate++
    }
    expect(degenerate).toEqual(0)

    // Subgeometry index count matches what was written.
    expect((geo as any).subGeometries[0].lodLevels?.[0]?.indexCount ?? (geo as any).subGeometries[0].indexCount).toEqual(idx.length)
})

setTimeout(end, 500)
