import { Context3D } from '../../../graphics/webGpu/Context3D';
import { Texture } from '../../../graphics/webGpu/core/texture/Texture';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { PostRenderer } from '../../passRenderer/post/PostRenderer';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';
import { COLOR_BUFFER } from './ColorFeature';

/**
 * Published handle name for the final post-chain output. Resolves to
 * whatever texture the last enabled `*Post.render()` wrote to —
 * tone-mapped color when the full chain runs, FXAA-sharpened color
 * when only FXAA is enabled, or the legacy colorPass GBuffer texture
 * when no post effects are enabled at all.
 *
 * {@link FrameGraphRendererJob._present} reads this handle to decide
 * what texture to draw into the presentation canvas.
 *
 * @group Graph
 */
export const FINAL_COLOR = '_FinalColor';

/**
 * C8 of the Phase C migration. Wraps {@link PostRenderer} (the whole
 * post-effect chain) as a single {@link RenderFeature}.
 *
 * **Why group-level rather than per-`*Post.ts`:** each post reads
 * `gpu.lastRenderPassState` from the previous post via
 * `getLastRenderTexture()` and writes its own `rendererPassState`
 * back. The chain is implicit in that shared mutable state —
 * teaching each post to read a named graph handle instead of the
 * legacy chain is a Phase E cleanup, not a Phase C migration
 * requirement. The plan's "shadow cascade loop stays internal"
 * rule applies here by analogy: a monolithic feature per conceptual
 * pass, not per sub-step.
 *
 * Reads: {@link COLOR_BUFFER} — the first enabled post reads it.
 * Writes: {@link FINAL_COLOR} — exposed as an external handle that
 * re-reads `gpu.lastRenderPassState` every frame to resolve the
 * current end-of-chain texture.
 *
 * Stage is {@link RenderStage.Post}. All C1..C7 features run first
 * because their stages (BeforeShadows, PreDepth, Shadow, GI, Opaque)
 * all precede Post in the stage order.
 *
 * @group Graph
 */
export class PostFeature extends RenderFeature {
    public readonly name = 'PostFeature';
    public readonly stage = RenderStage.Post;
    public readonly reads = [COLOR_BUFFER];
    public readonly writes = [FINAL_COLOR];

    private readonly _impl: PostRenderer;
    private readonly _ctx: Context3D;

    constructor(impl: PostRenderer, ctx: Context3D) {
        super();
        this._impl = impl;
        this._ctx = ctx;
    }

    public get impl(): PostRenderer {
        return this._impl;
    }

    /** Install a getter for `_FinalColor`. Resolves to the texture
     *  the last enabled post wrote to, or to the color pass GBuffer
     *  when no post effects are enabled. Mirrors the presentation
     *  fallback logic in {@link FrameGraphRendererJob._present}. */
    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<Texture>(FINAL_COLOR, () => {
            const gpu = this._ctx.gpuContext;
            if (gpu.lastRenderPassState) {
                return gpu.lastRenderPassState.getLastRenderTexture(this._ctx);
            }
            // Fallback for the empty-post-chain case.
            return GBufferFrame
                .getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx)
                .getColorTexture();
        });
    }

    public execute(ctx: FeatureContext): void {
        this._impl.render(ctx.view);
    }
}
