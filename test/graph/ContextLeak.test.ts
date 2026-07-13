import { test, expect, end, delay, waitUntil } from '../util'
import { Camera3D, Engine3D, GBufferResourcePass, GPUTextureFormat, Object3D, RenderTexture, RTDescriptor, RTFrame, Scene3D, View3D, WebGPUDescriptorCreator } from '@orillusion/core'

// Regression tests for audit findings W1/R2 (per-frame RendererPassState
// leak in the shared RenderContext, missing clone2Frame fields, MSAA
// side-band texture leak + broken MSAA load chain).

function makeView(engine: Engine3D): View3D {
    const scene = new Scene3D()
    const cameraObj = new Object3D()
    const camera = cameraObj.addComponent(Camera3D)
    camera.perspective(60, engine.aspect, 1, 5000)
    scene.addChild(cameraObj)
    const view = new View3D()
    view.scene = scene
    view.camera = camera
    return view
}

await test('clone2Frame copies the previously dropped fields [audit W1a]', async () => {
    const src = new RTFrame([], [])
    src.label = 'source'
    src.sampleCount = 4
    src.isOutTarget = false
    src.depthCleanValue = 0.5
    src.depthViewIndex = 3
    src.depthLoadOp = 'load'

    const dst = src.clone()
    expect(dst.label).toEqual('source')
    expect(dst.sampleCount).toEqual(4)
    expect(dst.isOutTarget).toEqual(false)
    expect(dst.depthCleanValue).toEqual(0.5)
    expect(dst.depthViewIndex).toEqual(3)
    // depthLoadOp is intentionally NOT cloned — callers set it explicitly.
    expect(dst.depthLoadOp).toEqual('clear')
})

await test('shared RenderContext stays bounded and reuses split states [audit W1b]', async () => {
    const engine = await Engine3D.init()
    const view = makeView(engine)
    engine.startRenderView(view)

    const pass = view.renderGraph!.getPass<GBufferResourcePass>('GBufferResourcePass')
    expect(!!pass).toEqual(true)
    const rc: any = pass!.renderContext

    // Ride 90 rendered frames: without the per-frame clean() the shared
    // context accumulated pass states forever (Sky pushes one per frame).
    const start = engine.frameCount
    await waitUntil(() => engine.frameCount >= start + 90, 30000)
    expect(rc.rendererPassStates.length <= 3).toEqual(true)

    // Split-state identity: same (colorOp|depthOp) must return the same
    // cached RendererPassState object across frames instead of cloning a
    // fresh RTFrame key per call.
    rc.clean()
    rc.beginContinueRendererPassState('clear', 'clear')
    const s1 = rc.beginContinueRendererPassState('load', 'load')
    const s2 = rc.beginContinueRendererPassState('load', 'load')
    expect(s1 === s2).toEqual(true)

    rc.clean()
    rc.beginContinueRendererPassState('clear', 'clear')
    const s3 = rc.beginContinueRendererPassState('load', 'load')
    expect(s3 === s1).toEqual(true)

    engine.dispose()
})

// NOTE: the default forward pipeline in this repo cannot legally enable
// MSAA end-to-end — the compressed G-buffer attachment is rgba32float,
// which WebGPU does not allow to be multisampled, and all color
// attachments of one pass must share a sample count (GBufferResourcePass
// already warns about exactly this). The MSAA side-band mechanics are
// therefore exercised directly against WebGPUDescriptorCreator with a
// synthetic multisample-capable frame.
await test('MSAA split state keeps sample count and shares side-band textures [audit W1c]', async () => {
    const engine = await Engine3D.init()
    const ctx = engine.context3D

    let uncaptured = 0
    ctx.device.addEventListener('uncapturederror', () => { uncaptured++ })

    const rt = new RenderTexture(128, 128, GPUTextureFormat.rgba16float, false, undefined, 1, 0, true, false, ctx)
    const base = new RTFrame([rt], [new RTDescriptor()])
    base.label = 'msaaBase'
    base.sampleCount = 4

    // W1a: the clone carries sampleCount, so the continuation state
    // compiles multisampled instead of failing validation.
    const split = base.clone()
    split.depthLoadOp = 'load'
    for (const d of split.rtDescriptors) d.loadOp = 'load'

    const rpsBase = WebGPUDescriptorCreator.createRendererPassState(ctx, base)
    const rpsSplit = WebGPUDescriptorCreator.createRendererPassState(ctx, split)
    expect(rpsBase.multisample).toEqual(4)
    expect(rpsSplit.multisample).toEqual(4)

    // W1c: both states resolve the SAME side-band texture per attachment —
    // this is what makes the continuation pass's 'load' see the previous
    // pass's MSAA contents (each state used to create its own blank one).
    expect(!!rpsBase.multiTextures?.[0]).toEqual(true)
    expect(rpsBase.multiTextures[0] === rpsSplit.multiTextures[0]).toEqual(true)

    // Identity is stable across repeated state rebuilds (previously every
    // call unconditionally created a fresh GPUTexture — a leak).
    const texBefore = rpsBase.multiTextures[0]
    for (let i = 0; i < 60; i++) {
        WebGPUDescriptorCreator.createRendererPassState(ctx, base)
        WebGPUDescriptorCreator.createRendererPassState(ctx, split)
    }
    expect(rpsBase.multiTextures[0] === texBefore).toEqual(true)
    expect(rpsSplit.multiTextures[0] === texBefore).toEqual(true)

    await delay(200)
    expect(uncaptured).toEqual(0)

    engine.dispose()
})

setTimeout(end, 2000)
