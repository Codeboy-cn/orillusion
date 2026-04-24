import { test, end, expect, delay } from '../util'
import { Engine3D, FrameGraphRendererJob, Scene3D, View3D, Camera3D, Object3D, RenderGraph } from '@orillusion/core'

// useFrameGraph acceptance test: Engine3D.init({render.useFrameGraph:true})
// produces a FrameGraphRendererJob, `view.renderGraph` is a live
// RenderGraph, and the engine renders cleanly through the graph +
// legacy fallback for un-migrated stages.

await test('useFrameGraph=true produces a FrameGraphRendererJob with a live RenderGraph', async () => {
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
    const job = engine.startRenderView(view)

    expect(job instanceof FrameGraphRendererJob).toEqual(true)
    expect(view.renderGraph instanceof RenderGraph).toEqual(true)
    // Phase C ships features incrementally. After C1 the graph has
    // at least ClusterLightingFeature; later C* PRs append more.
    // Assert a lower bound rather than a fixed count.
    expect(view.renderGraph!.features.length >= 1).toEqual(true)

    // Allow a few frames to elapse — the graph + legacy fallback
    // must render without throwing or emitting validation warnings.
    await delay(250)

    engine.dispose()
})

await test('Phase D: default (no override) yields a FrameGraphRendererJob', async () => {
    // Phase D flipped useFrameGraph default to true. Engine3D.init()
    // with no override now produces a Frame Graph-backed job. The
    // legacy ForwardRenderJob path is still reachable via explicit
    // `useFrameGraph: false` for one minor version of back-compat.
    const engine = await Engine3D.init()

    const scene = new Scene3D()
    const cameraObj = new Object3D()
    const camera = cameraObj.addComponent(Camera3D)
    camera.perspective(60, engine.aspect, 1, 5000)
    scene.addChild(cameraObj)

    const view = new View3D()
    view.scene = scene
    view.camera = camera
    const job = engine.startRenderView(view)

    expect(job instanceof FrameGraphRendererJob).toEqual(true)
    expect(view.renderGraph instanceof RenderGraph).toEqual(true)

    engine.dispose()
})

setTimeout(end, 2000)
