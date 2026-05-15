import { Texture } from '../../../graphics/webGpu/core/texture/Texture';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { FINAL_COLOR, PostPass } from './PostPass';

/**
 * Published handle name for the canvas (swapchain) view that the
 * presentation pass draws into. Registered as a pure handle whose
 * getter returns null because the GPUTextureView comes from
 * `Context3D.context.getCurrentTexture()` and is owned by the
 * browser's compositor — the graph never allocates it.
 *
 * Exposed mainly so custom passes can declare `b.read(CANVAS_TEXTURE)`
 * to order against present-to-canvas (e.g. a debug overlay that runs
 * after the swapchain copy).
 *
 * @group Graph
 */
export const CANVAS_TEXTURE = '_CanvasTexture';

/**
 * Final present-to-canvas pass. Reads `_FinalColor` (whatever the
 * post chain ended with, or the color buffer if no post effects are
 * enabled — see {@link PostPass}) and blits it to the swapchain via
 * the PostPass-owned fullscreen quad.
 *
 * @group Graph
 */
export class GUIPass extends RenderGraphPass {
    public readonly name = 'GUIPass';

    public setup(b: RenderGraphBuilder): void {
        b.read(FINAL_COLOR);
        // CANVAS_TEXTURE is a pass-through handle; the actual swapchain
        // GPUTextureView is acquired per-frame inside presentContent.
        b.write(CANVAS_TEXTURE, () => null);
    }

    public execute(ctx: RenderGraphPassContext): void {
        const postPass = ctx.graph.getPass<PostPass>('PostPass');
        if (!postPass) return;
        const finalColor = ctx.get<Texture>(FINAL_COLOR);
        postPass.presentContent(ctx.view, finalColor);
    }
}
