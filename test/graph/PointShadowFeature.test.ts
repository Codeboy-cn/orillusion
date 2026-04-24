import { test, end, expect } from '../util'
import {
    Engine3D,
    Scene3D,
    View3D,
    Camera3D,
    Object3D,
    PointShadowFeature,
    POINT_SHADOW_CUBE_ARRAY,
} from '@orillusion/core'

// C4 acceptance: PointShadowFeature registered + external handle
// resolves to the renderer's cube array texture.

await test('PointShadowFeature is registered and exposes _PointShadowCubeArray', async () => {
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

    const feature = view.renderGraph!.getFeature('PointShadowFeature') as PointShadowFeature | null
    if (!feature) throw new Error('PointShadowFeature not registered')
    expect(feature.writes[0]).toEqual(POINT_SHADOW_CUBE_ARRAY)

    const pool = view.renderGraph!.pool
    expect(pool.has(POINT_SHADOW_CUBE_ARRAY)).toEqual(true)
    const cubeArr = pool.get(POINT_SHADOW_CUBE_ARRAY)
    if (!cubeArr) throw new Error('_PointShadowCubeArray resolved to null')

    engine.dispose()
})

setTimeout(end, 1500)
