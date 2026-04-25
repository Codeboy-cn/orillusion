import { RenderTexture } from '../../../../textures/RenderTexture';
import { ColorPassRenderer } from '../../passRenderer/color/ColorPassRenderer';
import { ClusterLightingRender } from '../../passRenderer/cluster/ClusterLightingRender';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';
import { CLUSTER_LIGHTING_BUFFER } from './ClusterLightingFeature';
import { MAIN_SHADOW_MAP } from './ShadowFeature';
import { POINT_SHADOW_CUBE_ARRAY } from './PointShadowFeature';
import { REFLECTION_CUBE_MAP } from './ReflectionFeature';
import { DDGI_DEPTH_MAP, DDGI_IRRADIANCE_MAP } from './GIFeature';

/**
 * Published handle names for the main color pass outputs.
 *
 * - `_ColorBuffer`: the final shaded color target (rgba16float,
 *   scene-sized). Post passes read this as their first input.
 * - `_NormalBuffer`: the compressed G-buffer attachment that packs
 *   normal + position + material data (rgba32float). Post passes
 *   that need geometry info (SSR, SSGI, outline) decode it themselves.
 *
 * The two handles point at the same underlying {@link GBufferFrame}
 * attachments owned by the legacy path — re-exposing them through
 * the graph lets Phase C8 post passes read them by name instead of
 * reaching into `renderJob`.
 *
 * @group Graph
 */
export const COLOR_BUFFER = '_ColorBuffer';
export const NORMAL_BUFFER = '_NormalBuffer';

/**
 * C7 of the Phase C migration — **high risk**. Wraps the main
 * forward color pass ({@link ColorPassRenderer}) as a
 * {@link RenderFeature}.
 *
 * Sub-passes that stay internal (per the plan's explicit directive
 * to NOT split):
 * - **Sky**: rendered by `ColorPassRenderer.render()` between
 *   opaque and transparent via `sky.renderPass2(PassType.COLOR, ...)`.
 * - **Transparent**: rendered in the same method, sorted back-to-front.
 * - **Graphic3D**: rendered via `splitRendererPassState` (the
 *   "load" variant of the pass state so existing color content is
 *   preserved). Done inside the same render() call.
 *
 * Reads declaration: the full set of resources shading consumes.
 * DDGI handles are added conditionally based on whether GIFeature
 * is active (handles are only registered by an enabled GIFeature;
 * reading an unregistered handle raises `UnresolvedResourceError`).
 *
 * Stage is {@link RenderStage.Opaque}. Shadow / GI / Reflection
 * features at earlier stages all complete before this feature runs
 * — both by stage ordering and by reads-writes topology.
 *
 * @group Graph
 */
export class ColorFeature extends RenderFeature {
    public readonly name = 'ColorFeature';
    public readonly stage = RenderStage.Opaque;
    public declare readonly reads: readonly string[];
    public readonly writes = [COLOR_BUFFER, NORMAL_BUFFER];

    private readonly _impl: ColorPassRenderer;
    private readonly _occlusion: OcclusionSystem;
    private readonly _clusterLighting: ClusterLightingRender;
    private readonly _ctx: Context3D;
    private readonly _giEnabled: boolean;

    constructor(
        impl: ColorPassRenderer,
        occlusion: OcclusionSystem,
        clusterLighting: ClusterLightingRender,
        ctx: Context3D,
        giEnabled: boolean,
    ) {
        super();
        this._impl = impl;
        this._occlusion = occlusion;
        this._clusterLighting = clusterLighting;
        this._ctx = ctx;
        this._giEnabled = giEnabled;
        const reads: string[] = [
            CLUSTER_LIGHTING_BUFFER,
            MAIN_SHADOW_MAP,
            POINT_SHADOW_CUBE_ARRAY,
            REFLECTION_CUBE_MAP,
        ];
        if (giEnabled) {
            reads.push(DDGI_IRRADIANCE_MAP, DDGI_DEPTH_MAP);
        }
        (this as any).reads = reads;
    }

    public get impl(): ColorPassRenderer {
        return this._impl;
    }

    /** Install getters for `_ColorBuffer` + `_NormalBuffer`. Both
     *  come off the shared color-pass GBufferFrame; the legacy code
     *  writes into it via the `ColorPassRenderer.rendererPassState`
     *  attachments. Getters read through `GBufferFrame.getGBufferFrame`
     *  so resize / re-init picks up the new textures. */
    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<RenderTexture>(
            COLOR_BUFFER,
            () => GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).getColorTexture(),
        );
        pool.registerExternal<RenderTexture>(
            NORMAL_BUFFER,
            () => GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).getCompressGBufferTexture(),
        );
    }

    public execute(ctx: FeatureContext): void {
        // Phase D: wire DDGI irradiance through the pool every frame
        // instead of once in ForwardRenderJob.start(). This decouples
        // ColorPassRenderer from direct field access on the renderer
        // job and lets a future GI-swap feature take effect on the
        // next frame (edit GIFeature → irradiance updates, no restart).
        if (this._giEnabled) {
            const irradianceColor = ctx.get<RenderTexture>(DDGI_IRRADIANCE_MAP);
            const irradianceDepth = ctx.get<RenderTexture>(DDGI_DEPTH_MAP);
            if (irradianceColor && irradianceDepth) {
                this._impl.setIrradiance(irradianceColor, irradianceDepth);
            }
        }

        // ColorFeature now renders only the opaque half (opaque + sky
        // draws) by passing maskTr=true. The transparent half is owned
        // by SortedTransparentFeature at RenderStage.Transparent, which
        // continues the same render pass with loadOp='load' after the
        // SceneColorPyramidFeature has snapshotted the opaque-only color
        // buffer. See the P1 transmission plan.
        //
        // Transmission split: opaque materials with transmission > 0
        // (glass, refractive plastic) are deferred to TransmissionOpaque-
        // Feature, which runs after the pyramid copy. That way the
        // pyramid contains the world *behind* the glass — which is what
        // refraction needs to sample — instead of the glass itself.
        const prevFilter = this._impl.transmissionFilter;
        this._impl.transmissionFilter = 'exclude';
        try {
            this._impl.render(
                ctx.view,
                this._occlusion,
                this._clusterLighting.clusterLightingBuffer,
                true,  // maskTr — do not touch transparent here
                false, // maskOp
            );
        } finally {
            this._impl.transmissionFilter = prevFilter;
        }
    }
}
