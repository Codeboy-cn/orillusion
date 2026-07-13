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

await test('concurrent loads of the same texture fetch once and share the instance [audit L7]', async () => {
    const engine = await Engine3D.init()
    const origFetch = window.fetch
    let fetchCount = 0
    window.fetch = ((...args: any[]) => { fetchCount++; return (origFetch as any).apply(window, args) }) as any
    try {
        const [a, b] = await Promise.all([
            engine.res.loadTexture('/textures/line3.png'),
            engine.res.loadTexture('/textures/line3.png'),
        ])
        expect(a === b).toEqual(true)
        // Two racing callers used to fetch and upload twice, leaking the
        // losing GPU texture.
        expect(fetchCount).toEqual(1)
    } finally {
        window.fetch = origFetch
    }
})

await test('a failed load can be retried (in-flight entry self-deletes) [audit L7]', async () => {
    const engine = await Engine3D.init()

    let firstRejected = false
    try {
        await engine.res.loadTexture('/missing-then-retried.png')
    } catch (e) {
        firstRejected = true
    }
    expect(firstRejected).toEqual(true)

    // Retry must run a real second attempt (the in-flight map entry was
    // removed on rejection) — still missing here, so it rejects again
    // rather than returning a stale settled promise or hanging.
    let secondRejected = false
    try {
        await engine.res.loadTexture('/missing-then-retried.png')
    } catch (e) {
        secondRejected = true
    }
    expect(secondRejected).toEqual(true)
})

await test('loadObj rejects a non-.obj url with a readable error [audit L7]', async () => {
    const engine = await Engine3D.init()
    let message = ''
    try {
        await engine.res.loadObj('/gltfs/whatever.gltf')
    } catch (e: any) {
        message = String(e?.message ?? e)
    }
    expect(message.indexOf('.obj') >= 0).toEqual(true)
})

setTimeout(end, 500)
