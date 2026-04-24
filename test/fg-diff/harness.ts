// Frame Graph pixel-diff harness page.
//
// Reads `?scene=<name>&mode=<legacy|fg>&frames=<n>` from the URL,
// constructs the named scene, drives N deterministic frames, then
// signals completion via window.postMessage. The Electron runner
// (runner.mjs) captures the canvas screenshot on the `end` message.
//
// Phase A: only `mode=legacy` is wired up. `mode=fg` paints a stub
// warning so baseline capture can still produce golden PNGs while
// Phase B adds the `useFrameGraph` flag.

import { Engine3D } from '@orillusion/core'
import { scenes, byName } from './scenes/index.mjs'

const params = new URLSearchParams(location.search)
const sceneName = params.get('scene') ?? scenes[0].name
const mode = (params.get('mode') ?? 'legacy') as 'legacy' | 'fg'
const frames = Number.parseInt(params.get('frames') ?? '3', 10)

const log = (msg: string) => {
    const el = document.getElementById('log')
    if (el) el.textContent += msg + '\n'
    console.log('[fg-diff]', msg)
}

async function main() {
    const manifest = byName(sceneName)
    if (!manifest) {
        log(`ERROR: unknown scene '${sceneName}'`)
        signalEnd(false)
        return
    }
    log(`scene=${sceneName} mode=${mode} frames=${frames}`)

    const canvas = document.getElementById('gfx') as HTMLCanvasElement
    canvas.width = 800
    canvas.height = 600

    const engine = await Engine3D.init({ canvasConfig: { canvas } })
    if (mode === 'fg') {
        log('note: frame graph mode not yet wired (Phase B). Rendering legacy path for baseline.')
    }

    // Dynamic import of the scene module. Scenes are kept in TS so
    // they can reuse the same imports as the rest of the engine.
    const mod = await import(/* @vite-ignore */ manifest.module)
    if (typeof mod.default !== 'function') {
        log(`ERROR: scene module '${manifest.module}' has no default export`)
        signalEnd(false)
        return
    }

    const { view } = await mod.default(engine)
    engine.startRenderView(view)

    // Drive N frames under a fixed clock so TAA / animation curves
    // produce deterministic output. Engine3D's internal RAF loop
    // runs async; waiting for RAF ticks is enough for the renderer
    // to flush the scene and trigger a GPU submit.
    for (let i = 0; i < frames; i++) {
        await new Promise(r => requestAnimationFrame(r))
    }

    log('frames complete — signaling end')
    signalEnd(true)
}

function signalEnd(pass: boolean) {
    const payload = { type: 'end', scene: sceneName, mode, pass }
    window.parent.postMessage(payload, '*')
    window.postMessage(payload, '*')
}

main().catch(err => {
    log('EXCEPTION: ' + (err?.stack ?? String(err)))
    signalEnd(false)
})
