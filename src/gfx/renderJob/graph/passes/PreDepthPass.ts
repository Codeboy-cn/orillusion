import { RenderNode } from '../../../../components/renderer/RenderNode';
import { VirtualTexture } from '../../../../textures/VirtualTexture';
import { ProfilerUtil } from '../../../../util/ProfilerUtil';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { RTDescriptor } from '../../../graphics/webGpu/descriptor/RTDescriptor';
import { WebGPUDescriptorCreator } from '../../../graphics/webGpu/descriptor/WebGPUDescriptorCreator';
import { RTResourceConfig } from '../../config/RTResourceConfig';
import { RTFrame } from '../../frame/RTFrame';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { PassType } from '../../passRenderer/state/PassType';
import { RendererPassState } from '../../passRenderer/state/RendererPassState';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { buildOpBundles, preInitPassPipelines } from './_helpers';

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
 * Z-prepass: writes a depth-only texture used by the main color pass
 * to short-circuit overdraw, plus an rgba16float side-channel sampled
 * by SSR / SSGI / outline. Gated on `engine.setting.render.zPrePass`.
 *
 * @group Graph
 */
export class PreDepthPass extends RenderGraphPass {
    public readonly name = 'PreDepthPass';

    public zBufferTexture!: VirtualTexture;
    public rendererPassState!: RendererPassState;

    protected readonly _passType: PassType = PassType.DEPTH;
    protected _rtFrame!: RTFrame;

    public setup(b: RenderGraphBuilder): void {
        const ctx = b.context3D;
        const [w, h] = ctx.presentationSize;

        // Allocate up front; close over the locals so pool getters
        // return stable identities (no rebuild-on-resize for the
        // depth prepass — RTResourceMap caches by name and handles
        // its own resize cycle).
        this.zBufferTexture = RTResourceMap.createRTTexture(
            ctx,
            RTResourceConfig.zBufferTexture_NAME,
            Math.floor(w),
            Math.floor(h),
            GPUTextureFormat.rgba16float,
            false,
        );
        const depthTex = RTResourceMap.createRTTexture(
            ctx,
            RTResourceConfig.zPreDepthTexture_NAME,
            Math.floor(w),
            Math.floor(h),
            GPUTextureFormat.depth32float,
            false,
        );

        const clearDesc = new RTDescriptor();
        clearDesc.clearValue = [0, 0, 0, 0];
        clearDesc.loadOp = 'clear';

        this._rtFrame = new RTFrame([], [], depthTex, null, false);
        this.rendererPassState = WebGPUDescriptorCreator.createRendererPassState(ctx, this._rtFrame);

        // _MainDepthTexture: the depth-only target the color pass
        // hooks into via `rtFrame.zPreTexture`. Returns the live
        // depth texture from the pass state (which RTResourceMap
        // resize-rebuilds in place).
        b.write(MAIN_DEPTH_TEXTURE, () => this.rendererPassState.depthTexture);
        // _ZBufferTexture: rgba16float side-channel for SSR / SSGI / outline.
        b.write(Z_BUFFER_TEXTURE, () => this.zBufferTexture);
    }

    public execute(ctx: RenderGraphPassContext): void {
        const view = ctx.view;
        const occlusion = ctx.occlusion;
        const gpu = view.engine3D.context3D.gpuContext;
        const camera = view.camera;
        const scene = view.scene;
        gpu.cleanCache();

        ProfilerUtil.start('DepthPass Renderer');

        this.rendererPassState.camera3D = camera;
        const layered = this.collectLayered(view);

        const opBundles = buildOpBundles(view, camera, this._passType, this.rendererPassState);

        const command = gpu.beginCommandEncoder();
        const encoder = gpu.beginRenderPass(command, this.rendererPassState);

        if (opBundles.length > 0) encoder.executeBundles(opBundles);

        // Force one node per shader to compile its DEPTH pipeline before
        // the first frame submits — the prepass must not stall on
        // first-use compilation.
        preInitPassPipelines(view, this._passType, this.rendererPassState);

        this._drawOpaque(view, encoder, layered.opaque, occlusion);

        gpu.endPass(encoder);
        gpu.endCommandEncoder(command);

        ProfilerUtil.end('DepthPass Renderer');
    }

    protected _drawOpaque(view: any, encoder: GPURenderPassEncoder, nodes: RenderNode[], _occlusion: OcclusionSystem): void {
        view.engine3D.context3D.gpuContext.bindCamera(encoder, view.camera);
        const render = view.engine3D.setting.render;
        const max = Math.min(nodes.length, render.drawOpMax);
        for (let i = render.drawOpMin; i < max; ++i) {
            const node = nodes[i];
            if (!node.transform.enable) continue;
            if (!node.enable) continue;
            if (node.isDestroyed) continue;
            if (!node.preInit(this._passType)) {
                node.nodeUpdate(view, this._passType, this.rendererPassState);
            }
            node.renderPass2(view, this._passType, this.rendererPassState, undefined, encoder);
        }
    }
}
