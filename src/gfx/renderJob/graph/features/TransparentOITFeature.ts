import { Context3D } from '../../../graphics/webGpu/Context3D';
import { OITPassRenderer, OIT_ACCUM_TEX, OIT_REVEAL_TEX } from '../../passRenderer/oit/OITPassRenderer';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { ClusterLightingRender } from '../../passRenderer/cluster/ClusterLightingRender';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';
import { COLOR_BUFFER } from './ColorFeature';
import { SCENE_COLOR_PYRAMID } from './SceneColorPyramidFeature';

/**
 * Weighted-Blended OIT accumulation feature (McGuire & Bavoil 2013).
 * Renders all transparent materials marked `oitMode === 'weighted'`
 * through {@link OITPassRenderer} into two side-band attachments:
 *
 * - `_OITAccum` (RGBA16F, additive) — `Σ color·α·w` in RGB, `Σ α·w` in A
 * - `_OITReveal` (R8) — `Π (1 - α)` per pixel
 *
 * Depth comes from the main color pass's GBuffer (read-only) so
 * transparent fragments occluded by opaque geometry are correctly
 * culled. Companion {@link TransparentResolveFeature} composites the
 * two attachments back into `_ColorBuffer` at AfterTransparent.
 *
 * @group Graph
 */
export class TransparentOITFeature extends RenderFeature {
    public readonly name = 'TransparentOITFeature';
    public readonly stage = RenderStage.Transparent;
    public readonly reads = [COLOR_BUFFER, SCENE_COLOR_PYRAMID];
    public readonly writes = [OIT_ACCUM_TEX, OIT_REVEAL_TEX];

    private readonly _ctx: Context3D;
    private readonly _occlusion: OcclusionSystem;
    private readonly _clusterLighting: ClusterLightingRender;
    private _renderer: OITPassRenderer | null = null;

    constructor(ctx: Context3D, occlusion: OcclusionSystem, clusterLighting: ClusterLightingRender) {
        super();
        this._ctx = ctx;
        this._occlusion = occlusion;
        this._clusterLighting = clusterLighting;
    }

    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        // The OIT renderer creates the textures on construction; expose
        // them via the graph pool so the resolve feature (and any
        // future debugging features) can resolve by handle.
        pool.registerExternal<RenderTexture>(
            OIT_ACCUM_TEX,
            () => RTResourceMap.getTexture(this._ctx, OIT_ACCUM_TEX),
        );
        pool.registerExternal<RenderTexture>(
            OIT_REVEAL_TEX,
            () => RTResourceMap.getTexture(this._ctx, OIT_REVEAL_TEX),
        );
    }

    public execute(ctx: FeatureContext): void {
        if (!this._renderer) {
            this._renderer = new OITPassRenderer(this._ctx);
        }
        this._renderer.render(ctx.view, this._occlusion, this._clusterLighting.clusterLightingBuffer);
    }
}
