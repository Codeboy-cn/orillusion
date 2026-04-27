import { Context3D } from '../../../graphics/webGpu/Context3D';
import {
    DualDepthPeelingRenderer,
    DDP_FRONT_TEX,
    DDP_FRONT_DEPTH_TEX,
} from '../../passRenderer/oit/DualDepthPeelingRenderer';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { ClusterLightingRender } from '../../passRenderer/cluster/ClusterLightingRender';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';
import { COLOR_BUFFER } from './ColorFeature';
import { SCENE_COLOR_PYRAMID } from './SceneColorPyramidFeature';

/**
 * Dual Depth Peeling OIT feature (Babylon-style). Coexists with
 * {@link TransparentOITFeature} (WBOIT) at the same RenderStage —
 * each feature filters to materials matching its own oitMode,
 * so a scene can mix `'sorted'`, `'weighted'`, and `'depth-peel'`
 * materials and each runs through the right pipeline.
 *
 * Resource layout:
 *   - `_DDPDepth0` / `_DDPDepth1`   RG32F   ping-pong (-min, max) depth MRT
 *   - `_DDPFront0` / `_DDPFront1`   RGBA16F ping-pong front-color accum
 *   - `_DDPBack`                    RGBA16F back-color accum (single, associative)
 *
 * STAGE 1 (this commit): the feature is wired into the graph but its
 * renderer's `render()` is a no-op — depth-peel materials currently
 * fall through to the sorted path because no derived passes exist.
 * Stages 2-4 fill in the shader output paths, the multi-pass loop,
 * and the resolve composite.
 *
 * @group Graph
 */
export class TransparentDualDepthPeelingFeature extends RenderFeature {
    public readonly name = 'TransparentDualDepthPeelingFeature';
    public readonly stage = RenderStage.Transparent;
    public readonly reads = [COLOR_BUFFER, SCENE_COLOR_PYRAMID];
    public readonly writes = [DDP_FRONT_TEX, DDP_FRONT_DEPTH_TEX];

    private readonly _ctx: Context3D;
    private readonly _occlusion: OcclusionSystem;
    private readonly _clusterLighting: ClusterLightingRender;
    private _renderer: DualDepthPeelingRenderer | null = null;

    constructor(ctx: Context3D, occlusion: OcclusionSystem, clusterLighting: ClusterLightingRender) {
        super();
        this._ctx = ctx;
        this._occlusion = occlusion;
        this._clusterLighting = clusterLighting;
    }

    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        // Like TransparentOITFeature, we expose the RTs via the graph
        // pool so the eventual TransparentDualDepthPeelingResolveFeature
        // (stage 4) and any debug visualisation features can resolve
        // them by name.
        for (const tex of [DDP_FRONT_TEX, DDP_FRONT_DEPTH_TEX]) {
            pool.registerExternal<RenderTexture>(tex, () => RTResourceMap.getTexture(this._ctx, tex));
        }
    }

    public execute(ctx: FeatureContext): void {
        if (!this._renderer) {
            this._renderer = new DualDepthPeelingRenderer(this._ctx);
        }
        this._renderer.render(ctx.view, this._occlusion, this._clusterLighting.clusterLightingBuffer);
    }
}
