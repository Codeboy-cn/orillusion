import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { COLOR_BUFFER } from './ColorPass';
import { ClusterLightingPass } from './ClusterLightingPass';
import { SCENE_COLOR_PYRAMID } from './SceneColorPyramidPass';
import { dependOnIfRegistered } from './_helpers';
import {
    drawSortedTransparent,
    TRANSPARENT_DRAW_CTX,
    TransparentDrawContext,
} from './_transparentDraw';

/** Filter mode applied to the transparent draw list.
 *  - `'all'`: render every transparent node (default — used when
 *    TransparentOITPass isn't in the graph).
 *  - `'sorted'`: skip nodes whose material has `oitMode='weighted'`,
 *    leaving them for TransparentOITPass. */
export type SortedTransparentFilter = 'all' | 'sorted';

/**
 * Mutator pass that renders sorted transparent geometry AFTER opaque
 * rendering + SceneColorPyramid + Transmission. Reopens the main color
 * attachment with `loadOp='load'` so opaque + transmission contents
 * are preserved, then draws the transparent list and any Graphic3D
 * overlays.
 *
 * When the engine is configured with `render.useOIT = true` and
 * materials carry `oitMode === 'weighted'`, the OIT pass at the same
 * stage owns the weighted half of the pipeline; this pass renders the
 * subset of materials still on the sorted path.
 *
 * Resource flow:
 * - read `_SceneColorPyramid` — chains after pyramid copy.
 * - read `_TransparentDrawContext` — chains after ColorPass (creator).
 * - mutator write on `_ColorBuffer` — declares the in-place write.
 *
 * @group Graph
 */
export class SortedTransparentPass extends RenderGraphPass {
    public readonly name = 'SortedTransparentPass';

    constructor(public readonly filter: SortedTransparentFilter = 'all') {
        super();
    }

    public setup(b: RenderGraphBuilder): void {
        b.read(SCENE_COLOR_PYRAMID);
        b.read(TRANSPARENT_DRAW_CTX);
        b.write(COLOR_BUFFER);  // mutator

        dependOnIfRegistered(b, 'GPUCullPass');
    }

    public execute(ctx: RenderGraphPassContext): void {
        const state = ctx.get<TransparentDrawContext>(TRANSPARENT_DRAW_CTX);
        const cluster = ctx.graph.getPass<ClusterLightingPass>('ClusterLightingPass')?.clusterLightingBuffer;
        drawSortedTransparent(ctx.view, cluster, state, this.filter);
    }
}
