import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { COLOR_BUFFER, ColorPass } from './ColorPass';
import { SCENE_COLOR_PYRAMID } from './SceneColorPyramidPass';
import { dependOnIfRegistered } from './_helpers';

/**
 * Mutator pass that draws opaque materials with transmission
 * (`transmissionFactor > 0`) AFTER the SceneColorPyramid has captured
 * the rest of the opaque world. Mutates `_ColorBuffer` in place via
 * the ColorPass continuation render.
 *
 * Why split: transmission materials sample the pyramid for refraction
 * (and, in alpha-cutout mode, alpha). If drawn alongside other opaque
 * materials in the main {@link ColorPass}, their own writes would
 * land in the pyramid before they could sample it — at the dragon's
 * screen position the pyramid would store the dragon, not whatever
 * cloth / wall sits behind it.
 *
 * The read on `_SceneColorPyramid` chains topo-order strictly after
 * {@link SceneColorPyramidPass}. `b.write(COLOR_BUFFER)` (mutator)
 * declares the in-place write so the topo sort routes downstream
 * `_ColorBuffer` consumers through this pass.
 *
 * @group Graph
 */
export class TransmissionOpaquePass extends RenderGraphPass {
    public readonly name = 'TransmissionOpaquePass';

    public setup(b: RenderGraphBuilder): void {
        b.read(SCENE_COLOR_PYRAMID);
        b.write(COLOR_BUFFER);  // mutator

        dependOnIfRegistered(b, 'GPUCullPass');
    }

    public execute(ctx: RenderGraphPassContext): void {
        const colorPass = ctx.graph.getPass<ColorPass>('ColorPass');
        if (!colorPass) return;
        colorPass.renderTransmissionContinuation(ctx.view, ctx.occlusion);
    }
}
