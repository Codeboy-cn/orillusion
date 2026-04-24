import { test, end, expect } from '../util'
import {
    Engine3D,
    FrameGraphRendererJob,
    Scene3D,
    View3D,
    Camera3D,
    Object3D,
    PreDepthFeature,
    MAIN_DEPTH_TEXTURE,
    Z_BUFFER_TEXTURE,
} from '@orillusion/core'

// C2 acceptance: PreDepthFeature is only added to the graph when
// `setting.render.zPrePass === true`. When added, its external
// handles (_MainDepthTexture + _ZBufferTexture) are resolvable
// immediately after startRenderView.

await test('PreDepthFeature is NOT registered when zPrePass is false', async () => {
    const engine = await Engine3D.init({
        setting: { render: { useFrameGraph: true, zPrePass: false } as any },
    })
    const scene = new Scene3D()
    const cameraObj = new Object3D()
    const camera = cameraObj.addComponent(Camera3D)
    camera.perspective(60, engine.aspect, 1, 5000)
    scene.addChild(cameraObj)
    const view = new View3D()
    view.scene = scene
    view.camera = camera
    engine.startRenderView(view) as FrameGraphRendererJob

    expect(view.renderGraph!.getFeature('PreDepthFeature')).toEqual(null)
    expect(view.renderGraph!.pool.has(MAIN_DEPTH_TEXTURE)).toEqual(false)

    engine.dispose()
})

await test('PreDepthFeature is registered and exposes _MainDepthTexture + _ZBufferTexture when zPrePass is true', async () => {
    const engine = await Engine3D.init({
        setting: { render: { useFrameGraph: true, zPrePass: true } as any },
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

    const feature = view.renderGraph!.getFeature('PreDepthFeature') as PreDepthFeature | null
    if (!feature) throw new Error('PreDepthFeature not registered')
    expect(feature.writes.length).toEqual(2)

    const pool = view.renderGraph!.pool
    expect(pool.has(MAIN_DEPTH_TEXTURE)).toEqual(true)
    expect(pool.has(Z_BUFFER_TEXTURE)).toEqual(true)

    const depthTex = pool.get(MAIN_DEPTH_TEXTURE)
    const zBuf = pool.get(Z_BUFFER_TEXTURE)
    if (!depthTex) throw new Error('_MainDepthTexture resolved to null')
    if (!zBuf) throw new Error('_ZBufferTexture resolved to null')

    engine.dispose()
})

setTimeout(end, 2500)
