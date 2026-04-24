import { DepthCubeArrayTexture } from '../../../../textures/DepthCubeArrayTexture';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { PointLightShadowRenderer } from '../../passRenderer/shadow/PointLightShadowRenderer';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';

/**
 * Published handle name for the point-light shadow cube array.
 * Each point light that casts shadows gets one cubemap slot
 * (6 faces) inside this array texture, indexed by `pointIndex`.
 *
 * @group Graph
 */
export const POINT_SHADOW_CUBE_ARRAY = '_PointShadowCubeArray';

/**
 * C4 of the Phase C migration. Wraps {@link PointLightShadowRenderer}
 * as a {@link RenderFeature} at stage {@link RenderStage.Shadow}.
 *
 * Like C3, the per-light + per-cube-face render loop stays inside
 * the legacy impl — 6 render passes per point light times N lights
 * would explode the graph with no scheduling benefit. The feature
 * is a thin adapter and an external-handle registration.
 *
 * Runs at the same stage as {@link ShadowFeature}; the two have no
 * data dependency between them (different targets), so the graph
 * orders them by insertion — directional first, point second.
 *
 * @group Graph
 */
export class PointShadowFeature extends RenderFeature {
    public readonly name = 'PointShadowFeature';
    public readonly stage = RenderStage.Shadow;
    public readonly writes = [POINT_SHADOW_CUBE_ARRAY];

    private readonly _impl: PointLightShadowRenderer;
    private readonly _occlusion: OcclusionSystem;

    constructor(impl: PointLightShadowRenderer, occlusion: OcclusionSystem) {
        super();
        this._impl = impl;
        this._occlusion = occlusion;
    }

    public get impl(): PointLightShadowRenderer {
        return this._impl;
    }

    /** Install a getter for `_PointShadowCubeArray` before the first
     *  frame. The cube array texture is owned by the legacy impl. */
    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<DepthCubeArrayTexture>(
            POINT_SHADOW_CUBE_ARRAY,
            () => this._impl.cubeArrayTexture,
        );
    }

    public execute(ctx: FeatureContext): void {
        this._impl.render(ctx.view, this._occlusion);
    }
}
