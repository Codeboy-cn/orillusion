import { Camera3D } from '../../../core/Camera3D';
import { View3D } from '../../../core/View3D';
import { GlobalBindGroup } from '../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { ClusterLightingFeature } from '../graph/features/ClusterLightingFeature';
import { PreDepthFeature } from '../graph/features/PreDepthFeature';
import { ShadowFeature } from '../graph/features/ShadowFeature';
import { PointShadowFeature } from '../graph/features/PointShadowFeature';
import { ReflectionFeature } from '../graph/features/ReflectionFeature';
import { GIFeature } from '../graph/features/GIFeature';
import { ColorFeature } from '../graph/features/ColorFeature';
import { GPUCullFeature } from '../graph/features/GPUCullFeature';
import { HiZFeature } from '../graph/features/HiZFeature';
import { MotionVectorFeature } from '../graph/features/MotionVectorFeature';
import { SceneColorPyramidFeature } from '../graph/features/SceneColorPyramidFeature';
import { SortedTransparentFeature } from '../graph/features/SortedTransparentFeature';
import { TransmissionOpaqueFeature } from '../graph/features/TransmissionOpaqueFeature';
import { TransparentOITFeature } from '../graph/features/TransparentOITFeature';
import { TransparentDualDepthPeelingFeature } from '../graph/features/TransparentDualDepthPeelingFeature';
import { TransparentDualDepthPeelingResolveFeature } from '../graph/features/TransparentDualDepthPeelingResolveFeature';
import { TransparentResolveFeature } from '../graph/features/TransparentResolveFeature';
import { PostFeature } from '../graph/features/PostFeature';
import { GUIFeature } from '../graph/features/GUIFeature';
import { RenderGraph } from '../graph/RenderGraph';
import { PassType } from '../passRenderer/state/PassType';
import { ColorPassRenderer } from '../passRenderer/color/ColorPassRenderer';
import { OcclusionSystem } from '../occlusion/OcclusionSystem';
import { ProfilerUtil } from '../../../util/ProfilerUtil';
import { ForwardRenderJob } from './ForwardRenderJob';

/**
 * Frame Graph-driven renderer job — the default after Phase D
 * (`setting.render.useFrameGraph = true`). Extends
 * {@link ForwardRenderJob} so ColorPassRenderer / DDGI / Post
 * lazy-init plumbing stays reachable, and drives rendering entirely
 * through a {@link RenderGraph} of 9 features (C1..C9).
 *
 * @internal
 * @group Post
 */
export class FrameGraphRendererJob extends ForwardRenderJob {
    public readonly graph: RenderGraph;
    private _frameIndex: number = 0;

    constructor(view: View3D) {
        super(view);
        this.graph = new RenderGraph(view.engine3D.context3D);
        // C1: cluster lighting compute runs under the graph. Register
        // the external handle eagerly (before the first frame) so
        // downstream features can resolve `_ClusterLightingBuffer`
        // without a pending execute() cycle.
        const clusterFeature = new ClusterLightingFeature(this.clusterLightingRender, this.occlusionSystem);
        clusterFeature.registerResources(this.graph.pool);
        this.graph.addFeature(clusterFeature);

        // C2: z-prepass is gated on `setting.render.zPrePass`. The
        // parent RendererJob constructor only builds `depthPassRenderer`
        // when the flag is on; mirror that condition here so the
        // feature and the underlying renderer are in lockstep.
        if (this.depthPassRenderer) {
            const preDepthFeature = new PreDepthFeature(this.depthPassRenderer, this.occlusionSystem);
            preDepthFeature.registerResources(this.graph.pool);
            this.graph.addFeature(preDepthFeature);
        }

        // Hi-Z depth pyramid. Allocates `_HiZPyramid` and runs a
        // per-frame max-z reduction compute pass — downstream
        // consumers (SSR / GPU cull occlusion / Volumetric Fog
        // visibility) can sample the chain at any mip.
        const hizFeature = new HiZFeature(view.engine3D.context3D);
        hizFeature.registerResources(this.graph.pool);
        this.graph.addFeature(hizFeature);

        // Motion Vector (screen-space reverse-reproject MVP).
        // Allocates `_MotionVector` (rg16float) and runs a compute
        // pass each frame using the prior frame's viewProj.
        const mvFeature = new MotionVectorFeature(view.engine3D.context3D);
        mvFeature.registerResources(this.graph.pool);
        this.graph.addFeature(mvFeature);

        // GPU-driven mesh culling. Opt-in via setting; the feature
        // computes a visibility buffer + indirect draw args on the
        // GPU each frame. Renderer integration is follow-up.
        const useGPUCull = !!(view.engine3D.setting.render as any).gpuCull;
        if (useGPUCull) {
            const cullFeature = new GPUCullFeature(view.engine3D.context3D);
            cullFeature.registerResources(this.graph.pool);
            this.graph.addFeature(cullFeature);
        }

        // C3: directional-light shadow map (CSM cascade array). The
        // parent RendererJob constructor always builds
        // `shadowMapPassRenderer`; shadow-on-off is decided inside
        // the renderer via `setting.shadow.enable`. Mirror that here
        // — the feature registers unconditionally, and the impl's
        // early-return handles the disabled case.
        if (this.shadowMapPassRenderer) {
            const shadowFeature = new ShadowFeature(this.shadowMapPassRenderer, this.occlusionSystem);
            shadowFeature.registerResources(this.graph.pool);
            this.graph.addFeature(shadowFeature);
        }

        // C4: point-light shadow cube array. Parent constructor
        // always builds `pointLightShadowRenderer`; per-light shadow
        // activation is decided by the renderer internally based on
        // `ShadowLightsCollect`.
        if (this.pointLightShadowRenderer) {
            const pointShadowFeature = new PointShadowFeature(this.pointLightShadowRenderer, this.occlusionSystem);
            pointShadowFeature.registerResources(this.graph.pool);
            this.graph.addFeature(pointShadowFeature);
        }

        // C5: reflection probe pre-filter. The parent RendererJob
        // already constructs `reflectionRenderer` and adds it to
        // `rendererMap` (PassType.REFLECTION). The graph-mode
        // `_runLegacyRemaining` below explicitly skips REFLECTION so
        // the feature drives it exclusively — running it twice
        // corrupts the pre-filtered output and doubles command cost.
        if (this.reflectionRenderer) {
            const reflectionFeature = new ReflectionFeature(
                this.reflectionRenderer,
                this.occlusionSystem,
                this.clusterLightingRender,
            );
            reflectionFeature.registerResources(this.graph.pool);
            this.graph.addFeature(reflectionFeature);
        }

        // C8: PostRenderer is created in the parent RendererJob's
        // constructor (via the `addPost(new FXAAPost())` call) so it
        // is available here. Wrapping the whole chain as one feature
        // — per-`*Post.ts` migration is deferred to Phase E cleanup
        // per the plan's "sub-pass loops stay internal" rule.
        if (this.postRenderer) {
            const postFeature = new PostFeature(this.postRenderer, view.engine3D.context3D);
            postFeature.registerResources(this.graph.pool);
            this.graph.addFeature(postFeature);

            // C9: present-to-canvas lives at the tail of the graph,
            // reading whatever texture PostFeature advertised as
            // `_FinalColor`. Driven by the same PostRenderer instance
            // (it hosts the fullscreen quad used for the final blit).
            const guiFeature = new GUIFeature(this.postRenderer);
            guiFeature.registerResources(this.graph.pool);
            this.graph.addFeature(guiFeature);
        }
    }

    /** Drive one frame through the graph. Pre-graph bookkeeping that
     *  sits outside any feature (camera, light / reflection entries,
     *  occlusion snapshot) runs inline; everything else is owned by
     *  features C1..C9 registered in `constructor` and `start`. */
    public renderFrame(): void {
        const view = this.view;
        Camera3D.mainCamera = view.camera;
        ProfilerUtil.startView(view);

        GlobalBindGroup.getLightEntries(view.scene).update(view);
        GlobalBindGroup.getReflectionEntries(view.scene).update(view);

        this.occlusionSystem.update(view.camera, view.scene);

        const occlusion: OcclusionSystem = this.occlusionSystem;
        this.graph.execute(view, occlusion, this._frameIndex++);
    }

    /** Override ForwardRenderJob.start — after the super call wires
     *  up the ColorPassRenderer and (conditionally) DDGIProbeRenderer,
     *  register any late-bound features whose underlying renderers
     *  only exist post-start. */
    public start(): void {
        super.start();
        const ctx = this.view.engine3D.context3D;
        const giEnabled = !!this.view.engine3D.setting.gi.enable;

        // C6: DDGI probe renderer is created lazily in
        // ForwardRenderJob.start() when `setting.gi.enable` is true,
        // so it is undefined at constructor time. Register the feature
        // here, after super.start has populated `ddgiProbeRenderer`.
        if (this.ddgiProbeRenderer && !this.graph.getFeature('GIFeature')) {
            const giFeature = new GIFeature(this.ddgiProbeRenderer, this.occlusionSystem);
            giFeature.registerResources(this.graph.pool);
            this.graph.addFeature(giFeature);
        }

        // C7: ColorPassRenderer is created in ForwardRenderJob.start()
        // and added to rendererMap with PassType.COLOR. The legacy
        // passList loop is skipped below (COLOR excluded) so the
        // feature owns the color pass exclusively. Its `reads` set
        // widens when GI is enabled — same-gate as GIFeature.
        const colorPass = this.rendererMap.getRenderer(PassType.COLOR) as ColorPassRenderer | undefined;
        if (colorPass && !this.graph.getFeature('ColorFeature')) {
            const colorFeature = new ColorFeature(
                colorPass,
                this.occlusionSystem,
                this.clusterLightingRender,
                ctx,
                giEnabled,
            );
            colorFeature.registerResources(this.graph.pool);
            this.graph.addFeature(colorFeature);

            // P1: capture the opaque-only color as a sampleable texture
            // for Transmission / refraction sampling. Runs unconditionally
            // — the copy is cheap (`copyTextureToTexture`) and opting in
            // at material level (`material.transmissionFactor > 0`) is
            // the right knob; a dead feature is worse than a 0.1ms copy.
            if (!this.graph.getFeature('SceneColorPyramidFeature')) {
                const pyramidFeature = new SceneColorPyramidFeature(ctx);
                pyramidFeature.registerResources(this.graph.pool);
                this.graph.addFeature(pyramidFeature);
                // Eagerly allocate the pyramid texture so LitMaterials
                // instantiated after engine.start() can bind it
                // without waiting for the first AfterOpaque execute.
                // Accessing the graph pool triggers the registered
                // external getter which in turn calls `_getOrAllocate`.
                this.graph.pool.get('_SceneColorPyramid');
            }

            // Transmission split: opaque materials with transmission > 0
            // (glass, refractive plastic) draw AFTER the pyramid copy so
            // their refraction shader can sample a pyramid that contains
            // the rest of the world (cloth, walls, floor) but not the
            // transmissive surface itself. ColorFeature.execute filters
            // them out via `colorPass.transmissionFilter='exclude'`; this
            // feature reopens the pass with `loadOp='load'` and draws
            // them with `transmissionFilter='only'`.
            if (!this.graph.getFeature('TransmissionOpaqueFeature')) {
                const transmissionFeature = new TransmissionOpaqueFeature(
                    colorPass,
                    this.occlusionSystem,
                    this.clusterLightingRender,
                );
                this.graph.addFeature(transmissionFeature);
            }

            // P1: transparent pass moved out of ColorFeature (which now
            // runs opaque-only via maskTr=true). This matches the plan's
            // stage-by-stage ordering: Opaque(40) → AfterOpaque(50) →
            // Transparent(60), with the pyramid snapshot between them.
            //
            // P2: the transparent pass is split by engine opt-in. When
            // `useOIT=true`, the OIT feature owns the transparent stage
            // and a paired resolve feature runs at AfterTransparent.
            // Otherwise the sorted path runs alone. The two transparent
            // features are mutually exclusive so the graph never double-
            // renders the transparent queue.
            // Coexist mode: when useOIT is on, BOTH features run —
            // sorted with a `'sorted'` filter (skips weighted), OIT
            // with its own renderer that filters to weighted-only.
            // When useOIT is off, only sorted runs and renders every
            // transparent node (legacy behavior).
            const useOIT = !!(this.view.engine3D.setting.render as any).useOIT;
            if (!this.graph.getFeature('SortedTransparentFeature')) {
                const transparentFeature = new SortedTransparentFeature(
                    colorPass,
                    this.occlusionSystem,
                    this.clusterLightingRender,
                    useOIT ? 'sorted' : 'all',
                );
                this.graph.addFeature(transparentFeature);
            }
            if (useOIT) {
                if (!this.graph.getFeature('TransparentOITFeature')) {
                    const oitFeature = new TransparentOITFeature(ctx, this.occlusionSystem, this.clusterLightingRender);
                    oitFeature.registerResources(this.graph.pool);
                    this.graph.addFeature(oitFeature);
                }
                // Dual Depth Peeling runs alongside WBOIT — each
                // feature filters to materials matching its own
                // oitMode, so a scene can mix `'sorted'`, `'weighted'`,
                // and `'depth-peel'` materials and each goes through
                // the right pipeline. Stage 1: feature is wired but
                // its renderer is a no-op stub; depth-peel materials
                // currently fall through to the sorted path.
                if (!this.graph.getFeature('TransparentDualDepthPeelingFeature')) {
                    const ddpFeature = new TransparentDualDepthPeelingFeature(ctx, this.occlusionSystem, this.clusterLightingRender);
                    ddpFeature.registerResources(this.graph.pool);
                    this.graph.addFeature(ddpFeature);
                }
                if (!this.graph.getFeature('TransparentResolveFeature')) {
                    this.graph.addFeature(new TransparentResolveFeature(ctx));
                }
                // DDP composite — runs at AfterTransparent like
                // TransparentResolveFeature so depth-peel materials
                // get composited after both opaque and any sorted /
                // weighted transparent rendering. Pre-multiplied over
                // operator so α=1 is fully opaque.
                if (!this.graph.getFeature('TransparentDualDepthPeelingResolveFeature')) {
                    this.graph.addFeature(new TransparentDualDepthPeelingResolveFeature(ctx));
                }
            }
        }
    }

    public destroy(force?: boolean): void {
        this.graph.destroy();
        super.destroy(force);
    }

}
