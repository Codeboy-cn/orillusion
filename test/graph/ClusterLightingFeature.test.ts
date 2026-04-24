import { test, end, expect, delay } from '../util'
import {
    Engine3D,
    FrameGraphRendererJob,
    Scene3D,
    View3D,
    Camera3D,
    Object3D,
    ClusterLightingFeature,
    CLUSTER_LIGHTING_BUFFER,
} from '@orillusion/core'

// C1 acceptance: ClusterLightingFeature must be registered by
// FrameGraphRendererJob and must publish `_ClusterLightingBuffer` as an
// external handle after the first frame. The legacy fallback must not
// double-dispatch the compute (cluster lives in the graph only).

await test('ClusterLightingFeature is registered by FrameGraphRendererJob', async () => {
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

    const job = engine.startRenderView(view) as FrameGraphRendererJob
    expect(job instanceof FrameGraphRendererJob).toEqual(true)

    const feature = job.graph.getFeature('ClusterLightingFeature') as ClusterLightingFeature | null
    if (!feature) throw new Error('ClusterLightingFeature not registered')
    expect(feature.writes.length).toEqual(1)
    expect(feature.writes[0]).toEqual(CLUSTER_LIGHTING_BUFFER)

    engine.dispose()
})

await test('_ClusterLightingBuffer external handle is registered eagerly at construction', async () => {
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

    // Registration happens in FrameGraphRendererJob's constructor, not
    // via a frame tick — the handle must be resolvable immediately.
    const pool = view.renderGraph!.pool
    expect(pool.has(CLUSTER_LIGHTING_BUFFER)).toEqual(true)
    const buffer = pool.get(CLUSTER_LIGHTING_BUFFER)
    // ClusterLightingBuffer is the legacy-owned GPU resource. We just
    // assert the getter returns a non-null object — deeper validation
    // (its internal GPUBuffer is uploaded) is exercised by existing
    // rendering tests that read the buffer through the color pass.
    if (!buffer) throw new Error('pool returned null for ' + CLUSTER_LIGHTING_BUFFER)

    // Give the render loop one tick so we also cover that the graph's
    // execute() calls the cluster compute without throwing.
    await delay(150)

    engine.dispose()
})

setTimeout(end, 2500)
