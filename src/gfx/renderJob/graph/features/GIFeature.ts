import { RenderTexture } from '../../../../textures/RenderTexture';
import { DDGIProbeRenderer } from '../../passRenderer/ddgi/DDGIProbeRenderer';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';
import { MAIN_SHADOW_MAP } from './ShadowFeature';
import { POINT_SHADOW_CUBE_ARRAY } from './PointShadowFeature';

/**
 * Published handle names for the DDGI probe outputs. Material
 * shaders sample `_DDGIIrradianceMap` for octahedral-mapped
 * irradiance per probe; `_DDGIDepthMap` carries moments used for
 * probe visibility tests.
 *
 * @group Graph
 */
export const DDGI_IRRADIANCE_MAP = '_DDGIIrradianceMap';
export const DDGI_DEPTH_MAP = '_DDGIDepthMap';

/**
 * C6 of the Phase C migration. Wraps {@link DDGIProbeRenderer} as a
 * {@link RenderFeature}.
 *
 * The reads declaration ({@link MAIN_SHADOW_MAP},
 * {@link POINT_SHADOW_CUBE_ARRAY}) is how the graph's topo sort
 * places GIFeature **after** both shadow features. The underlying
 * texture wiring (`setInputTexture([shadowArr, cubeArr])`) is still
 * done eagerly in {@link ForwardRenderJob.start} by direct field
 * access — migrating that wire through `pool.get()` is a Phase E
 * tidying and does not need to happen here.
 *
 * Gated on `setting.gi.enable` and the presence of
 * `ddgiProbeRenderer` (which the parent constructor only creates
 * when GI is enabled).
 *
 * @group Graph
 */
export class GIFeature extends RenderFeature {
    public readonly name = 'GIFeature';
    public readonly stage = RenderStage.GI;
    public readonly reads = [MAIN_SHADOW_MAP, POINT_SHADOW_CUBE_ARRAY];
    public readonly writes = [DDGI_IRRADIANCE_MAP, DDGI_DEPTH_MAP];

    private readonly _impl: DDGIProbeRenderer;
    private readonly _occlusion: OcclusionSystem;

    constructor(impl: DDGIProbeRenderer, occlusion: OcclusionSystem) {
        super();
        this._impl = impl;
        this._occlusion = occlusion;
    }

    public get impl(): DDGIProbeRenderer {
        return this._impl;
    }

    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<RenderTexture>(
            DDGI_IRRADIANCE_MAP,
            () => this._impl.irradianceColorMap,
        );
        pool.registerExternal<RenderTexture>(
            DDGI_DEPTH_MAP,
            () => this._impl.irradianceDepthMap,
        );
    }

    public execute(ctx: FeatureContext): void {
        // DDGIProbeRenderer.compute is a no-op wrapper (inherited
        // from RendererBase); the real compute dispatches happen
        // inside render(). Mirror the legacy call order anyway so
        // any future override keeps working.
        this._impl.compute(ctx.view, this._occlusion);
        this._impl.render(ctx.view, this._occlusion);
    }
}
