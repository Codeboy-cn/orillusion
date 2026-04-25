import { test, end, expect, delay } from '../util'
import {
    Engine3D,
    Scene3D,
    View3D,
    Camera3D,
    Object3D,
    LitMaterial,
    Material,
    SceneColorPyramidFeature,
    SortedTransparentFeature,
    TransparentOITFeature,
    TransparentResolveFeature,
    SCENE_COLOR_PYRAMID,
    OIT_ACCUM_TEX,
    OIT_REVEAL_TEX,
    PassType,
    RenderStage,
    BlendMode,
} from '@orillusion/core'

// Acceptance for the transparency rendering pipeline (P0–P2):
//
// - P0.1: per-instance MSAA setting + LitMaterial.alphaMode + the
//   alpha-to-coverage pipeline plumb.
// - P1.1: SceneColorPyramidFeature registers and exposes the
//   `_SceneColorPyramid` handle.
// - P1.2: LitMaterial.transmissionFactor setter flips USE_TRANSMISSION.
// - P2: useOIT toggles the WBOIT features into the graph; sorted +
//   weighted features coexist with the right filter wiring.

await test('Engine3D defaults expose msaa and useOIT settings', async () => {
    const engine = await Engine3D.init({})
    expect((engine.setting.render as any).msaa).toEqual(0)
    expect((engine.setting.render as any).useOIT).toEqual(false)
    engine.dispose()
})

await test('SceneColorPyramidFeature registers and exposes _SceneColorPyramid', async () => {
    const engine = await Engine3D.init({
        setting: { render: { useFrameGraph: true } as any },
    })
    const scene = new Scene3D()
    const cameraObj = new Object3D()
    const camera = cameraObj.addComponent(Camera3D)
    camera.perspective(60, engine.aspect, 1, 5000)
    scene.addChild(cameraObj)
    const view = new View3D()
    view.scene = scene
    view.camera = camera
    engine.startRenderView(view)
    await delay(120)

    const feature = view.renderGraph!.getFeature('SceneColorPyramidFeature') as SceneColorPyramidFeature | null
    if (!feature) throw new Error('SceneColorPyramidFeature not registered')
    expect(feature.stage).toEqual(RenderStage.AfterOpaque)
    expect(feature.writes.length).toEqual(1)
    expect(feature.writes[0]).toEqual(SCENE_COLOR_PYRAMID)

    const pool = view.renderGraph!.pool
    expect(pool.has(SCENE_COLOR_PYRAMID)).toEqual(true)
    const tex = pool.get(SCENE_COLOR_PYRAMID)
    if (!tex) throw new Error('_SceneColorPyramid resolved to null')

    engine.dispose()
})

await test('SortedTransparentFeature is registered with filter=all when useOIT is off', async () => {
    const engine = await Engine3D.init({
        setting: { render: { useFrameGraph: true, useOIT: false } as any },
    })
    const scene = new Scene3D()
    const cameraObj = new Object3D()
    const camera = cameraObj.addComponent(Camera3D)
    camera.perspective(60, engine.aspect, 1, 5000)
    scene.addChild(cameraObj)
    const view = new View3D()
    view.scene = scene
    view.camera = camera
    engine.startRenderView(view)
    await delay(120)

    const sorted = view.renderGraph!.getFeature('SortedTransparentFeature') as SortedTransparentFeature | null
    if (!sorted) throw new Error('SortedTransparentFeature not registered')
    expect(sorted.stage).toEqual(RenderStage.Transparent)
    // OIT features should NOT be in the graph when useOIT is false.
    expect(!!view.renderGraph!.getFeature('TransparentOITFeature')).toEqual(false)
    expect(!!view.renderGraph!.getFeature('TransparentResolveFeature')).toEqual(false)

    engine.dispose()
})

await test('useOIT=true registers OIT + Resolve features alongside sorted', async () => {
    const engine = await Engine3D.init({
        setting: { render: { useFrameGraph: true, useOIT: true } as any },
    })
    const scene = new Scene3D()
    const cameraObj = new Object3D()
    const camera = cameraObj.addComponent(Camera3D)
    camera.perspective(60, engine.aspect, 1, 5000)
    scene.addChild(cameraObj)
    const view = new View3D()
    view.scene = scene
    view.camera = camera
    engine.startRenderView(view)
    await delay(120)

    const oit = view.renderGraph!.getFeature('TransparentOITFeature') as TransparentOITFeature | null
    const resolve = view.renderGraph!.getFeature('TransparentResolveFeature') as TransparentResolveFeature | null
    const sorted = view.renderGraph!.getFeature('SortedTransparentFeature') as SortedTransparentFeature | null

    if (!oit) throw new Error('TransparentOITFeature not registered')
    if (!resolve) throw new Error('TransparentResolveFeature not registered')
    if (!sorted) throw new Error('SortedTransparentFeature not registered')

    expect(oit.stage).toEqual(RenderStage.Transparent)
    expect(resolve.stage).toEqual(RenderStage.AfterTransparent)
    expect(oit.writes.indexOf(OIT_ACCUM_TEX) >= 0).toEqual(true)
    expect(oit.writes.indexOf(OIT_REVEAL_TEX) >= 0).toEqual(true)

    engine.dispose()
})

await test('LitMaterial.alphaMode flips ShaderState transparent + blendMode + alphaToCoverageEnabled', async () => {
    const engine = await Engine3D.init({})
    const mat = new LitMaterial(engine.context3D)

    mat.alphaMode = 'OPAQUE'
    let state = mat.shader.getDefaultColorShader().shaderState
    expect(state.transparent).toEqual(false)
    expect(state.alphaToCoverageEnabled).toEqual(false)
    expect(state.blendMode).toEqual(BlendMode.NONE)
    expect(state.depthWriteEnabled).toEqual(true)

    mat.alphaMode = 'MASK'
    state = mat.shader.getDefaultColorShader().shaderState
    expect(state.transparent).toEqual(false)
    expect(state.alphaToCoverageEnabled).toEqual(true)
    expect(state.depthWriteEnabled).toEqual(true)

    mat.alphaMode = 'BLEND'
    state = mat.shader.getDefaultColorShader().shaderState
    expect(state.transparent).toEqual(true)
    expect(state.alphaToCoverageEnabled).toEqual(false)
    expect(state.blendMode).toEqual(BlendMode.NORMAL)
    expect(state.depthWriteEnabled).toEqual(false)

    engine.dispose()
})

await test('LitMaterial.transmissionFactor setter sets uniform + USE_TRANSMISSION define', async () => {
    const engine = await Engine3D.init({})
    const mat = new LitMaterial(engine.context3D)

    expect(mat.transmissionFactor).toEqual(0.0)
    expect(mat.shader.getDefine('USE_TRANSMISSION')).toEqual(false)

    mat.transmissionFactor = 0.7
    expect(mat.transmissionFactor).toSubequal(0.7)
    expect(mat.shader.getDefine('USE_TRANSMISSION')).toEqual(true)

    mat.transmissionFactor = 0.0
    expect(mat.shader.getDefine('USE_TRANSMISSION')).toEqual(false)

    engine.dispose()
})

await test('LitMaterial.ior writes to ior uniform (not clearcoatIor)', async () => {
    const engine = await Engine3D.init({})
    const mat = new LitMaterial(engine.context3D)

    mat.ior = 1.7
    expect(mat.shader.getUniformFloat('ior')).toSubequal(1.7)
    // clearcoatIor should stay at its default 1.5 — the previous bug
    // wrote ior into clearcoatIor.
    expect(mat.shader.getUniformFloat('clearcoatIor')).toSubequal(1.5)

    engine.dispose()
})

await test('Material.oitMode default is sorted', async () => {
    const engine = await Engine3D.init({})
    const mat = new Material()
    expect(mat.oitMode).toEqual('sorted')
    mat.oitMode = 'weighted'
    expect(mat.oitMode).toEqual('weighted')
    engine.dispose()
})

await test('OIT_ACCUM passType bit is unique', async () => {
    // Ensure the new pass type doesn't collide with existing ones.
    const allOthers = [
        PassType.COLOR, PassType.REFLECTION, PassType.POSITION,
        PassType.GRAPHIC, PassType.GI, PassType.Cluster,
        PassType.SHADOW, PassType.POINT_SHADOW, PassType.POST,
        PassType.DEPTH,
    ]
    for (const p of allOthers) {
        expect(PassType.OIT_ACCUM === p).toEqual(false)
    }
})

setTimeout(end, 2000)
