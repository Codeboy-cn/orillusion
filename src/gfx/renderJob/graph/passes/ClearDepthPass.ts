import { WebGPUDescriptorCreator } from '../../../graphics/webGpu/descriptor/WebGPUDescriptorCreator';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { RTFrame } from '../../frame/RTFrame';
import { RendererPassState } from '../../passRenderer/state/RendererPassState';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';

/**
 * Configuration for {@link ClearDepthPass}.
 *
 * - `name`: optional override so multiple ClearDepth nodes can coexist
 *   in one graph (each registered RenderGraphPass needs a unique name).
 *   Defaults to `'ClearDepthPass'`.
 * - `after`: optional upstream pass name to bind a `dependsOn` edge to.
 *   When omitted, callers are expected to set the ordering by other
 *   means (e.g. mutating `pass.dependencies` directly, or relying on
 *   insertion order if there's nothing else to disambiguate).
 * - `gBufferKey`: which `GBufferFrame` cache entry's color + depth
 *   attachments to clear depth on. Defaults to `colorPass_GBuffer`
 *   (the one `ColorPass` writes to).
 */
export interface ClearDepthPassConfig {
    name?: string;
    after?: string;
    gBufferKey?: string;
}

/**
 * Stand-alone "clear depth, preserve color" pass.
 *
 * Use case: an opaque pipeline that wants to clear depth *between*
 * two opaque draw groups — e.g. GIS rendering that draws the planet
 * surface + ground decals first, then clears depth so screen-space
 * 3D content (buildings, vehicles, markers) is composited on top
 * without being z-fought or occluded by the curved planet surface.
 *
 * Open a render pass with the GBuffer's color attachments loadOp set
 * to `'load'` (preserving prior color writes) and depth loadOp set to
 * `'clear'`. No draw calls — the clear happens automatically when
 * WebGPU enters the pass.
 *
 * Cost: one extra render pass per frame. No fragment work, so the
 * GPU cost is just the begin/end overhead + the depth clear itself
 * (a fast-path on every modern GPU). The CPU cost is one extra
 * command-encoder begin/end.
 *
 * Ordering: this pass on its own only declares a `dependsOn` edge to
 * the configured upstream pass. Downstream consumers that should
 * observe the cleared depth (e.g. a second `ColorPass` subclass) need
 * to declare their own `dependsOn('ClearDepthPass')`.
 *
 * @group Graph
 */
export class ClearDepthPass extends RenderGraphPass {
    public readonly name: string;

    protected _clearState!: RendererPassState;
    protected readonly _config: ClearDepthPassConfig;

    constructor(config: ClearDepthPassConfig = {}) {
        super();
        this._config = config;
        this.name = config.name ?? 'ClearDepthPass';
    }

    public setup(b: RenderGraphBuilder): void {
        const ctx = b.context3D;
        const key = this._config.gBufferKey ?? GBufferFrame.colorPass_GBuffer;

        // Clone the GBuffer rtFrame so the descriptor state for this pass
        // is isolated from the source (which is still owned by ColorPass
        // and re-configured every frame by its RenderContext). GPU
        // resources — color targets, depth texture — are shared by
        // reference, which is the point: the depth clear has to apply
        // to the same texture downstream passes will read.
        const src = GBufferFrame.getGBufferFrame(key, ctx);
        const rt: RTFrame = src.clone();
        rt.depthLoadOp = 'clear';
        for (const desc of rt.rtDescriptors) desc.loadOp = 'load';
        this._clearState = WebGPUDescriptorCreator.createRendererPassState(ctx, rt);

        if (this._config.after) {
            b.dependsOn(this._config.after);
        }
    }

    public execute(ctx: RenderGraphPassContext): void {
        const gpu = ctx.view.engine3D.context3D.gpuContext;
        const cmd = gpu.beginCommandEncoder();
        const enc = gpu.beginRenderPass(cmd, this._clearState);
        gpu.endPass(enc);
        gpu.endCommandEncoder(cmd);
    }
}
