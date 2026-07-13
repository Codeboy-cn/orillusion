import { test, expect, end } from '../util'
import { BlendMode, Color, Engine3D, LitMaterial } from '@orillusion/core'

// Regression test for audit finding P1: LitMaterial.clone shared uniform
// object instances (Color/Vector4) with the source and dropped
// alphaMode/blend/cull/transparent state.

const engine = await Engine3D.init()

await test('recoloring a cloned material does not touch the source [audit P1]', async () => {
    const src = new LitMaterial(engine.context3D)
    src.baseColor = new Color(0.1, 0.2, 0.3, 1)

    const dst = src.clone() as LitMaterial
    dst.baseColor = new Color(1, 0, 0, 1)

    expect(src.baseColor.r).toSubequal(0.1, 0.0001)
    expect(src.baseColor.g).toSubequal(0.2, 0.0001)
    expect(dst.baseColor.r).toSubequal(1, 0.0001)

    // Mutating the clone's Color instance in place must not bleed either.
    dst.baseColor.g = 0.9
    expect(src.baseColor.g).toSubequal(0.2, 0.0001)
})

await test('clone carries render-state fields [audit P1]', async () => {
    const src = new LitMaterial(engine.context3D)
    src.alphaMode = 'BLEND'
    src.blendMode = BlendMode.ADD
    src.cullMode = 'front'
    src.castShadow = false

    const dst = src.clone() as LitMaterial
    expect(dst.alphaMode).toEqual('BLEND')
    expect(dst.blendMode).toEqual(BlendMode.ADD)
    expect(dst.cullMode).toEqual('front')
    expect(dst.castShadow).toEqual(false)
    expect(dst.transparent).toEqual(src.transparent)
})

setTimeout(end, 500)
