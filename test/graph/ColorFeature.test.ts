import { test, end, expect, delay } from '../util'
import {
    Engine3D,
    Scene3D,
    View3D,
    Camera3D,
    Object3D,
    ColorFeature,
    COLOR_BUFFER,
    NORMAL_BUFFER,
    CLUSTER_LIGHTING_BUFFER,
    MAIN_SHADOW_MAP,
    POINT_SHADOW_CUBE_ARRAY,
    REFLECTION_CUBE_MAP,
    DDGI_IRRADIANCE_MAP,
    DDGI_DEPTH_MAP,
    RenderStage,
} from '@orillusion/core'

// C7 acceptance: ColorFeature registers at stage=Opaque; its reads
// set adapts to GI-enable state; both color + compressed GBuffer
// handles resolve; graph's toposort places it after shadows/reflection/GI.

await test('ColorFeature registers at stage=Opaque with static reads and exposes color/normal buffers', async () => {
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
    await delay(120) // start() fires on first RAF tick

    const feature = view.renderGraph!.getFeature('ColorFeature') as ColorFeature | null
    if (!feature) throw new Error('ColorFeature not registered')
    expect(feature.stage).toEqual(RenderStage.Opaque)
    // Base reads when GI is disabled: cluster + shadow + point shadow + reflection.
    expect(feature.reads.length).toEqual(4)
    expect(feature.reads.indexOf(CLUSTER_LIGHTING_BUFFER) >= 0).toEqual(true)
    expect(feature.reads.indexOf(MAIN_SHADOW_MAP) >= 0).toEqual(true)
    expect(feature.reads.indexOf(POINT_SHADOW_CUBE_ARRAY) >= 0).toEqual(true)
    expect(feature.reads.indexOf(REFLECTION_CUBE_MAP) >= 0).toEqual(true)

    const pool = view.renderGraph!.pool
    expect(pool.has(COLOR_BUFFER)).toEqual(true)
    expect(pool.has(NORMAL_BUFFER)).toEqual(true)
    const colorTex = pool.get(COLOR_BUFFER)
    if (!colorTex) throw new Error('_ColorBuffer resolved to null')

    engine.dispose()
})

await test('ColorFeature reads include DDGI handles when gi.enable is true', async () => {
    const engine = await Engine3D.init({
        setting: {
            render: { useFrameGraph: true },
            gi: { enable: true },
        } as any,
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
    await delay(150)

    const feature = view.renderGraph!.getFeature('ColorFeature') as ColorFeature | null
    if (!feature) throw new Error('ColorFeature not registered')
    expect(feature.reads.length).toEqual(6)
    expect(feature.reads.indexOf(DDGI_IRRADIANCE_MAP) >= 0).toEqual(true)
    expect(feature.reads.indexOf(DDGI_DEPTH_MAP) >= 0).toEqual(true)

    engine.dispose()
})

setTimeout(end, 3500)
