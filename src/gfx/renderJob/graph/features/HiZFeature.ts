import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';

export const HIZ_PYRAMID = '_HiZPyramid';

/**
 * Hi-Z depth pyramid generation.
 *
 * Produces a max-z mip chain from the main color pass's depth buffer
 * (or, when `zPrePass` is on, from `_ZBufferTexture`). Downstream
 * consumers — SSR, SSGI, GPU occlusion culling, Volumetric Fog visibility
 * — read this pyramid to skip pixel-by-pixel ray marching in favor of
 * `log2(N)` lookups.
 *
 * **MVP status — skeleton**: this feature allocates the pyramid texture
 * with the correct mip count and registers the `_HiZPyramid` graph
 * handle, but the per-frame max-z reduction shader is not yet
 * implemented. Consumers reading this handle currently see uninitialized
 * mip levels; SSR / GPU cull integrations are gated on the full
 * implementation landing in a follow-up.
 *
 * The generation pass plan (deferred):
 *   1. Mip 0: copy depthTexture into pyramid mip 0 (or render direct).
 *   2. Each subsequent mip: 2×2 max-z reduction via compute, ping-pong
 *      OR same-mip read-write where allowed.
 *   3. SPD-style single-pass cooperative reduction is the upgrade target.
 *
 * @group Graph
 */
export class HiZFeature extends RenderFeature {
    public readonly name = 'HiZFeature';
    public readonly stage = RenderStage.HiZ;
    public readonly reads: readonly string[] = [];
    public readonly writes = [HIZ_PYRAMID];

    private readonly _ctx: Context3D;
    private _pyramid: RenderTexture | null = null;

    constructor(ctx: Context3D) {
        super();
        this._ctx = ctx;
    }

    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<RenderTexture>(HIZ_PYRAMID, () => this._getOrAllocate());
    }

    private _getOrAllocate(): RenderTexture {
        const depthTex = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).depthTexture;
        const w = depthTex.width;
        const h = depthTex.height;
        if (this._pyramid && this._pyramid.width === w && this._pyramid.height === h) {
            return this._pyramid;
        }
        // r16float — sufficient precision for occlusion tests; iOS-safe
        // (no `float32-filterable` requirement).
        this._pyramid = RTResourceMap.createRTTexture(
            this._ctx, HIZ_PYRAMID, w, h,
            GPUTextureFormat.r16float,
            true, // useMipmap
            0,
        );
        this._pyramid.name = HIZ_PYRAMID;
        return this._pyramid;
    }

    public execute(_ctx: FeatureContext): void {
        // Allocate (idempotent) so consumers can `pool.get(HIZ_PYRAMID)`.
        // Mip-chain generation deferred — see class doc.
        this._getOrAllocate();
    }
}
