import { test, expect, end } from '../util'
import { Engine3D } from '@orillusion/core'

// Regression tests for audit findings L1 / L7 (texture load failure
// propagation and Res concurrency dedup).

await test('missing texture rejects instead of hanging forever [audit L1]', async () => {
    const engine = await Engine3D.init()

    let rejected = false
    try {
        // The old hand-rolled promise never called reject: a 404/network
        // error left every awaiting caller pending forever (this test
        // would time out at the harness's 30s limit).
        await engine.res.loadTexture('/definitely-missing-texture-404.png')
    } catch (e) {
        rejected = true
    }
    expect(rejected).toEqual(true)

    // The failed URL must NOT be cached — a later attempt (e.g. after
    // the asset is deployed) retries the fetch instead of returning a
    // broken texture. Here it simply rejects again.
    let rejectedAgain = false
    try {
        await engine.res.loadTexture('/definitely-missing-texture-404.png')
    } catch (e) {
        rejectedAgain = true
    }
    expect(rejectedAgain).toEqual(true)
})

await test('failed batch load rejects instead of resolving with holes [audit L1]', async () => {
    const engine = await Engine3D.init()

    let rejected = false
    try {
        await engine.res.loadBitmapTextures([
            '/textures/line2.png',
            '/definitely-missing-texture-404.png',
        ], 2)
    } catch (e) {
        rejected = true
    }
    // A texture array with silent holes is worse than a visible failure.
    expect(rejected).toEqual(true)
})

setTimeout(end, 500)
