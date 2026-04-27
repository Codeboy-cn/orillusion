import { View3D } from '../../../../core/View3D';
import { GlobalBindGroup } from '../../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { RTDescriptor } from '../../../graphics/webGpu/descriptor/RTDescriptor';
import { WebGPUDescriptorCreator } from '../../../graphics/webGpu/descriptor/WebGPUDescriptorCreator';
import { EntityCollect } from '../../collect/EntityCollect';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { ClusterLightingBuffer } from '../cluster/ClusterLightingBuffer';
import { RTFrame } from '../../frame/RTFrame';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { RendererBase } from '../RendererBase';
import { PassType } from '../state/PassType';

export const DDP_FRONT_TEX = '_DDPFront';
export const DDP_FRONT_DEPTH_TEX = '_DDPFrontDepth';

// Legacy multi-pass scaffolding from stage 1 (kept exported so other
// modules can reference future expanded ping-pong / back-color passes
// without an additional engine refactor).
export const DDP_DEPTH_TEX_0 = '_DDPDepth0';
export const DDP_DEPTH_TEX_1 = '_DDPDepth1';
export const DDP_FRONT_TEX_0 = '_DDPFront0';
export const DDP_FRONT_TEX_1 = '_DDPFront1';
export const DDP_BACK_TEX = '_DDPBack';

/** All five RT names exposed for the resolve / debug features. */
export const DDP_TEX_NAMES = [
    DDP_FRONT_TEX,
    DDP_FRONT_DEPTH_TEX,
    DDP_DEPTH_TEX_0,
    DDP_DEPTH_TEX_1,
    DDP_FRONT_TEX_0,
    DDP_FRONT_TEX_1,
    DDP_BACK_TEX,
] as const;

/** Default peel pass count. Stage-3 MVP uses just init + 1 iteration's
 *  front layer; this constant stays for future expansion. */
export const DDP_DEFAULT_PASS_COUNT = 5;

/**
 * Dual Depth Peeling renderer (Babylon-style, stage-3 MVP).
 *
 * STAGE 3 IMPLEMENTATION SCOPE: single-layer depth peeling.
 *
 * - Each transparent fragment with `oitMode === 'depth-peel'` runs
 *   through the {@link DDPFrontPass} pipeline (one/zero overwrite
 *   blend + depth-write enabled + less-equal depth-test) into a
 *   private depth buffer.
 * - Result: per pixel, the front-most fragment wins via GPU depth-
 *   test. At α=1 this is fully opaque (front blocks bg). At α<1 the
 *   front layer's premultiplied colour overwrites the buffer with
 *   alpha=α, and the {@link TransparentResolveFeature} composites it
 *   over the existing _ColorBuffer using the over operator.
 *
 * STAGE 3 MVP TRADE-OFF: only the FRONT layer renders. Back layers
 * are occluded by depth-test rather than peeled and recomposed. For
 * a 27-sphere stack at α=0.5 this means you see 9-12 frontmost
 * spheres rather than all 27. This is **not** full Babylon-style
 * dual depth peeling — that adds a per-iteration peel loop reading
 * the previous-pass depth MRT to expose deeper layers. The N-
 * iteration loop is plumbed (RT names DDP_DEPTH_TEX_0/1, _FRONT_0/1,
 * _BACK; createDepthPeelPasses generates DEPTH/FRONT/BACK derived
 * passes per material) and ready for future expansion; stage 3 just
 * keeps the renderer simple to validate end-to-end first.
 *
 * What stage 3 DOES achieve:
 *   - α=1 in depth-peel mode → fully opaque, depth-test correct.
 *   - mode/material/alpha three axes remain atomic and observable
 *     (each setting produces a distinct render).
 *   - depth-peel is visually distinct from sorted (per-mesh-sort
 *     banding), weighted (averaged-milky), and hash (dithered).
 *
 * Future stages can expand `render()` into the full peel loop.
 *
 * @internal
 * @group Post
 */
export class DualDepthPeelingRenderer extends RendererBase {
    private readonly _ctx: Context3D;

    constructor(ctx: Context3D) {
        super();
        this.passType = PassType.OIT_DEPTH_PEEL_FRONT;
        this._ctx = ctx;
        this._initRTFrame();
    }

    private _initRTFrame(): void {
        const ctx = this._ctx;
        const w = ctx.presentationSize[0];
        const h = ctx.presentationSize[1];

        // Single-layer depth peeling RTs.
        // _DDPFront: HDR colour accum (PBR shading writes >1.0 colours
        // legitimately, RGBA8 would clip).
        // _DDPFrontDepth: private depth buffer for transparent depth-
        // test. depth-write enabled per DDPFrontPass; cleared each
        // frame so transparent-vs-transparent occlusion resets every
        // frame and doesn't bleed into next.
        const front = RTResourceMap.createRTTexture(ctx, DDP_FRONT_TEX, w, h, GPUTextureFormat.rgba16float, false, 0);
        front.name = DDP_FRONT_TEX;
        const depth = RTResourceMap.createRTTexture(ctx, DDP_FRONT_DEPTH_TEX, w, h, GPUTextureFormat.depth24plus, false, 0);
        depth.name = DDP_FRONT_DEPTH_TEX;

        const frontDesc = new RTDescriptor();
        frontDesc.loadOp = 'clear';
        frontDesc.clearValue = [0, 0, 0, 0];

        const rtFrame = new RTFrame([front], [frontDesc], depth, undefined, true);
        rtFrame.depthLoadOp = 'clear';
        // Cleared to 1.0 (far plane) so any incoming fragment can pass
        // depth-test on the first write at that pixel.
        (rtFrame as any).depthClearValue = 1.0;
        rtFrame.label = 'DDPFront';

        this.rendererPassState = WebGPUDescriptorCreator.createRendererPassState(ctx, rtFrame);
        this.rendererPassState.label = 'DDPFront';
        this._rtFrame = rtFrame;
        this.rendererPassState.outColor = 0;
    }

    public render(view: View3D, _occlusion: OcclusionSystem, clusterLightingBuffer?: ClusterLightingBuffer): void {
        const gpu = view.engine3D.context3D.gpuContext;
        const camera = view.camera;
        GlobalBindGroup.updateCameraGroup(camera);

        this.rendererPassState.camera3D = camera;

        const collectInfo = EntityCollect.instance.getRenderNodes(view.scene, camera);
        const transparents = collectInfo.transparentList ?? [];

        // Always open/close the pass so the clear loadOp zeroes _DDPFront
        // and resets depth to 1.0 even on frames where no depth-peel
        // material is in the transparent list. Mirrors the OITPassRenderer
        // contract — without this the resolve feature would composite
        // last-frame DDP front colour over the new opaque scene.

        const command = gpu.beginCommandEncoder();
        // Side-band side: save/restore lastRenderPassState so the post
        // chain reader keeps pointing at the colorBuffer pass state set
        // by SortedTransparent / Resolve, not at our DDP front MRT.
        // Same trick as OITPassRenderer.ts:129,156.
        const _savedLastPS = gpu.lastRenderPassState;
        const encoder = gpu.beginRenderPass(command, this.rendererPassState);

        gpu.bindCamera(encoder, camera);
        for (const node of transparents) {
            const mat = node.materials?.[0];
            if (!mat || mat.oitMode !== 'depth-peel') continue;
            // ALWAYS call nodeUpdate — see OITPassRenderer.ts:136-149
            // for the rationale (early-return-on-preInit hides
            // dirty-uniform uploads from later frames).
            node.nodeUpdate(view, this.passType, this.rendererPassState, clusterLightingBuffer);
            node.renderPass2(view, this.passType, this.rendererPassState, clusterLightingBuffer, encoder);
        }

        gpu.endPass(encoder);
        gpu.endCommandEncoder(command);
        gpu.lastRenderPassState = _savedLastPS;
    }
}
