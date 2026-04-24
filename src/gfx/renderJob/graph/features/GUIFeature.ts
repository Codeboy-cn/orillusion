import { Texture } from '../../../graphics/webGpu/core/texture/Texture';
import { PostRenderer } from '../../passRenderer/post/PostRenderer';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';
import { FINAL_COLOR } from './PostFeature';

/**
 * Published handle name for the canvas (swapchain) view that the
 * presentation pass draws into. Registered as a pure external
 * handle because the GPUTextureView comes from
 * `Context3D.context.getCurrentTexture()` and is owned by the
 * browser's compositor — the graph pool never allocates it.
 *
 * Exposed as a handle mainly so custom features can order against
 * it (e.g. "my debug overlay runs after present-to-canvas"); the
 * built-in GUIFeature is already the graph's Present-stage terminal.
 *
 * @group Graph
 */
export const CANVAS_TEXTURE = '_CanvasTexture';

/**
 * C9 of the Phase C migration — final feature. Wraps the present-to-
 * canvas step as a {@link RenderFeature}. In the legacy renderer this
 * was a single `PostRenderer.presentContent` call at the tail of
 * `RendererJob.renderFrame`; the old GUI overlay subsystem was
 * removed before Phase C (see the comment in `RendererJob.renderFrame`
 * around the present call).
 *
 * Reads {@link FINAL_COLOR}: resolves through the pool to whatever
 * texture the post chain ended with (or to the color pass GBuffer
 * when no post effects are enabled — see {@link PostFeature}).
 *
 * Writes {@link CANVAS_TEXTURE}: a pass-through external handle
 * whose getter returns `null` because the GPUTextureView is
 * short-lived and obtained per-frame inside
 * `PostRenderer.presentContent`. The handle name exists purely so
 * custom features can declare `reads: [CANVAS_TEXTURE]` to run after
 * present (e.g. a debug overlay that samples the canvas).
 *
 * Stage is {@link RenderStage.Present} — the last slot in the graph.
 *
 * @group Graph
 */
export class GUIFeature extends RenderFeature {
    public readonly name = 'GUIFeature';
    public readonly stage = RenderStage.Present;
    public readonly reads = [FINAL_COLOR];
    public readonly writes = [CANVAS_TEXTURE];

    private readonly _impl: PostRenderer;

    constructor(impl: PostRenderer) {
        super();
        this._impl = impl;
    }

    public get impl(): PostRenderer {
        return this._impl;
    }

    /** Register `_CanvasTexture` as an external resource. Getter
     *  returns null — the actual swapchain texture is acquired by
     *  `PostRenderer.presentContent` and is not exposed as a
     *  reusable handle. Custom features that need post-present
     *  access should re-acquire via their own swapchain call. */
    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<null>(CANVAS_TEXTURE, () => null);
    }

    public execute(ctx: FeatureContext): void {
        const finalColor = ctx.get<Texture>(FINAL_COLOR);
        this._impl.presentContent(ctx.view, finalColor);
    }
}
