import { RenderTexture } from '../../../../textures/RenderTexture';
import { VirtualTexture } from '../../../../textures/VirtualTexture';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { PreDepthPassRenderer } from '../../passRenderer/preDepth/PreDepthPassRenderer';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';

/**
 * Published handle names for the depth prepass outputs. The color
 * pass hooks its pipeline's depth-load-op to `_MainDepthTexture` via
 * `rtFrame.zPreTexture`; opaque-stage post passes (SSR, SSGI, outline)
 * read from `_ZBufferTexture`.
 *
 * @group Graph
 */
export const MAIN_DEPTH_TEXTURE = '_MainDepthTexture';
export const Z_BUFFER_TEXTURE = '_ZBufferTexture';

/**
 * C2 of the Phase C migration. Wraps {@link PreDepthPassRenderer} as a
 * {@link RenderFeature} gated on `engine.setting.render.zPrePass`.
 *
 * PreDepthPassRenderer's constructor allocates both textures via
 * {@link RTResourceMap} and wires them onto its `rendererPassState`
 * (depthTexture for the pass attachment, `zBufferTexture` as a
 * storage-texture side channel). The feature re-exposes both as
 * external graph handles so Phase C7 ColorFeature and later Phase C8
 * post passes can migrate without touching the legacy renderer.
 *
 * Only added to the graph when `setting.render.zPrePass === true` —
 * matching the conditional construction in
 * {@link RendererJob.constructor}. Toggling `zPrePass` at runtime
 * would require Phase E work (lazy pass generation + feature
 * insertion) and is out of scope for this PR.
 *
 * @group Graph
 */
export class PreDepthFeature extends RenderFeature {
    public readonly name = 'PreDepthFeature';
    public readonly stage = RenderStage.PreDepth;
    public readonly writes = [MAIN_DEPTH_TEXTURE, Z_BUFFER_TEXTURE];

    private readonly _impl: PreDepthPassRenderer;
    private readonly _occlusion: OcclusionSystem;

    constructor(impl: PreDepthPassRenderer, occlusion: OcclusionSystem) {
        super();
        this._impl = impl;
        this._occlusion = occlusion;
    }

    public get impl(): PreDepthPassRenderer {
        return this._impl;
    }

    /** Install getters for `_MainDepthTexture` + `_ZBufferTexture`
     *  before the first frame runs. Both textures are owned by
     *  PreDepthPassRenderer / RTResourceMap — the getter returns
     *  the current instance so callers always see the latest
     *  resize-rebuilt texture. */
    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<RenderTexture>(
            MAIN_DEPTH_TEXTURE,
            () => this._impl.rendererPassState.depthTexture,
        );
        pool.registerExternal<VirtualTexture>(
            Z_BUFFER_TEXTURE,
            () => this._impl.zBufferTexture,
        );
    }

    public execute(ctx: FeatureContext): void {
        // PreDepthPassRenderer.render() calls this.compute() internally.
        this._impl.render(ctx.view, this._occlusion);
    }
}
