import { View3D } from '../../../../core/View3D';
import { GlobalBindGroup } from '../../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { RTDescriptor } from '../../../graphics/webGpu/descriptor/RTDescriptor';
import { WebGPUDescriptorCreator } from '../../../graphics/webGpu/descriptor/WebGPUDescriptorCreator';
import { EntityCollect } from '../../collect/EntityCollect';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { RTFrame } from '../../frame/RTFrame';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { ClusterLightingBuffer } from '../cluster/ClusterLightingBuffer';
import { RTResourceConfig } from '../../config/RTResourceConfig';
import { RendererBase } from '../RendererBase';
import { PassType } from '../state/PassType';

export const OIT_ACCUM_TEX = '_OITAccum';
export const OIT_REVEAL_TEX = '_OITReveal';

/**
 * Renderer for the {@link PassType.OIT_ACCUM} pass — the "accumulate"
 * half of Weighted-Blended OIT. Iterates the scene's transparent
 * draw list, filtering to materials with `oitMode === 'weighted'`,
 * and renders each through its OIT pass (registered by
 * {@link PassGenerate.createOITPass}).
 *
 * The render pass writes to two attachments allocated up front
 * against the engine's main color-pass depth buffer (`loadOp='load'`,
 * no depth writes — opaque depth must remain authoritative for
 * depth-testing transparent fragments).
 *
 * @internal
 * @group Post
 */
export class OITPassRenderer extends RendererBase {
    private readonly _ctx: Context3D;

    constructor(ctx: Context3D) {
        super();
        this.passType = PassType.OIT_ACCUM;
        this._ctx = ctx;
        this._initRTFrame();
    }

    private _initRTFrame(): void {
        const ctx = this._ctx;
        // Allocate persistent OIT attachments. Depth is borrowed from
        // the main color pass's GBufferFrame so depth testing matches
        // the opaque scene; loadOp='load' preserves the depth from the
        // opaque pass and depthWriteEnabled is set per-pipeline (in
        // OITAccumPass.shaderState.depthWriteEnabled = false).
        const colorGBuffer = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, ctx);
        const w = ctx.presentationSize[0];
        const h = ctx.presentationSize[1];

        const accum = RTResourceMap.createRTTexture(ctx, OIT_ACCUM_TEX, w, h, GPUTextureFormat.rgba16float, false, 0);
        const reveal = RTResourceMap.createRTTexture(ctx, OIT_REVEAL_TEX, w, h, GPUTextureFormat.r8unorm, false, 0);
        // RTResourceMap reuses textures by name across calls — make
        // sure these stay separate from the color buffer registration.
        accum.name = OIT_ACCUM_TEX;
        reveal.name = OIT_REVEAL_TEX;

        const accumDesc = new RTDescriptor();
        accumDesc.loadOp = 'clear';
        accumDesc.clearValue = [0, 0, 0, 0];
        const revealDesc = new RTDescriptor();
        revealDesc.loadOp = 'clear';
        revealDesc.clearValue = [1, 1, 1, 1];

        const rtFrame = new RTFrame(
            [accum, reveal],
            [accumDesc, revealDesc],
            colorGBuffer.depthTexture,
            undefined,
            true,
        );
        // OIT depth is read-only — depth attachment loads, never clears.
        rtFrame.depthLoadOp = 'load';
        rtFrame.label = 'OITAccum';

        // Force a different cache key than the color pass so the
        // attachment textures are distinct in WebGPUDescriptorCreator's
        // per-context map. Using the rtFrame instance as the key already
        // achieves that — no extra work needed.
        this.rendererPassState = WebGPUDescriptorCreator.createRendererPassState(ctx, rtFrame);
        this.rendererPassState.label = 'OITAccum';
        this._rtFrame = rtFrame;
        // outColor index of the "primary" attachment (accum). Default
        // initialization in WebGPUDescriptorCreator looks for a name
        // matching colorBufferTex_NAME; OIT attachments don't, so set
        // it manually so per-pipeline blend wiring picks up target 0.
        this.rendererPassState.outColor = 0;

        // Avoid stale bind groups when the canvas resizes — when the
        // size of the GBuffer changes our OIT RTs should track. The
        // RTResourceMap already auto-resizes on the underlying
        // RenderTextures (autoResize=true is the default for the
        // helper), so the GPUTexture pointers stay live and pipelines
        // don't need rebuilding.
        void RTResourceConfig;
    }

    public render(view: View3D, _occlusion: OcclusionSystem, clusterLightingBuffer?: ClusterLightingBuffer): void {
        const gpu = view.engine3D.context3D.gpuContext;
        const camera = view.camera;
        GlobalBindGroup.updateCameraGroup(camera);

        this.rendererPassState.camera3D = camera;

        const collectInfo = EntityCollect.instance.getRenderNodes(view.scene, camera);
        const transparents = collectInfo.transparentList ?? [];
        // Don't early-return when there are no weighted materials. The
        // companion TransparentResolveFeature runs unconditionally and
        // composites OIT_ACCUM / OIT_REVEAL onto the colour buffer
        // every frame; if we skip the begin/end of THIS render pass,
        // those side-band textures retain their previous-frame contents
        // and the resolve feature blends a ghost of the last weighted-
        // OIT scene over today's opaque-only render. Always open/close
        // the pass so the rendererPassState's clear loadOp zeroes
        // accum and re-fills reveal to white before the resolve reads.

        const command = gpu.beginCommandEncoder();
        // OIT writes to side-band accum/reveal targets, not to the main
        // color cursor. Save/restore `gpu.lastRenderPassState` around
        // the OIT pass so the post-chain reader (PostFeature →
        // _FinalColor → lastRenderPassState.getLastRenderTexture) keeps
        // pointing at the colorBuffer pass state set by SortedTransparent
        // / Resolve, not at the OIT_ACCUM RT.
        const _savedLastPS = gpu.lastRenderPassState;
        const encoder = gpu.beginRenderPass(command, this.rendererPassState);

        gpu.bindCamera(encoder, camera);
        for (const node of transparents) {
            const mat = node.materials?.[0];
            if (!mat || mat.oitMode !== 'weighted') continue;
            // ALWAYS call nodeUpdate — not just on first init.
            //
            // nodeUpdate is where `renderShader.apply()` runs, and apply
            // is where `materialDataUniformBuffer.apply()` uploads the
            // dirty uniform buffer to the GPU. The earlier guard
            // `if (!node.preInit(passType))` skipped nodeUpdate after
            // the first frame, freezing the OIT pass's uniforms — so
            // dragging the alpha slider in WBOIT mode appeared to do
            // nothing (the buffer was marked dirty but apply never ran
            // to flush it). nodeUpdate itself contains an
            // `if (renderShader.pipeline) renderShader.apply(...);
            // continue;` early-return at the top, so per-frame calls
            // don't re-do the heavy texture/binding setup once the
            // pipeline exists. Same pattern ColorPassRenderer uses.
            node.nodeUpdate(view, this.passType, this.rendererPassState, clusterLightingBuffer);
            node.renderPass2(view, this.passType, this.rendererPassState, clusterLightingBuffer, encoder);
        }

        gpu.endPass(encoder);
        gpu.endCommandEncoder(command);
        gpu.lastRenderPassState = _savedLastPS;
    }
}
