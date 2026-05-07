import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { RenderStage } from '../RenderStage';
import { COLOR_BUFFER, ColorPass } from './ColorPass';
import { SCENE_COLOR_PYRAMID } from './SceneColorPyramidPass';

/** Filter mode threaded through to {@link ColorPass.oitFilter}.
 *  - `'all'`: render every transparent node (default — used when
 *    TransparentOITPass isn't in the graph).
 *  - `'sorted'`: skip nodes whose material has `oitMode='weighted'`,
 *    leaving them for TransparentOITPass. */
export type SortedTransparentFilter = 'all' | 'sorted';

/**
 * Mutator pass that renders sorted transparent geometry AFTER opaque
 * rendering + SceneColorPyramid + Transmission. Drives
 * {@link ColorPass.renderTransparent} which reopens the main color
 * attachment with `loadOp='load'` so opaque + transmission contents
 * are preserved.
 *
 * When the engine is configured with `render.useOIT = true` and
 * materials carry `oitMode === 'weighted'`, the OIT pass at the same
 * stage owns the weighted half of the pipeline; this pass renders the
 * subset of materials still on the sorted path.
 *
 * @group Graph
 */
export class SortedTransparentPass extends RenderGraphPass {
    public readonly name = 'SortedTransparentPass';
    public readonly stage = RenderStage.Transparent;

    constructor(public readonly filter: SortedTransparentFilter = 'all') {
        super();
    }

    public setup(b: RenderGraphBuilder): void {
        b.read(SCENE_COLOR_PYRAMID);
        b.write(COLOR_BUFFER);  // mutator
    }

    public execute(ctx: RenderGraphPassContext): void {
        const colorPass = ctx.graph.getPass<ColorPass>('ColorPass');
        if (!colorPass) return;
        colorPass.renderTransparent(ctx.view, ctx.occlusion, this.filter);
    }
}
