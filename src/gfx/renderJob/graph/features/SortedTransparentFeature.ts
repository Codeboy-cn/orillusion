import { ColorPassRenderer } from '../../passRenderer/color/ColorPassRenderer';
import { ClusterLightingRender } from '../../passRenderer/cluster/ClusterLightingRender';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';
import { COLOR_BUFFER } from './ColorFeature';
import { SCENE_COLOR_PYRAMID } from './SceneColorPyramidFeature';

/** Filter mode threaded through to {@link ColorPassRenderer.oitFilter}.
 *  - `'all'`: render every transparent node (default — used when
 *    TransparentOITFeature isn't in the graph).
 *  - `'sorted'`: skip nodes whose material has `oitMode='weighted'`,
 *    leaving them for TransparentOITFeature. */
export type SortedTransparentFilter = 'all' | 'sorted';

/**
 * Frame Graph feature that renders sorted transparent geometry AFTER
 * opaque rendering and the SceneColorPyramid copy have both completed.
 * It continues the same {@link ColorPassRenderer} via `maskOp=true`
 * which reopens the main color attachment with `loadOp='load'` so
 * opaque contents are preserved.
 *
 * Depends on:
 * - `_ColorBuffer` — written by ColorFeature (opaque half)
 * - `_SceneColorPyramid` — written by SceneColorPyramidFeature
 *   (declared even when no transmissive material is on-screen; the
 *   pool handles missing reads by returning the shared color-buffer
 *   snapshot. Declared as `reads` so the graph topo-sort places us
 *   strictly after the pyramid feature.)
 *
 * When the engine is configured with `render.useOIT = true` and
 * materials carry `oitMode === 'weighted'`, the OIT features at the
 * same stage own the transparent pipeline; this feature then renders
 * the subset of materials still on the sorted path (the default).
 *
 * @group Graph
 */
export class SortedTransparentFeature extends RenderFeature {
    public readonly name = 'SortedTransparentFeature';
    public readonly stage = RenderStage.Transparent;
    public readonly reads = [COLOR_BUFFER, SCENE_COLOR_PYRAMID];
    public readonly writes: readonly string[] = [];

    private readonly _impl: ColorPassRenderer;
    private readonly _occlusion: OcclusionSystem;
    private readonly _clusterLighting: ClusterLightingRender;
    private readonly _filter: SortedTransparentFilter;

    constructor(
        impl: ColorPassRenderer,
        occlusion: OcclusionSystem,
        clusterLighting: ClusterLightingRender,
        filter: SortedTransparentFilter = 'all',
    ) {
        super();
        this._impl = impl;
        this._occlusion = occlusion;
        this._clusterLighting = clusterLighting;
        this._filter = filter;
    }

    public execute(ctx: FeatureContext): void {
        // Set the OIT filter for this transparent half. When useOIT is
        // off the filter is 'all' and the renderer also uses cached
        // bundles. When useOIT is on the filter is 'sorted' and the
        // renderer skips weighted nodes (OIT renders them) — bundles
        // are also disabled in that mode by ColorPassRenderer.render.
        this._impl.oitFilter = this._filter === 'all' ? null : 'sorted';
        try {
            this._impl.render(
                ctx.view,
                this._occlusion,
                this._clusterLighting.clusterLightingBuffer,
                false, // maskTr
                true,  // maskOp
            );
        } finally {
            this._impl.oitFilter = null;
        }
    }
}
