import { test, expect, end, delay, waitUntil } from '../util'
import { Camera3D, Engine3D, Object3D, RenderGraphPass, Scene3D, Time, View3D } from '@orillusion/core'
import type { RenderGraphPassContext } from '@orillusion/core'

// Regression tests for audit finding R1: a throwing pass used to leave
// Engine3D._rafId stuck non-zero, permanently stalling the render loop
// (and taking every other engine instance down with it).

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

let thrown = 0
let executions = 0

class ThrowingTestPass extends RenderGraphPass {
    public readonly name = 'ThrowingTestPass'
    public execute(_ctx: RenderGraphPassContext): void {
        executions++
        // Throw on a few early executions, then recover — models a
        // transient mid-frame failure.
        if (executions >= 3 && executions <= 6) {
            thrown++
            throw new Error('intentional LoopResilience test error')
        }
    }
}

await test('render loop survives a throwing pass and recovers [audit R1]', async () => {
    const engine = await Engine3D.init()

    let uncaptured = 0
    engine.context3D.device.addEventListener('uncapturederror', () => { uncaptured++ })

    const hookErrors: any[] = []
    const prevHook = Engine3D.onRenderError
    Engine3D.onRenderError = (e, inst) => { hookErrors.push({ e, inst }) }

    const view = makeView(engine)
    engine.startRenderView(view)

    // Hot-plug the throwing pass into the running graph.
    view.renderGraph!.add(ThrowingTestPass)
    await waitUntil(() => executions >= 1, 10000)

    const frameBefore = Time.frame
    await waitUntil(() => executions >= 8, 15000)

    // The pass kept being scheduled after throwing — the loop never died.
    expect(executions >= 8).toEqual(true)
    expect(thrown).toEqual(4)
    expect(Time.frame > frameBefore).toEqual(true)

    // The error hook received the failure with the owning instance.
    expect(hookErrors.length).toEqual(4)
    expect(hookErrors[0].e.message).toEqual('intentional LoopResilience test error')
    expect(hookErrors[0].inst === engine).toEqual(true)

    // The discarded encoder must not surface WebGPU validation errors.
    await delay(200)
    expect(uncaptured).toEqual(0)

    Engine3D.onRenderError = prevHook
    view.renderGraph!.remove('ThrowingTestPass')
    engine.dispose()
})

class AlwaysThrowPass extends RenderGraphPass {
    public readonly name = 'AlwaysThrowPass'
    public execute(_ctx: RenderGraphPassContext): void {
        throw new Error('instance A permanent failure')
    }
}

await test('a throwing instance does not stall its siblings [audit R1]', async () => {
    const prevHook = Engine3D.onRenderError
    Engine3D.onRenderError = () => { /* silence expected errors */ }

    const engineA = await Engine3D.init()
    const engineB = await Engine3D.init()

    const viewA = makeView(engineA)
    engineA.startRenderView(viewA)
    viewA.renderGraph!.add(AlwaysThrowPass)

    const viewB = makeView(engineB)
    engineB.startRenderView(viewB)

    const bStart = engineB.frameCount
    await waitUntil(() => engineB.frameCount >= bStart + 10, 15000)
    // B keeps producing frames while A throws every frame.
    expect(engineB.frameCount >= bStart + 10).toEqual(true)

    Engine3D.onRenderError = prevHook
    engineA.dispose()
    engineB.dispose()
})

setTimeout(end, 2000)
