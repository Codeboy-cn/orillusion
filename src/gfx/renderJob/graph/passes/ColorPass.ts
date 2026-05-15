import { RenderNode } from '../../../../components/renderer/RenderNode';
import { View3D } from '../../../../core/View3D';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { ProfilerUtil } from '../../../../util/ProfilerUtil';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GlobalBindGroup } from '../../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { WebGPUDescriptorCreator } from '../../../graphics/webGpu/descriptor/WebGPUDescriptorCreator';
import { EntityCollect } from '../../collect/EntityCollect';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { ClusterLightingBuffer } from '../../passRenderer/cluster/ClusterLightingBuffer';
import { RenderContext } from '../../passRenderer/RenderContext';
import { PassType } from '../../passRenderer/state/PassType';
import { RendererPassState } from '../../passRenderer/state/RendererPassState';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { buildOpBundles, buildTrBundles, dependOnIfRegistered, preInitPassPipelines } from './_helpers';
import { ClusterLightingPass, CLUSTER_LIGHTING_BUFFER } from './ClusterLightingPass';
import { MAIN_DEPTH_TEXTURE } from './PreDepthPass';
import { MAIN_SHADOW_MAP } from './ShadowPass';
import { POINT_SHADOW_CUBE_ARRAY } from './PointShadowPass';
import { REFLECTION_CUBE_MAP } from './ReflectionPass';
import { DDGI_DEPTH_MAP, DDGI_IRRADIANCE_MAP } from './GIPass';

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
 * Main forward color pass. Splits its work over three call sites
 * within the graph:
 *
 * - {@link execute} renders the opaque half (with sky); transmission
 *   materials are excluded so the SceneColorPyramid copy that follows
 *   sees the world *behind* the glass, not the glass itself.
 * - {@link renderTransmissionContinuation} draws the deferred
 *   transmission opaque materials after the pyramid has snapshotted
 *   the rest of the world. Driven by TransmissionOpaquePass.
 * - {@link renderTransparent} draws the sorted transparent half
 *   (and Graphic3D overlays) — driven by SortedTransparentPass after
 *   pyramid + transmission are done.
 *
 * Owns the shared GPU state (rendererPassState / renderContext) so
 * the three calls thread through the same render pass — the maskTr
 * / maskOp split lets them open/close/continue the encoder without
 * leaking transient state between graph nodes.
 *
 * @group Graph
 */
export class ColorPass extends RenderGraphPass {
    public readonly name = 'ColorPass';

    public rendererPassState!: RendererPassState;

    /** When set, the transparent half filters by material's `oitMode`.
     *  `'sorted'` skips materials marked for WBOIT; `'weighted'` would
     *  do the inverse but isn't currently used. */
    public oitFilter: 'sorted' | 'weighted' | null = null;

    /** Splits the opaque draw list across two passes so the
     *  SceneColorPyramid copy can sit between them. `'exclude'` skips
     *  materials with `transmissionFactor > 0` (main opaque half);
     *  `'only'` renders only those (transmission continuation). */
    public transmissionFilter: 'exclude' | 'only' | null = null;

    private readonly _passType: PassType = PassType.COLOR;
    private readonly _giEnabled: boolean;
    private _ctx!: Context3D;
    private _renderContext!: RenderContext;
    private _splitRendererPassState!: RendererPassState;

    constructor(public readonly config: { giEnabled: boolean } = { giEnabled: false }) {
        super();
        this._giEnabled = config.giEnabled;
    }

    public setup(b: RenderGraphBuilder): void {
        const view = b.view;
        const ctx = b.context3D;
        this._ctx = ctx;

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

        this.rendererPassState = WebGPUDescriptorCreator.createRendererPassState(ctx, rtFrame);
        const splitRtFrame = rtFrame.clone();
        splitRtFrame.depthLoadOp = 'load';
        for (const desc of splitRtFrame.rtDescriptors) desc.loadOp = 'load';
        this._splitRendererPassState = WebGPUDescriptorCreator.createRendererPassState(ctx, splitRtFrame);
        this._renderContext = new RenderContext(ctx, rtFrame);

        // Read deps: the shading inputs.
        b.read(CLUSTER_LIGHTING_BUFFER);
        b.read(MAIN_SHADOW_MAP);
        b.read(POINT_SHADOW_CUBE_ARRAY);
        b.read(REFLECTION_CUBE_MAP);
        if (this._giEnabled) {
            b.read(DDGI_IRRADIANCE_MAP);
            b.read(DDGI_DEPTH_MAP);
        }

        // Outputs: color + normal buffer.
        b.write<RenderTexture>(COLOR_BUFFER, () =>
            GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).getColorTexture()
        );
        b.write<RenderTexture>(NORMAL_BUFFER, () =>
            GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).getCompressGBufferTexture()
        );

        // Side-effect ordering. SceneCapturePass renders off-screen
        // RTs that this frame's lit materials sample directly via
        // SceneCaptureCameraComponent (no graph-pool handle). GPUCullPass
        // (when present) populates the indirect draw buffers consumed
        // through GlobalBindGroup. Neither flows as a `b.read`, so we
        // declare the ordering explicitly.
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

        const cluster = this._getCluster(ctx.view);
        const prevFilter = this.transmissionFilter;
        this.transmissionFilter = 'exclude';
        try {
            this._render(
                ctx.view,
                ctx.occlusion,
                cluster,
                true,  // maskTr — opaque half only
                false, // maskOp
            );
        } finally {
            this.transmissionFilter = prevFilter;
        }
    }

    /** Continuation pass driven by TransmissionOpaquePass: reopens
     *  the color attachment with `loadOp='load'` and draws *only*
     *  opaque materials whose transmissionFactor > 0. */
    public renderTransmissionContinuation(view: View3D, occlusion: OcclusionSystem): void {
        const cluster = this._getCluster(view);
        const gpu = view.engine3D.context3D.gpuContext;
        this._renderContext.gpu = gpu;

        const camera = view.camera;
        GlobalBindGroup.updateCameraGroup(camera);
        this.rendererPassState.camera3D = camera;

        const collectInfo = EntityCollect.instance.getRenderNodes(view.scene, camera);
        if (!collectInfo.opaqueList) return;

        this._renderContext.beginTransparentRenderPass();
        const encoder = this._renderContext.encoder;
        gpu.bindCamera(encoder, camera);

        const prevFilter = this.transmissionFilter;
        this.transmissionFilter = 'only';
        try {
            this._drawNodes(view, this._renderContext, collectInfo.opaqueList, occlusion, cluster);
        } finally {
            this.transmissionFilter = prevFilter;
        }

        this._renderContext.endRenderPass();
    }

    /** Transparent half driven by SortedTransparentPass. */
    public renderTransparent(view: View3D, occlusion: OcclusionSystem, filter: 'all' | 'sorted'): void {
        const cluster = this._getCluster(view);
        const prevOitFilter = this.oitFilter;
        this.oitFilter = filter === 'all' ? null : 'sorted';
        try {
            this._render(
                view,
                occlusion,
                cluster,
                false, // maskTr
                true,  // maskOp
            );
        } finally {
            this.oitFilter = prevOitFilter;
        }
    }

    private _getCluster(view: View3D): ClusterLightingBuffer | undefined {
        return view.renderGraph?.getPass<ClusterLightingPass>('ClusterLightingPass')?.clusterLightingBuffer;
    }

    private _render(
        view: View3D,
        occlusion: OcclusionSystem,
        cluster: ClusterLightingBuffer,
        maskTr: boolean,
        maskOp: boolean,
    ): void {
        const gpu = view.engine3D.context3D.gpuContext;
        this._renderContext.gpu = gpu;
        if (!maskOp) {
            // Opaque-half (or maskTr) call owns the render context — start
            // fresh. The transparent-only call (maskOp=true) is invoked
            // after the opaque half already finished a pass so the
            // cached state is still relevant.
            this._renderContext.clean();
        }

        const scene = view.scene;
        const camera = view.camera;
        GlobalBindGroup.updateCameraGroup(camera);
        this.rendererPassState.camera3D = camera;

        const collectInfo = EntityCollect.instance.getRenderNodes(scene, camera);

        const opBundles = maskOp ? [] : buildOpBundles(view, camera, this._passType, this.rendererPassState, cluster);
        // When the transparent half is partitioned by oitMode, skip
        // cached bundles (they bake the full transparent set) and let
        // _drawNodes do the per-node filter inline. Bundle re-keying
        // for OIT/sorted partitions is a future optimization.
        const trBundles = (maskTr || this.oitFilter !== null) ? [] : buildTrBundles(view, camera, this._passType, this.rendererPassState, cluster);

        if (!maskOp) {
            this._renderContext.beginOpaqueRenderPass();
            const encoder = this._renderContext.encoder;

            if (opBundles.length > 0) {
                encoder.executeBundles(opBundles);
            }

            if (collectInfo.opaqueList) {
                gpu.bindCamera(encoder, camera);
                this._drawNodes(view, this._renderContext, collectInfo.opaqueList, occlusion, cluster);
            }

            // Sky goes LAST in the opaque half — by now every opaque
            // mesh has written depth, so sky's
            // `depthCompare='less_equal' + writeDepth=false` only
            // paints empty pixels (where Z is still the cleared 1.0).
            // Same optimization Unity / UE apply by default.
            const sky = EntityCollect.instance.getSky(scene);
            if (sky) {
                gpu.bindCamera(encoder, camera);
                if (!sky.preInit(this._passType)) {
                    sky.nodeUpdate(view, this._passType, this.rendererPassState, cluster);
                }
                sky.renderPass2(view, this._passType, this.rendererPassState, cluster, encoder);
            }

            // Split mode: opaque half ends here so the SceneColorPyramid
            // copy can run between halves. The matching transparent
            // call (maskOp=true) reopens with loadOp='load'.
            if (maskTr) {
                this._renderContext.endRenderPass();
                return;
            }
        }

        // Transparent half: reopen with loadOp='load' (or continue from
        // the still-open opaque encoder when neither mask is set).
        if (maskOp) {
            this._renderContext.beginTransparentRenderPass();
        }
        const encoder = this._renderContext.encoder;

        if (trBundles.length > 0) {
            encoder.executeBundles(trBundles);
        }

        if (!maskTr && collectInfo.transparentList) {
            gpu.bindCamera(encoder, camera);
            this._drawNodes(view, this._renderContext, collectInfo.transparentList, occlusion, cluster);
        }

        // Graphic3D overlays (debug primitives, gizmos) draw last with
        // the split pass state (loadOp='load') so they survive any
        // earlier render-pass split.
        const graphics = EntityCollect.instance.getGraphicList();
        for (const g of graphics) {
            g.nodeUpdate(view, this._passType, this._splitRendererPassState, cluster);
            g.renderPass2(view, this._passType, this._splitRendererPassState, cluster, encoder);
        }

        this._renderContext.endRenderPass();
        ProfilerUtil.end('ColorPass Draw Transparent');
    }

    private _drawNodes(
        view: View3D,
        renderContext: RenderContext,
        nodes: RenderNode[],
        _occlusion: OcclusionSystem,
        cluster: ClusterLightingBuffer,
    ): void {
        // Pre-init walk: ensure pipelines are compiled before draw.
        preInitPassPipelines(view, this._passType, this.rendererPassState, cluster);

        const render = view.engine3D.setting.render;
        const oitFilter = this.oitFilter;
        const transmissionFilter = this.transmissionFilter;
        const max = Math.min(nodes.length, render.drawOpMax);
        for (let i = render.drawOpMin; i < max; ++i) {
            const node = nodes[i];
            if (!node.transform.enable) continue;
            if (!node.enable) continue;
            if (node.isDestroyed) continue;

            // OIT / sorted partition. When TransparentOITPass is in
            // the graph, sortedTransparent sets `oitFilter='sorted'`
            // and we skip materials that opted into WBOIT.
            if (oitFilter !== null) {
                const mat = node.materials?.[0];
                if (oitFilter === 'sorted' && mat?.oitMode === 'weighted') continue;
                if (oitFilter === 'weighted' && mat?.oitMode !== 'weighted') continue;
            }
            // Transmission split: keep transmission materials out of the
            // SceneColorPyramid copy by deferring them to the
            // continuation pass. The typeof guard avoids reading
            // transmissionFactor on UnlitMaterial etc.
            if (transmissionFilter !== null) {
                const mat = node.materials?.[0] as any;
                const hasTransmission = typeof mat?.transmissionFactor === 'number' && mat.transmissionFactor > 0;
                if (transmissionFilter === 'exclude' && hasTransmission) continue;
                if (transmissionFilter === 'only' && !hasTransmission) continue;
            }
            if (!node.preInit(this._passType)) {
                node.nodeUpdate(view, this._passType, this.rendererPassState, cluster);
            }
            node.renderPass(view, this._passType, renderContext);
        }
    }

}
