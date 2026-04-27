import { View3D } from '../../../../core/View3D';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { ClusterLightingBuffer } from '../cluster/ClusterLightingBuffer';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { RendererBase } from '../RendererBase';
import { PassType } from '../state/PassType';

/** RT resource names for the dual depth peeling pipeline. Two of each
 *  for ping-pong (read prev / write curr in alternating iterations). */
export const DDP_DEPTH_TEX_0 = '_DDPDepth0';
export const DDP_DEPTH_TEX_1 = '_DDPDepth1';
export const DDP_FRONT_TEX_0 = '_DDPFront0';
export const DDP_FRONT_TEX_1 = '_DDPFront1';
export const DDP_BACK_TEX = '_DDPBack';

/** All five RT names exposed for the resolve / debug features. */
export const DDP_TEX_NAMES = [
    DDP_DEPTH_TEX_0,
    DDP_DEPTH_TEX_1,
    DDP_FRONT_TEX_0,
    DDP_FRONT_TEX_1,
    DDP_BACK_TEX,
] as const;

/** Default peel passes. Each pass extracts two layers (one front, one
 *  back) so the effective transparent layer count = passCount × 2. The
 *  Babylon default is 5 → 10 layers, which is the right ballpark for
 *  hero / glass scenes; particle-density scenes should use WBOIT. */
export const DDP_DEFAULT_PASS_COUNT = 5;

/**
 * Dual Depth Peeling renderer (Babylon-style, McGuire-Bavoil 2008
 * variant). Order-correct OIT: per-pixel maintains (depth_min, depth_max)
 * via MAX-blend MRT, then peels two layers per iteration with `over`
 * blending from the front and `under` blending from the back. The final
 * composite (handled by the resolve feature) yields:
 *
 *     final = bg · (1 - frontColor.a) + frontColor + (1 - frontColor.a) · backColor
 *
 * When the front-most fragment has α=1, frontColor.a = 1 → bg · 0 +
 * frontColor + 0 = frontColor. That is the property weighted-blended
 * OIT cannot match at small scene scales: α=1 → genuinely opaque,
 * front-fragment-correct, regardless of draw order or scene depth range.
 *
 * Trade-offs vs WBOIT (`OITPassRenderer`):
 *   - α=1 opaque (vs averaged-milky)
 *   - Order correctness (vs depth-weighted average)
 *   - Hard layer-count cap = passCount×2 (vs unbounded)
 *   - 5-10× transparent rendering cost (vs ~1×)
 *   - 4 MRTs (vs 2)
 *
 * STAGE 1 (this commit): scaffolding only — registers RTs, lays out the
 * passType, but `render()` is a clear-only stub. The actual peel loop
 * lands in stage 3 once the per-material shader output paths (stage 2)
 * are wired. Materials with `oitMode === 'depth-peel'` currently fall
 * through to the sorted path because no derived passes exist yet.
 *
 * @internal
 * @group Post
 */
export class DualDepthPeelingRenderer extends RendererBase {
    private readonly _ctx: Context3D;
    private _passCount: number = DDP_DEFAULT_PASS_COUNT;

    constructor(ctx: Context3D) {
        super();
        // The renderer drives three pass types per peel iteration; we
        // tag the instance with FRONT as a "primary" passType for the
        // RendererBase contract (used as a default `_rendererType` for
        // derived-pass dispatch). Stage 3 will route per sub-pass.
        this.passType = PassType.OIT_DEPTH_PEEL_FRONT;
        this._ctx = ctx;
        this._allocateRTs();
    }

    public get passCount(): number {
        return this._passCount;
    }

    public set passCount(value: number) {
        // Babylon clamps to [1, 10] in practice — beyond 10 layers the
        // marginal benefit drops sharply. We mirror that range so dev
        // tooling can experiment without producing absurd RT churn.
        const clamped = Math.max(1, Math.min(10, Math.floor(value)));
        if (clamped === this._passCount) return;
        this._passCount = clamped;
    }

    /** Allocate the five depth-peeling RTs through RTResourceMap so they
     *  participate in canvas-resize auto-rebuild. The resolve / debug
     *  features can resolve them by name from the shared map. */
    private _allocateRTs(): void {
        const ctx = this._ctx;
        const w = ctx.presentationSize[0];
        const h = ctx.presentationSize[1];

        // Two depth MRTs: store (-min, max) per pixel so MAX blending
        // produces both extrema in a single channel. RG32F gives full
        // precision for sub-pixel depth comparisons across the [0, 1]
        // NDC range. Babylon uses RG16F by default and switches to
        // RG32F via a 16BIT define; we go straight to 32F to side-
        // step the precision tradeoff.
        const depth0 = RTResourceMap.createRTTexture(ctx, DDP_DEPTH_TEX_0, w, h, GPUTextureFormat.rg32float, false, 0);
        const depth1 = RTResourceMap.createRTTexture(ctx, DDP_DEPTH_TEX_1, w, h, GPUTextureFormat.rg32float, false, 0);
        depth0.name = DDP_DEPTH_TEX_0;
        depth1.name = DDP_DEPTH_TEX_1;

        // Two front-color RTs ping-pong the over-blended front color.
        // RGBA16F because we accumulate `(1-prevA) · α · rgb` which is
        // unbounded HDR (lit color from PBR shading > 1.0 is normal).
        const front0 = RTResourceMap.createRTTexture(ctx, DDP_FRONT_TEX_0, w, h, GPUTextureFormat.rgba16float, false, 0);
        const front1 = RTResourceMap.createRTTexture(ctx, DDP_FRONT_TEX_1, w, h, GPUTextureFormat.rgba16float, false, 0);
        front0.name = DDP_FRONT_TEX_0;
        front1.name = DDP_FRONT_TEX_1;

        // One back-color RT. Back blending is associative under
        // `(curr.rgb·curr.a + prev.rgb·(1-curr.a))` so a single buffer
        // is enough — no ping-pong required.
        const back = RTResourceMap.createRTTexture(ctx, DDP_BACK_TEX, w, h, GPUTextureFormat.rgba16float, false, 0);
        back.name = DDP_BACK_TEX;

        // Stage 1 doesn't actually run any passes against these RTs;
        // they're allocated to validate the resource layout end-to-end
        // (creation succeeds on Apple Metal + Dawn D3D12, ping-pong
        // names don't collide with existing RTResourceMap entries).
        // Stage 3 will build the per-iteration RTFrames and bind them.
    }

    /** Stage 1 stub — no rendering happens here yet. Returning early
     *  keeps the frame graph contract (feature.execute() never throws)
     *  while the rest of the depth-peel pipeline gets built. */
    public render(_view: View3D, _occlusion: OcclusionSystem, _clusterLightingBuffer?: ClusterLightingBuffer): void {
        // Intentionally empty for stage 1.
        //
        // Stage 3 will:
        //   1. Init pass: render every transparent material with
        //      `oitMode === 'depth-peel'` to depth0 with MAX blend so
        //      depth0.r = max(-d_i) = -min(d_i), depth0.g = max(d_i).
        //      Front = clear, Back = clear.
        //   2. Loop passCount times:
        //      a. Peel: read prev depth MRT, write curr depth MRT —
        //         only fragments outside (prev.min, prev.max) range,
        //         finding the next-nearest and next-furthest.
        //      b. Front: render the layer at curr depth.r with
        //         over-operator into front MRT.
        //      c. Back: render the layer at curr depth.g with
        //         under-operator into back MRT.
        //      Swap depth ping-pong, swap front ping-pong.
        //   3. Save/restore gpu.lastRenderPassState around the whole
        //      loop (post chain reads the colorBuffer cursor, which
        //      these side-band passes shouldn't clobber — same trick
        //      as OITPassRenderer.ts:129,156).
    }
}
