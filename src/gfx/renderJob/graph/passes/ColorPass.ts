import { View3D } from '../../../../core/View3D';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GlobalBindGroup } from '../../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { WebGPUDescriptorCreator } from '../../../graphics/webGpu/descriptor/WebGPUDescriptorCreator';
import { EntityCollect } from '../../collect/EntityCollect';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { RTFrame } from '../../frame/RTFrame';
import { ClusterLightingBuffer } from '../../passRenderer/cluster/ClusterLightingBuffer';
import { RenderContext } from '../../passRenderer/RenderContext';
import { PassType } from '../../passRenderer/state/PassType';
import { RendererPassState } from '../../passRenderer/state/RendererPassState';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { buildOpBundles, dependOnIfRegistered } from './_helpers';
import { ClusterLightingPass, CLUSTER_LIGHTING_BUFFER } from './ClusterLightingPass';
import { MAIN_DEPTH_TEXTURE } from './PreDepthPass';
import { MAIN_SHADOW_MAP } from './ShadowPass';
import { POINT_SHADOW_CUBE_ARRAY } from './PointShadowPass';
import { REFLECTION_CUBE_MAP } from './ReflectionPass';
import { DDGI_DEPTH_MAP, DDGI_IRRADIANCE_MAP } from './GIPass';
import { drawNodes, TRANSPARENT_DRAW_CTX, TransparentDrawContext } from './_transparentDraw';

// Re-export the shared draw-context contract through ColorPass so users
// hitting the package barrel (`@orillusion/core`) can resolve
// TRANSPARENT_DRAW_CTX / TransparentDrawContext without reaching into
// the `_transparentDraw` module (which sits beneath a leading-underscore
// filename convention that the public export aggregator skips).
export {
    TRANSPARENT_DRAW_CTX,
    type TransparentDrawContext,
    drawNodes,
    drawSortedTransparent,
    drawTransmissionContinuation,
    type DrawNodesOptions,
    type OitFilter,
    type TransmissionFilter,
} from './_transparentDraw';

/**
 * Published handle names for the main color pass outputs.
 *
 * - `_ColorBuffer`: the final shaded color target (rgba16float,
 *   scene-sized). Post passes read this as their first input.
 * - `_NormalBuffer`: the compressed G-buffer attachment that packs
 *   normal + position + material data (rgba32float). Post passes
 *   that need geometry info (SSR, SSGI, outline) decode it themselves.
 *
 * @group Graph
 */
export const COLOR_BUFFER = '_ColorBuffer';
export const NORMAL_BUFFER = '_NormalBuffer';

/**
 * Main forward color pass. Renders the opaque half of the scene plus
 * the sky, then ends the render pass so downstream transparent
 * continuation passes can reopen the color attachment with
 * loadOp='load':
 *
 * - {@link execute} draws opaque + sky (transmission materials are
 *   excluded so the SceneColorPyramid copy that follows sees the world
 *   *behind* the glass, not the glass itself).
 * - {@link TransmissionOpaquePass} draws the deferred transmission
 *   opaque materials after the pyramid has snapshotted the rest of
 *   the world.
 * - {@link SortedTransparentPass} draws the sorted transparent half
 *   (and Graphic3D overlays).
 *
 * The three render-pass states + RenderContext used by the continuation
 * passes are exposed as the {@link TRANSPARENT_DRAW_CTX} graph
 * resource — those passes resolve it via `b.read` instead of reaching
 * into ColorPass via `graph.getPass`, so each pass stands on its own
 * for hot-swap purposes.
 *
 * @group Graph
 */
export class ColorPass extends RenderGraphPass {
    public readonly name: string = 'ColorPass';

    public rendererPassState!: RendererPassState;

    protected readonly _passType: PassType = PassType.COLOR;
    protected readonly _giEnabled: boolean;
    protected _ctx!: Context3D;
    protected _renderContext!: RenderContext;
    protected _splitRendererPassState!: RendererPassState;

    constructor(public readonly config: { giEnabled: boolean } = { giEnabled: false }) {
        super();
        this._giEnabled = config.giEnabled;
    }

    public setup(b: RenderGraphBuilder): void {
        this._ctx = b.context3D;
        const rtFrame = this.allocateRtFrame(b);
        this.buildRenderStates(b, rtFrame);
        this.declareShadingReads(b);
        this.registerSharedOutputs(b);
        this.declareSideEffects(b);
    }

    /** Allocate (or fetch from cache) the RT frame this pass renders into.
     *  Override to return a different GBufferFrame key, a clone, or to
     *  preconfigure loadOps. The default takes the shared `colorPass_GBuffer`
     *  singleton and wires in the prepass depth when `zPrePass` is on. */
    protected allocateRtFrame(b: RenderGraphBuilder): RTFrame {
        const view = b.view;
        const ctx = b.context3D;
        const setting = view.engine3D.setting;

        // A7: validate MSAA value. WebGPU only mandates support for
        // sampleCount 1 and 4. 2 and 8 are device-dependent and most
        // desktop adapters expose them, but iOS Safari only surfaces
        // 4. Anything outside {0, 2, 4, 8} is rejected at pipeline
        // creation — clamp here so the user gets a clear warning
        // instead of an opaque pipeline error.
        const rawMsaa = (setting.render as any).msaa | 0;
        let msaa = rawMsaa;
        if (msaa !== 0 && msaa !== 2 && msaa !== 4 && msaa !== 8) {
            console.warn(`[transparency] engine.setting.render.msaa = ${rawMsaa} is not a supported sample count. Valid values: 0 | 2 | 4 | 8. Falling back to 0 (MSAA disabled).`);
            msaa = 0;
        }
        // A6: MSAA + compressGBuffer combination is broken because
        // rgba32float can't be MSAA-resolved by WebGPU. Don't
        // auto-disable post effects (users may not have any wired up)
        // but emit a one-time warning so developers know what they
        // signed up for.
        if (msaa > 0 && (setting.render as any).useCompressGBuffer) {
            console.warn(`[transparency] msaa=${msaa} with useCompressGBuffer=true. The rgba32float g-buffer cannot be MSAA-resolved; post-effects that read it (SSR, SSAO, GTAO, GodRay, GlobalFog, DepthOfField, TAA) will see undefined contents. Either disable MSAA or disable useCompressGBuffer.`);
        }

        const rtFrame = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, ctx, 0, 0, true, undefined, msaa);

        // Wire the prepass depth (when zPrePass is on) by reading the
        // graph pool's external handle. `b.read` declares the
        // dependency for the validator (so a missing PreDepthPass
        // surfaces at compile() with UnresolvedResourceError instead
        // of a raw pool throw); the imperative `pool.get` then fetches
        // the texture for eager binding into rtFrame.zPreTexture.
        if (setting.render.zPrePass) {
            b.read(MAIN_DEPTH_TEXTURE);
            rtFrame.zPreTexture = b.graph.pool.get(MAIN_DEPTH_TEXTURE) as RenderTexture;
        }
        return rtFrame;
    }

    /** Build the two RendererPassStates this pass uses: `rendererPassState`
     *  for the first (clear) render pass, `_splitRendererPassState` for
     *  any continuation (load/load) opened by downstream passes via
     *  {@link TRANSPARENT_DRAW_CTX}. Override to use different load ops. */
    protected buildRenderStates(b: RenderGraphBuilder, rtFrame: RTFrame): void {
        const ctx = b.context3D;
        this.rendererPassState = WebGPUDescriptorCreator.createRendererPassState(ctx, rtFrame);
        const splitRtFrame = rtFrame.clone();
        splitRtFrame.depthLoadOp = 'load';
        for (const desc of splitRtFrame.rtDescriptors) desc.loadOp = 'load';
        this._splitRendererPassState = WebGPUDescriptorCreator.createRendererPassState(ctx, splitRtFrame);
        this._renderContext = new RenderContext(ctx, rtFrame);
    }

    /** Declare the per-frame shading inputs this pass reads. Override
     *  to add/remove shading deps (e.g. skip shadow read in a depth-only
     *  variant). */
    protected declareShadingReads(b: RenderGraphBuilder): void {
        b.read(CLUSTER_LIGHTING_BUFFER);
        b.read(MAIN_SHADOW_MAP);
        b.read(POINT_SHADOW_CUBE_ARRAY);
        b.read(REFLECTION_CUBE_MAP);
        if (this._giEnabled) {
            b.read(DDGI_IRRADIANCE_MAP);
            b.read(DDGI_DEPTH_MAP);
        }
    }

    /** Register the resources this pass produces for downstream passes:
     *  `COLOR_BUFFER`, `NORMAL_BUFFER`, and the `TRANSPARENT_DRAW_CTX`
     *  shared draw context. Override to no-op when chaining a second
     *  opaque pass that shares the same GBuffer (only one pass can be
     *  the registered creator — see RenderGraph.validateSingleCreator). */
    protected registerSharedOutputs(b: RenderGraphBuilder): void {
        b.write<RenderTexture>(COLOR_BUFFER, () =>
            GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).getColorTexture()
        );
        b.write<RenderTexture>(NORMAL_BUFFER, () =>
            GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).getCompressGBufferTexture()
        );

        // Shared draw state for the transparent continuation passes.
        // Resolved by TransmissionOpaquePass / SortedTransparentPass at
        // execute time so they can stand on their own without reaching
        // into ColorPass via graph.getPass.
        b.write<TransparentDrawContext>(TRANSPARENT_DRAW_CTX, () => ({
            rendererPassState: this.rendererPassState,
            splitRendererPassState: this._splitRendererPassState,
            renderContext: this._renderContext,
        }));
    }

    /** Declare any non-resource ordering constraints. SceneCapturePass
     *  renders off-screen RTs that this frame's lit materials sample
     *  directly via SceneCaptureCameraComponent (no graph-pool handle).
     *  GPUCullPass (when present) populates the indirect draw buffers
     *  consumed through GlobalBindGroup. Neither flows as a `b.read`, so
     *  we declare the ordering explicitly. */
    protected declareSideEffects(b: RenderGraphBuilder): void {
        dependOnIfRegistered(b, 'SceneCapturePass', 'GPUCullPass');
    }

    public execute(ctx: RenderGraphPassContext): void {
        // Wire DDGI irradiance through the pool every frame so a
        // future GI swap takes effect on the next frame (edit GIPass
        // → irradiance updates, no restart).
        if (this._giEnabled) {
            const irradianceColor = ctx.get<RenderTexture>(DDGI_IRRADIANCE_MAP);
            const irradianceDepth = ctx.get<RenderTexture>(DDGI_DEPTH_MAP);
            if (irradianceColor && irradianceDepth) {
                this.rendererPassState.irradianceBuffer = [irradianceColor, irradianceDepth];
            }
        }

        const view = ctx.view;
        const camera = view.camera;
        const cluster = this._getCluster(view);

        const gpu = view.engine3D.context3D.gpuContext;
        this._renderContext.gpu = gpu;
        // Opaque-half call owns the render context — start fresh. The
        // continuation halves (transmission, transparent) reopen with
        // loadOp='load'.
        this._renderContext.clean();

        GlobalBindGroup.updateCameraGroup(camera);
        this.rendererPassState.camera3D = camera;

        const layered = this.collectLayered(view);

        const opBundles = buildOpBundles(view, camera, this._passType, this.rendererPassState, cluster);

        this.beginColorRenderPass();
        const encoder = this._renderContext.encoder;

        if (opBundles.length > 0) {
            encoder.executeBundles(opBundles);
        }

        // bindCamera is unconditional: subsequent draw stages (sky, and
        // any continuation passes that reuse this encoder via the
        // split render-pass state) rely on the per-camera bind group
        // being bound at group 0, independent of whether the opaque
        // list was empty this frame.
        gpu.bindCamera(encoder, camera);
        if (layered.opaque.length > 0) {
            drawNodes(
                view,
                this._renderContext,
                this.rendererPassState,
                layered.opaque,
                cluster,
                { transmissionFilter: 'exclude', passType: this._passType },
            );
        }

        // Sky goes LAST in the opaque half — by now every opaque mesh
        // has written depth, so sky's `depthCompare='less_equal' +
        // writeDepth=false` only paints empty pixels (where Z is still
        // the cleared 1.0). Same optimization Unity / UE apply by
        // default.
        if (this.shouldDrawSky()) {
            const sky = EntityCollect.instance.getSky(view.scene);
            if (sky) {
                gpu.bindCamera(encoder, camera);
                if (!sky.preInit(this._passType)) {
                    sky.nodeUpdate(view, this._passType, this.rendererPassState, cluster);
                }
                sky.renderPass2(view, this._passType, this.rendererPassState, cluster, encoder);
            }
        }

        this._renderContext.endRenderPass();
    }

    /** Open the render pass that the opaque draw + sky stages record into.
     *  Default opens with color='clear', depth='clear' via
     *  {@link RenderContext.beginOpaqueRenderPass}. Override to chain
     *  onto a previous pass (color='load', depth='load') — e.g. a second
     *  opaque pass that draws after a ClearDepthPass. */
    protected beginColorRenderPass(): void {
        this._renderContext.beginOpaqueRenderPass();
    }

    /** Whether this pass should draw the scene sky. Default true.
     *  Override to skip — e.g. a chained second opaque pass where the
     *  upstream pass already drew the sky. */
    protected shouldDrawSky(): boolean {
        return true;
    }

    protected _getCluster(view: View3D): ClusterLightingBuffer | undefined {
        return view.renderGraph?.getPass<ClusterLightingPass>('ClusterLightingPass')?.clusterLightingBuffer;
    }
}
