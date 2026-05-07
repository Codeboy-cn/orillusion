import { RenderTexture } from '../../../../textures/RenderTexture';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { GlobalBindGroup } from '../../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { RTDescriptor } from '../../../graphics/webGpu/descriptor/RTDescriptor';
import { WebGPUDescriptorCreator } from '../../../graphics/webGpu/descriptor/WebGPUDescriptorCreator';
import { EntityCollect } from '../../collect/EntityCollect';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { RTFrame } from '../../frame/RTFrame';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { PassType } from '../../passRenderer/state/PassType';
import { RendererPassState } from '../../passRenderer/state/RendererPassState';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { RenderStage } from '../RenderStage';
import { ClusterLightingPass } from './ClusterLightingPass';
import { COLOR_BUFFER } from './ColorPass';
import { SCENE_COLOR_PYRAMID } from './SceneColorPyramidPass';

export const OIT_ACCUM_TEX = '_OITAccum';
export const OIT_REVEAL_TEX = '_OITReveal';

/**
 * Weighted-Blended OIT accumulation pass (McGuire & Bavoil 2013).
 * Renders all transparent materials marked `oitMode === 'weighted'`
 * into two side-band attachments:
 *
 * - `_OITAccum` (RGBA16F, additive) — `Σ color·α·w` in RGB, `Σ α·w` in A
 * - `_OITReveal` (R8) — `Π (1 - α)` per pixel
 *
 * Depth comes from the main color pass's GBuffer (read-only) so
 * transparent fragments occluded by opaque geometry are correctly
 * culled. Companion {@link TransparentResolvePass} composites the
 * two attachments back into `_ColorBuffer` at AfterTransparent.
 *
 * @group Graph
 */
export class TransparentOITPass extends RenderGraphPass {
    public readonly name = 'TransparentOITPass';
    public readonly stage = RenderStage.Transparent;

    private _ctx!: Context3D;
    private readonly _passType: PassType = PassType.OIT_ACCUM;
    private _rendererPassState: RendererPassState | null = null;

    public setup(b: RenderGraphBuilder): void {
        this._ctx = b.context3D;
        b.read(COLOR_BUFFER);
        b.read(SCENE_COLOR_PYRAMID);
        // Lazy alloc: rtFrame depends on the colorPass GBuffer's
        // current depth texture, so build it on first read.
        b.write<RenderTexture>(OIT_ACCUM_TEX, () => {
            this._ensureRtFrame();
            return RTResourceMap.getTexture(this._ctx, OIT_ACCUM_TEX);
        });
        b.write<RenderTexture>(OIT_REVEAL_TEX, () => {
            this._ensureRtFrame();
            return RTResourceMap.getTexture(this._ctx, OIT_REVEAL_TEX);
        });
    }

    public execute(ctx: RenderGraphPassContext): void {
        this._ensureRtFrame();
        const view = ctx.view;
        const cluster = ctx.graph.getPass<ClusterLightingPass>('ClusterLightingPass')?.clusterLightingBuffer;
        const gpu = view.engine3D.context3D.gpuContext;
        const camera = view.camera;
        GlobalBindGroup.updateCameraGroup(camera);

        const passState = this._rendererPassState!;
        passState.camera3D = camera;

        const collectInfo = EntityCollect.instance.getRenderNodes(view.scene, camera);
        const transparents = collectInfo.transparentList ?? [];
        // Don't early-return when there are no weighted materials. The
        // companion TransparentResolvePass runs unconditionally and
        // composites OIT_ACCUM / OIT_REVEAL onto the colour buffer
        // every frame; if we skip the begin/end of THIS render pass,
        // those side-band textures retain their previous-frame contents
        // and the resolve pass blends a ghost of the last weighted-OIT
        // scene over today's opaque-only render. Always open/close the
        // pass so the rendererPassState's clear loadOp zeroes accum and
        // re-fills reveal to white before the resolve reads.

        const command = gpu.beginCommandEncoder();
        // OIT writes to side-band accum/reveal targets, not to the main
        // color cursor. Save/restore `gpu.lastRenderPassState` around
        // the OIT pass so the post-chain reader (PostPass →
        // _FinalColor → lastRenderPassState.getLastRenderTexture) keeps
        // pointing at the colorBuffer pass state set by SortedTransparent
        // / Resolve, not at the OIT_ACCUM RT.
        const savedLastPS = gpu.lastRenderPassState;
        const encoder = gpu.beginRenderPass(command, passState);

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
            // `if (renderShader.pipeline) renderShader.apply(...); return;`
            // early-return at the top, so per-frame calls don't re-do
            // the heavy texture/binding setup once the pipeline exists.
            node.nodeUpdate(view, this._passType, passState, cluster);
            node.renderPass2(view, this._passType, passState, cluster, encoder);
        }

        gpu.endPass(encoder);
        gpu.endCommandEncoder(command);
        gpu.lastRenderPassState = savedLastPS;
    }

    private _ensureRtFrame(): void {
        if (this._rendererPassState) return;
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
        rtFrame.depthLoadOp = 'load';
        rtFrame.label = 'OITAccum';

        this._rendererPassState = WebGPUDescriptorCreator.createRendererPassState(ctx, rtFrame);
        this._rendererPassState.label = 'OITAccum';
        // outColor index of the "primary" attachment (accum). Default
        // initialization in WebGPUDescriptorCreator looks for a name
        // matching colorBufferTex_NAME; OIT attachments don't, so set
        // it manually so per-pipeline blend wiring picks up target 0.
        this._rendererPassState.outColor = 0;
    }
}
