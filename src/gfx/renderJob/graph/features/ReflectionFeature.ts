import { VirtualTexture } from '../../../../textures/VirtualTexture';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { ClusterLightingRender } from '../../passRenderer/cluster/ClusterLightingRender';
import { ReflectionRenderer } from '../../passRenderer/cubeRenderer/ReflectionRenderer';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';

/**
 * Published handle name for the pre-filtered reflection environment
 * map. Used by Color / shading passes to sample reflections at
 * mip levels corresponding to material roughness.
 *
 * @group Graph
 */
export const REFLECTION_CUBE_MAP = '_ReflectionCubeMap';

/**
 * C5 of the Phase C migration. Wraps {@link ReflectionRenderer} as a
 * {@link RenderFeature}. The renderer implements both a cube-face
 * render (which internally sub-renders Sky via a REFLECTION-typed
 * pass dispatch) and a post-compute pre-filter step — both stay
 * inside the legacy impl per the plan's "Sky sub-pass internal to
 * reflection, do not split" directive.
 *
 * Stage is {@link RenderStage.GI} so reflection update runs after
 * shadow maps (which it samples when rendering the cube faces) but
 * before DDGI probe integration (which samples the reflection map).
 *
 * @group Graph
 */
export class ReflectionFeature extends RenderFeature {
    public readonly name = 'ReflectionFeature';
    public readonly stage = RenderStage.GI;
    public readonly writes = [REFLECTION_CUBE_MAP];

    private readonly _impl: ReflectionRenderer;
    private readonly _occlusion: OcclusionSystem;
    private readonly _clusterLighting: ClusterLightingRender;

    constructor(impl: ReflectionRenderer, occlusion: OcclusionSystem, clusterLighting: ClusterLightingRender) {
        super();
        this._impl = impl;
        this._occlusion = occlusion;
        this._clusterLighting = clusterLighting;
    }

    public get impl(): ReflectionRenderer {
        return this._impl;
    }

    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<VirtualTexture>(
            REFLECTION_CUBE_MAP,
            () => this._impl.outTexture,
        );
    }

    public execute(ctx: FeatureContext): void {
        // ReflectionRenderer pairs a compute pass (pre-filter) with
        // the cube-face render — mirror the legacy call order used
        // by `RendererJob.renderFrame`'s passList loop.
        this._impl.compute(ctx.view, this._occlusion);
        this._impl.render(
            ctx.view,
            this._occlusion,
            this._clusterLighting.clusterLightingBuffer,
            false,
        );
    }
}
