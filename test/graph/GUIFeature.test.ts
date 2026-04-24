import { test, end, expect, delay } from '../util'
import {
    Engine3D,
    Scene3D,
    View3D,
    Camera3D,
    Object3D,
    GUIFeature,
    CANVAS_TEXTURE,
    FINAL_COLOR,
    RenderStage,
} from '@orillusion/core'

// C9 acceptance: GUIFeature registered at stage=Present, reads
// _FinalColor, writes _CanvasTexture (pass-through external). Last
// feature in the topologically-sorted graph.

await test('GUIFeature registers at stage=Present and reads _FinalColor', async () => {
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

    const feature = view.renderGraph!.getFeature('GUIFeature') as GUIFeature | null
    if (!feature) throw new Error('GUIFeature not registered')
    expect(feature.stage).toEqual(RenderStage.Present)
    expect(feature.reads[0]).toEqual(FINAL_COLOR)
    expect(feature.writes[0]).toEqual(CANVAS_TEXTURE)

    // _CanvasTexture is a pass-through external — pool.has() is
    // true, pool.get() returns null (the actual swapchain view is
    // acquired inside presentContent). Just assert has().
    const pool = view.renderGraph!.pool
    expect(pool.has(CANVAS_TEXTURE)).toEqual(true)

    engine.dispose()
})

await test('GUIFeature sits at the tail of the compiled graph order', async () => {
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
    await delay(150) // let start() run so ColorFeature joins the graph

    // dumpDot contains compiled features in stage-order; GUIFeature
    // (Present=120) should appear after ColorFeature (Opaque=40) and
    // PostFeature (Post=90).
    const dot = view.renderGraph!.dumpDot()
    const idxColor = dot.indexOf('"ColorFeature"')
    const idxPost = dot.indexOf('"PostFeature"')
    const idxGUI = dot.indexOf('"GUIFeature"')
    if (idxColor < 0 || idxPost < 0 || idxGUI < 0) {
        throw new Error(`dot missing required features: ${dot}`)
    }
    expect(idxColor < idxPost).toEqual(true)
    expect(idxPost < idxGUI).toEqual(true)

    engine.dispose()
})

setTimeout(end, 2500)
