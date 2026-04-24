import { Depth2DTextureArray } from '../../../../textures/Depth2DTextureArray';
import { ShadowLightsCollect } from '../../collect/ShadowLightsCollect';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { ShadowMapPassRenderer } from '../../passRenderer/shadow/ShadowMapPassRenderer';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';

/**
 * Published handle name for the directional-light shadow map array.
 * `_MainShadowMap` is the CSM cascade array texture. Each cascade
 * occupies one slice (0..maxCascades-1), successive directional
 * lights use subsequent slice ranges up to `shadow.maxShadowMapNum`.
 *
 * @group Graph
 */
export const MAIN_SHADOW_MAP = '_MainShadowMap';

/**
 * C3 of the Phase C migration. Wraps {@link ShadowMapPassRenderer} as
 * a {@link RenderFeature} at stage {@link RenderStage.Shadow}.
 *
 * Design notes:
 * - The CSM cascade loop and per-light sub-render stay **inside**
 *   the existing `ShadowMapPassRenderer.render()` implementation —
 *   per the plan, we do NOT split cascade passes into separate
 *   graph nodes. Keeping one feature per conceptual pass avoids graph
 *   explosion (4 cascades × 8 lights × static/dynamic cache = 64
 *   nodes) without losing scheduling granularity.
 * - `ShadowLightsCollect.update(view)` is CPU-side bookkeeping that
 *   populates `shadowIndex` on each DirectLight and updates the
 *   per-light shadow-matrix buffer. It must run before render so
 *   callers previously threaded it through `RendererJob.renderFrame`.
 *   We pull it into the feature's execute so downstream consumers do
 *   not need to know the ordering.
 * - `setting.shadow.enable === false` is handled by the impl (early
 *   return). No feature-level disable needed.
 *
 * @group Graph
 */
export class ShadowFeature extends RenderFeature {
    public readonly name = 'ShadowFeature';
    public readonly stage = RenderStage.Shadow;
    public readonly writes = [MAIN_SHADOW_MAP];

    private readonly _impl: ShadowMapPassRenderer;
    private readonly _occlusion: OcclusionSystem;

    constructor(impl: ShadowMapPassRenderer, occlusion: OcclusionSystem) {
        super();
        this._impl = impl;
        this._occlusion = occlusion;
    }

    public get impl(): ShadowMapPassRenderer {
        return this._impl;
    }

    /** Install a getter for `_MainShadowMap` before the first frame.
     *  `depth2DArrayTexture` is owned by the shadow renderer and has
     *  its own rebuild lifecycle (size changes reallocate). */
    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<Depth2DTextureArray>(
            MAIN_SHADOW_MAP,
            () => this._impl.depth2DArrayTexture,
        );
    }

    public execute(ctx: FeatureContext): void {
        ShadowLightsCollect.update(ctx.view);
        this._impl.render(ctx.view, this._occlusion);
    }
}
